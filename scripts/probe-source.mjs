#!/usr/bin/env node
// Read-only probe of the official CanadaBuys open-data sources (Gate 1, docs/validation.md).
// Fetches the open and complete tender-notice CSVs and the data dictionary, then writes a
// structural report: headers, sizes, hashes, column fill/cardinality, id multiplicity,
// date-shape patterns. Zero dependencies, Node >= 20. Nothing here is product code.
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCES = {
  open: 'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv',
  complete: 'https://canadabuys.canada.ca/opendata/pub/tenderNoticeComplete-avisAppelOffresComplet.csv',
  dictionary: 'https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/achatscanada-canadabuys-dd.xml',
};
export const USER_AGENT =
  'canadabuys-material-delta-probe (+https://github.com/koydas/canadabuys-material-delta)';

// Contact-like columns: never report values or value shapes for them (ADR-0001: no personal data).
export const SENSITIVE_RE = /e-?mail|courriel|phone|t[eé]l[eé]phone|fax|contact/i;
// Columns that may identify a notice or a solicitation; used for the amendment-multiplicity question.
export const ID_RE = /reference|r[eé]f[eé]rence|number|num[eé]ro|identifier|solicitation|(^|[^a-z])id([^a-z]|$)/i;

const REPORT_HEADERS = [
  'content-type', 'content-length', 'content-encoding', 'last-modified', 'etag', 'date', 'cache-control', 'age',
];

/** Streaming RFC 4180 parser. write() accepts arbitrary chunk boundaries. */
export function createCsvParser(onRow, delimiter = ',') {
  let field = '';
  let row = [];
  let inQuotes = false;
  let quoteSeen = false;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    if (row.length === 0 && field === '') return; // blank line
    endField();
    onRow(row);
    row = [];
  };
  const push = (ch) => {
    if (quoteSeen) {
      quoteSeen = false;
      if (ch === '"') { field += '"'; return; }
      inQuotes = false;
    }
    if (inQuotes) {
      if (ch === '"') quoteSeen = true; else field += ch;
      return;
    }
    if (ch === '"' && field === '') { inQuotes = true; return; }
    if (ch === delimiter) endField();
    else if (ch === '\n') endRow();
    else if (ch !== '\r') field += ch;
  };
  return {
    write(chunk) { for (const ch of chunk) push(ch); },
    end() {
      if (quoteSeen) { quoteSeen = false; inQuotes = false; }
      const unterminatedQuote = inQuotes;
      if (field !== '' || row.length > 0) { endField(); onRow(row); row = []; }
      return { unterminatedQuote };
    },
  };
}

export function detectDelimiter(sample) {
  const firstLine = sample.split('\n', 1)[0];
  let best = ','; let bestCount = -1; let q = false;
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  for (const [d, n] of Object.entries(counts)) if (n > bestCount) { best = d; bestCount = n; }
  return best;
}

export function shapeOf(value) {
  return value.slice(0, 40).replace(/\d/g, '9').replace(/\p{L}{2,}/gu, 'a');
}

export function createColumnProfiler(header, { cap = 200_000, idCap = 500_000, enumMax = 30, shapeMax = 8 } = {}) {
  const dupNames = new Set(header.filter((n, i) => header.indexOf(n) !== i));
  const cols = header.map((name) => {
    const isId = ID_RE.test(name);
    return {
      name, duplicate: dupNames.has(name), sensitive: SENSITIVE_RE.test(name), isId, filled: 0,
      values: isId ? null : new Set(), counts: isId ? new Map() : null,
      overflow: false, shapes: new Map(), shapesOverflow: false,
    };
  });
  let rows = 0; let ragged = 0;
  return {
    add(row) {
      rows++;
      if (row.length !== header.length) ragged++;
      cols.forEach((c, i) => {
        const v = row[i];
        if (v === undefined || v.trim() === '') return;
        c.filled++;
        if (c.isId) {
          if (c.counts.has(v) || c.counts.size < idCap) c.counts.set(v, (c.counts.get(v) ?? 0) + 1);
          else c.overflow = true;
        } else if (c.values.has(v) || c.values.size < cap) c.values.add(v);
        else c.overflow = true;
        if (!c.sensitive) {
          const s = shapeOf(v);
          if (c.shapes.has(s) || c.shapes.size < shapeMax) c.shapes.set(s, (c.shapes.get(s) ?? 0) + 1);
          else c.shapesOverflow = true;
        }
      });
    },
    // A column whose name is duplicated or whose value cap was hit is ambiguous/partial: never compared, always listed.
    idSets() {
      return new Map(cols.filter((c) => c.isId && !c.overflow && !c.duplicate).map((c) => [c.name, new Set(c.counts.keys())]));
    },
    idExcluded() {
      return cols.filter((c) => c.isId && (c.overflow || c.duplicate))
        .map((c) => ({ column: c.name, reason: c.duplicate ? 'duplicate column name' : 'distinct-value cap reached' }));
    },
    result() {
      return {
        rows, ragged,
        columns: cols.map((c) => {
          const distinct = c.isId ? c.counts.size : c.values.size;
          const out = { name: c.name, sensitive: c.sensitive, filled: c.filled, distinct, distinctIsLowerBound: c.overflow };
          if (c.duplicate) out.duplicateName = true;
          if (c.isId) {
            let multi = 0; let max = 0;
            for (const n of c.counts.values()) { if (n > 1) multi++; if (n > max) max = n; }
            out.id = { idsWithMultipleRows: multi, maxRowsPerId: max };
          }
          if (!c.sensitive) {
            if (!c.overflow && distinct <= enumMax) {
              const vals = c.isId ? [...c.counts.keys()] : [...c.values];
              out.values = vals.map((v) => v.slice(0, 80)).sort();
            }
            if (!c.shapesOverflow) out.shapes = Object.fromEntries(c.shapes);
          }
          return out;
        }),
      };
    },
  };
}

export function compareIdSets(openSets, completeSets) {
  const out = [];
  for (const [name, open] of openSets) {
    const complete = completeSets.get(name);
    if (!complete) continue;
    let missing = 0;
    for (const v of open) if (!complete.has(v)) missing++;
    out.push({ column: name, openDistinct: open.size, completeDistinct: complete.size, openMissingFromComplete: missing });
  }
  return out;
}

export function summarizeXml(text, top = 60) {
  const counts = new Map();
  for (const m of text.matchAll(/<([A-Za-z_][\w:.-]*)/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, top).map(([tag, n]) => ({ tag, n }));
}

async function fetchStream(url, { onChunk, timeoutMs = 600_000, maxBytes = 1_000_000_000 }) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const meta = { url, startedAt, warnings: [] };
  try {
    const head = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
    meta.head = { status: head.status, headers: pick(head.headers) };
  } catch (e) { meta.head = { error: String(e?.message ?? e) }; }
  let bytes = 0;
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    meta.status = res.status; meta.finalUrl = res.url; meta.headers = pick(res.headers);
    if (!res.ok) { meta.error = `HTTP ${res.status}`; return meta; }
    // An HTML body with status 200 is a maintenance/error page, not the source.
    if (/text\/html/i.test(meta.headers['content-type'] ?? '')) { meta.error = `unexpected content-type: ${meta.headers['content-type']}`; return meta; }
    if (new URL(res.url).host !== new URL(url).host) meta.warnings.push(`redirected to another host: ${new URL(res.url).host}`);
    const hash = createHash('sha256');
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) { meta.error = `aborted: exceeded ${maxBytes} bytes`; break; }
      hash.update(chunk); onChunk(chunk);
    }
    const declared = Number(meta.headers['content-length']);
    // fetch() transparently decompresses, so a length comparison only makes sense without Content-Encoding.
    // null = could not be checked; the report says so instead of implying the transfer was verified.
    meta.lengthMatchesHeader = meta.headers['content-encoding'] || !declared ? null : declared === bytes;
    if (!meta.error && meta.lengthMatchesHeader === false) meta.error = `truncated: ${bytes} bytes received, ${declared} declared`;
    // Size and hash describe the source only when the whole body was received.
    if (meta.error) meta.bytesReceived = bytes; else { meta.bytes = bytes; meta.sha256 = hash.digest('hex'); }
  } catch (e) { meta.error = String(e?.message ?? e); meta.bytesReceived = bytes; }
  finally { meta.durationMs = Date.now() - t0; }
  return meta;
}

function pick(headers) {
  return Object.fromEntries(REPORT_HEADERS.filter((h) => headers.get(h) !== null).map((h) => [h, headers.get(h)]));
}

async function probeCsv(url) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let header = null; let profiler = null; let parser = null;
  let buffered = ''; let first = true; let bom = false; let delimiter = ',';
  let invalidUtf8 = false; let decodeFailed = false;
  const onRow = (row) => {
    if (!header) { header = row.map((h) => h.trim()); profiler = createColumnProfiler(header); } else profiler.add(row);
  };
  const feed = (text) => {
    if (first) {
      buffered += text;
      if (buffered.length < 65_536) return;
      first = false; text = buffered; buffered = '';
      if (text.charCodeAt(0) === 0xfeff) { bom = true; text = text.slice(1); }
      delimiter = detectDelimiter(text);
      parser = createCsvParser(onRow, delimiter);
    }
    parser.write(text);
  };
  const meta = await fetchStream(url, {
    onChunk(chunk) {
      if (decodeFailed) return;
      try { feed(decoder.decode(chunk, { stream: true })); } catch { invalidUtf8 = true; decodeFailed = true; }
    },
  });
  if (!decodeFailed && !meta.error) {
    try { feed(decoder.decode()); } catch { invalidUtf8 = true; }
    if (first && buffered) { // file smaller than the detection window
      let text = buffered; if (text.charCodeAt(0) === 0xfeff) { bom = true; text = text.slice(1); }
      delimiter = detectDelimiter(text); parser = createCsvParser(onRow, delimiter); parser.write(text);
    }
  }
  const tail = parser ? parser.end() : { unterminatedQuote: false };
  // A source counts as fully parsed only if every byte arrived, decoded, and closed every quote.
  // Anything else is "incomplete": its statistics are partial and its IDs must not feed comparisons.
  const incomplete = [];
  if (meta.error) incomplete.push(meta.error);
  if (invalidUtf8) incomplete.push('invalid UTF-8');
  if (tail.unterminatedQuote) incomplete.push('unterminated quoted field');
  if (!header) incomplete.push('no header row');
  return {
    meta: { ...meta, invalidUtf8, bom, delimiter, unterminatedQuote: tail.unterminatedQuote, incomplete },
    header, profile: profiler ? { ...profiler.result(), partial: incomplete.length > 0 } : null,
    idSets: incomplete.length || !profiler ? new Map() : profiler.idSets(),
    idExcluded: profiler ? profiler.idExcluded() : [],
  };
}

async function probeXml(url) {
  const chunks = [];
  const meta = await fetchStream(url, { onChunk: (c) => chunks.push(Buffer.from(c)) });
  const buf = Buffer.concat(chunks);
  const incomplete = meta.error ? [meta.error] : [];
  return { meta: { ...meta, incomplete }, buf: incomplete.length ? Buffer.alloc(0) : buf, tags: incomplete.length ? [] : summarizeXml(buf.toString('utf8')) };
}

export function renderMarkdown(r) {
  const L = [`# Source probe report`, '', `Probed at ${r.probedAt} by \`scripts/probe-source.mjs\`. Structural facts only; interpretation lives in docs/source-verification.md.`, ''];
  for (const key of ['open', 'complete']) {
    const s = r.sources[key]; const m = s.meta;
    L.push(`## ${key} CSV`, '', `- URL: ${m.url}`, `- status: ${m.status ?? 'n/a'}${m.error ? ` — **${m.error}**` : ''}`,
      `- bytes: ${m.bytes ?? 'n/a'}${m.bytesReceived !== undefined ? ` (received before failure: ${m.bytesReceived}; no hash for a partial body)` : ''} · sha256: \`${m.sha256 ?? 'n/a'}\` · duration: ${m.durationMs} ms`,
      `- transfer length check: ${m.lengthMatchesHeader === true ? 'matches Content-Length' : m.lengthMatchesHeader === false ? 'MISMATCH' : 'not possible (Content-Encoding or no Content-Length): completeness of the body is not independently verified'}`,
      ...(m.warnings?.length ? [`- warnings: ${m.warnings.join('; ')}`] : []),
      `- headers: \`${JSON.stringify(m.headers ?? {})}\``, `- HEAD: \`${JSON.stringify(m.head)}\``,
      `- delimiter: \`${JSON.stringify(m.delimiter)}\` · BOM: ${m.bom} · invalid UTF-8: ${m.invalidUtf8} · unterminated quote: ${m.unterminatedQuote}`);
    if (m.incomplete?.length) L.push(`- **INCOMPLETE: ${m.incomplete.join('; ')}. Statistics below come from a partial parse and must not be used as facts.**`);
    if (s.profile) {
      L.push(`- rows: ${s.profile.rows} · ragged rows (length ≠ header): ${s.profile.ragged}`, '',
        '| # | column | filled | distinct | id: multi-row ids / max rows per id | values or shapes |', '|---|---|---|---|---|---|');
      s.profile.columns.forEach((c, i) => {
        const id = c.id ? `${c.id.idsWithMultipleRows} / ${c.id.maxRowsPerId}` : '';
        const vs = c.sensitive ? '_withheld (contact-like)_' : c.values ? `values: ${c.values.map((v) => `\`${v}\``).join(', ')}` : c.shapes ? `shapes: ${Object.entries(c.shapes).map(([k, n]) => `\`${k}\`×${n}`).join(', ')}` : '';
        L.push(`| ${i} | \`${c.name}\` | ${c.filled} | ${c.distinct}${c.distinctIsLowerBound ? '+' : ''} | ${id} | ${vs.replace(/\|/g, '\\|')} |`);
      });
    }
    L.push('');
  }
  L.push('## open vs complete', '');
  if (r.columnDiff) L.push(`- columns only in open: ${JSON.stringify(r.columnDiff.onlyInOpen)}`, `- columns only in complete: ${JSON.stringify(r.columnDiff.onlyInComplete)}`);
  else L.push(`- **column diff ${r.columnDiffSkipped ?? 'not computed'}**`);
  if (r.idComparisonExcluded?.length) L.push(`- id columns excluded from the comparison: ${r.idComparisonExcluded.map((e) => `${e.source}:\`${e.column}\` (${e.reason})`).join(', ')}`);
  if (r.idComparisonSkipped) L.push('', `- **ID comparison ${r.idComparisonSkipped}**`);
  else L.push('', '| id column | open distinct | complete distinct | open ids absent from complete |', '|---|---|---|---|');
  for (const c of r.idComparison) L.push(`| \`${c.column}\` | ${c.openDistinct} | ${c.completeDistinct} | ${c.openMissingFromComplete} |`);
  const d = r.sources.dictionary;
  L.push('', '## dictionary XML', '', `- status: ${d.meta.status ?? 'n/a'}${d.meta.error ? ` — **INCOMPLETE: ${d.meta.error}**` : ''} · bytes: ${d.meta.bytes ?? 'n/a'} · sha256: \`${d.meta.sha256 ?? 'n/a'}\``,
    `- headers: \`${JSON.stringify(d.meta.headers ?? {})}\``, `- top tags: ${d.tags.map((t) => `${t.tag}×${t.n}`).join(', ')}`, '');
  return L.join('\n');
}

// Files this script owns in the output directory. They are removed before any fetch so that a failed or
// crashed run can never leave a previous run's output next to (or instead of) its own report.
export const OUTPUT_FILES = ['report.json', 'report.md', 'dictionary.xml'];

export async function probe(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const f of OUTPUT_FILES) rmSync(join(outDir, f), { force: true });
  const probedAt = new Date().toISOString();
  const [open, complete, dictionary] = [await probeCsv(SOURCES.open), await probeCsv(SOURCES.complete), await probeXml(SOURCES.dictionary)];
  const oh = open.header ?? []; const ch = complete.header ?? [];
  const report = {
    probedAt,
    sources: {
      open: { meta: open.meta, header: open.header, profile: open.profile },
      complete: { meta: complete.meta, header: complete.header, profile: complete.profile },
      dictionary: { meta: dictionary.meta, tags: dictionary.tags },
    },
    columnDiff: null,
    columnDiffSkipped: null,
    idComparison: [],
    idComparisonSkipped: null,
    idComparisonExcluded: [],
  };
  const blocked = [['open', open], ['complete', complete]].filter(([, x]) => x.meta.incomplete.length);
  if (blocked.length) {
    // A header from a failed or cut transfer can be empty or truncated: no diff, no comparison.
    report.idComparisonSkipped = `not computed: ${blocked.map(([k, x]) => `${k} CSV incomplete (${x.meta.incomplete.join('; ')})`).join(', ')}`;
    report.columnDiffSkipped = report.idComparisonSkipped;
  } else {
    report.columnDiff = { onlyInOpen: oh.filter((h) => !ch.includes(h)), onlyInComplete: ch.filter((h) => !oh.includes(h)) };
    report.idComparison = compareIdSets(open.idSets, complete.idSets);
    report.idComparisonExcluded = [...open.idExcluded.map((e) => ({ source: 'open', ...e })), ...complete.idExcluded.map((e) => ({ source: 'complete', ...e }))];
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(outDir, 'report.md'), renderMarkdown(report));
  if (dictionary.buf.length) writeFileSync(join(outDir, 'dictionary.xml'), dictionary.buf);
  const failed = [open.meta, complete.meta, dictionary.meta].filter((m) => m.error || m.incomplete.length);
  return { report, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const outDir = i > 0 ? process.argv[i + 1] : 'probe-out';
  const { failed } = await probe(outDir);
  for (const m of failed) console.error(`FAILED ${m.url}: ${(m.incomplete?.length ? m.incomplete : [m.error]).join('; ')}`);
  console.error(`report written to ${outDir}/`);
  process.exit(failed.length ? 1 : 0);
}
