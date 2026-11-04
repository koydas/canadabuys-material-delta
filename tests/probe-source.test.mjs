import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCsvParser, detectDelimiter, shapeOf, createColumnProfiler, compareIdSets, summarizeXml, renderMarkdown,
} from '../scripts/probe-source.mjs';

const parse = (chunks, delimiter = ',') => {
  const rows = [];
  const p = createCsvParser((r) => rows.push(r), delimiter);
  for (const c of chunks) p.write(c);
  const tail = p.end();
  return { rows, tail };
};

test('parser: quotes, escaped quotes, embedded newline and CRLF', () => {
  const { rows } = parse(['a,"b,1","say ""hi""",c\r\n"x\ny",,z\r\n']);
  assert.deepEqual(rows, [['a', 'b,1', 'say "hi"', 'c'], ['x\ny', '', 'z']]);
});

test('parser: result is independent of chunk boundaries (mid-quote and mid-escape)', () => {
  const text = 'h1,h2\n"a ""q"" b",2\n3,"x\ny"\n';
  const whole = parse([text]).rows;
  for (let cut = 1; cut < text.length; cut++) assert.deepEqual(parse([text.slice(0, cut), text.slice(cut)]).rows, whole, `cut ${cut}`);
});

test('parser: no trailing newline, blank lines skipped, trailing delimiter keeps empty field', () => {
  assert.deepEqual(parse(['a,b\n\n1,2,\n3,4']).rows, [['a', 'b'], ['1', '2', ''], ['3', '4']]);
});

test('parser: unterminated quote is reported, not silently accepted', () => {
  const { rows, tail } = parse(['a,b\n1,"oops\n2,3']);
  assert.equal(tail.unterminatedQuote, true);
  assert.equal(rows.length, 2);
});

test('parser: custom delimiter', () => {
  assert.deepEqual(parse(['a;b\n1;"2;3"\n'], ';').rows, [['a', 'b'], ['1', '2;3']]);
});

test('detectDelimiter ignores delimiters inside quotes', () => {
  assert.equal(detectDelimiter('"a;b;c",d,e\n1,2,3'), ',');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc\n'), '\t');
});

test('shapeOf masks digits and letters, truncates', () => {
  assert.equal(shapeOf('2026-11-10T15:00:00'), '9999-99-99T99:99:99');
  assert.equal(shapeOf('Open ouvert'), 'a a');
  assert.equal(shapeOf('x'.repeat(100)).length, 1); // letter run collapses
  assert.ok(shapeOf('9'.repeat(100)).length <= 40);
});

test('profiler: fill, distinct, ragged rows, enum values and shapes', () => {
  const p = createColumnProfiler(['status', 'closing']);
  p.add(['Open', '2026-11-10']); p.add(['Open', '2026-11-11']); p.add(['Closed', '']); p.add(['Closed']);
  const r = p.result();
  assert.equal(r.rows, 4); assert.equal(r.ragged, 1);
  const [status, closing] = r.columns;
  assert.deepEqual(status.values, ['Closed', 'Open']);
  assert.equal(status.filled, 4); assert.equal(closing.filled, 2);
  assert.deepEqual(closing.shapes, { '9999-99-99': 2 });
});

test('profiler: contact-like columns never expose values or shapes', () => {
  const p = createColumnProfiler(['contactEmail-courriel', 'Telephone', 'title']);
  p.add(['jane@example.org', '555-0100', 'Paper']);
  const out = JSON.stringify(p.result());
  assert.ok(!out.includes('jane@example.org')); assert.ok(!out.includes('555'));
  const [email, phone, title] = p.result().columns;
  assert.equal(email.sensitive, true); assert.equal(phone.sensitive, true);
  assert.equal(email.values, undefined); assert.equal(email.shapes, undefined);
  assert.deepEqual(title.values, ['Paper']);
});

test('profiler: id columns report multi-row ids; enum suppressed above enumMax', () => {
  const p = createColumnProfiler(['referenceNumber', 'note'], { enumMax: 2 });
  for (const [id, n] of [['A', '1'], ['A', '2'], ['B', '3']]) p.add([id, n]);
  const [id, note] = p.result().columns;
  assert.deepEqual(id.id, { idsWithMultipleRows: 1, maxRowsPerId: 2 });
  assert.equal(id.distinct, 2);
  assert.equal(note.distinct, 3); assert.equal(note.values, undefined);
});

test('profiler: cap overflow marks distinct as lower bound', () => {
  const p = createColumnProfiler(['note'], { cap: 2 });
  ['a', 'b', 'c', 'a'].forEach((v) => p.add([v]));
  const c = p.result().columns[0];
  assert.equal(c.distinct, 2); assert.equal(c.distinctIsLowerBound, true); assert.equal(c.values, undefined);
});

test('compareIdSets counts open ids absent from complete, only for shared columns', () => {
  const open = new Map([['ref', new Set(['a', 'b'])], ['only', new Set(['x'])]]);
  const complete = new Map([['ref', new Set(['a', 'c', 'd'])]]);
  assert.deepEqual(compareIdSets(open, complete), [{ column: 'ref', openDistinct: 2, completeDistinct: 3, openMissingFromComplete: 1 }]);
});

test('summarizeXml counts tags', () => {
  assert.deepEqual(summarizeXml('<a><b/><b/></a>'), [{ tag: 'b', n: 2 }, { tag: 'a', n: 1 }]);
});

test('renderMarkdown surfaces errors and withholds sensitive columns', () => {
  const p = createColumnProfiler(['contact', 'status']); p.add(['secret', 'Open']);
  const meta = { url: 'u', status: 200, bytes: 1, sha256: 'h', durationMs: 1, headers: {}, head: {} };
  const src = (m) => ({ meta: m, profile: p.result() });
  const md = renderMarkdown({
    probedAt: 't',
    sources: { open: src(meta), complete: src({ ...meta, status: 403, error: 'HTTP 403' }), dictionary: { meta: { ...meta }, tags: [] } },
    columnDiff: { onlyInOpen: [], onlyInComplete: [] }, idComparison: [],
  });
  assert.ok(md.includes('HTTP 403')); assert.ok(md.includes('withheld')); assert.ok(!md.includes('secret'));
});

test('probe end-to-end against a local server: BOM + small file path, HTTP error, report files', async () => {
  const { createServer } = await import('node:http');
  const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { SOURCES, probe } = await import('../scripts/probe-source.mjs');
  const open = '﻿referenceNumber;status;closing;courriel\nA1;Open;2026-11-10T15:00:00;a@b.c\nA1;Open;2026-11-12T15:00:00;a@b.c\n';
  const complete = 'referenceNumber;status;closing;courriel\nA1;Closed;2026-11-12T15:00:00;a@b.c\nB2;Closed;2026-01-01T00:00:00;x@y.z\n';
  const server = createServer((req, res) => {
    if (req.url === '/open') { res.writeHead(200, { 'content-type': 'text/csv' }); res.end(open); }
    else if (req.url === '/complete') { res.writeHead(200, { 'content-type': 'text/csv' }); res.end(complete); }
    else { res.writeHead(403); res.end('no'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const saved = { ...SOURCES };
  Object.assign(SOURCES, { open: `${base}/open`, complete: `${base}/complete`, dictionary: `${base}/dict` });
  try {
    const out = mkdtempSync(join(tmpdir(), 'probe-'));
    const { report, failed } = await probe(out);
    assert.equal(report.sources.open.meta.bom, true);
    assert.equal(report.sources.open.meta.delimiter, ';');
    assert.equal(report.sources.open.profile.rows, 2);
    assert.deepEqual(report.sources.open.header, ['referenceNumber', 'status', 'closing', 'courriel']);
    const ref = report.sources.open.profile.columns[0];
    assert.deepEqual(ref.id, { idsWithMultipleRows: 1, maxRowsPerId: 2 });
    assert.deepEqual(report.idComparison, [{ column: 'referenceNumber', openDistinct: 1, completeDistinct: 2, openMissingFromComplete: 0 }]);
    assert.equal(failed.length, 1); assert.match(failed[0].error, /403/);
    assert.ok(existsSync(join(out, 'report.json')) && !existsSync(join(out, 'dictionary.xml')));
    assert.ok(!readFileSync(join(out, 'report.md'), 'utf8').includes('a@b.c'));
    assert.ok(!readFileSync(join(out, 'report.json'), 'utf8').includes('a@b.c'));
  } finally { Object.assign(SOURCES, saved); server.close(); }
});

// --- regression: a source that was not fully parsed must not feed the cross-feed comparison (review P2) ---
async function runProbe(routes, outDir) {
  const { createServer } = await import('node:http');
  const { mkdtempSync, existsSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { SOURCES, probe } = await import('../scripts/probe-source.mjs');
  const server = createServer((req, res) => (routes[req.url] ?? ((_, r) => { r.writeHead(404); r.end(); }))(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const saved = { ...SOURCES };
  Object.assign(SOURCES, { open: `${base}/open`, complete: `${base}/complete`, dictionary: `${base}/dict` });
  try {
    const out = outDir ?? mkdtempSync(join(tmpdir(), 'probe-'));
    const { report, failed } = await probe(out);
    return { report, failed, md: readFileSync(join(out, 'report.md'), 'utf8'), hasDict: existsSync(join(out, 'dictionary.xml')) };
  } finally { Object.assign(SOURCES, saved); server.close(); }
}
const ok = (body) => (_, res) => { res.writeHead(200); res.end(body); };
const bigRows = Array.from({ length: 12_000 }, (_, i) => `N${i},Open`).join('\n'); // > 64 KiB detection window
const HDR = 'referenceNumber,status\n';
const OPEN = HDR + 'TARGET,Open\n';

test('probe: invalid UTF-8 after the detection window -> complete feed incomplete, no absence counts', async () => {
  const complete = Buffer.concat([Buffer.from(HDR + bigRows + '\n'), Buffer.from([0xff]), Buffer.from('\nTARGET,Open\n')]);
  const { report, failed, md } = await runProbe({ '/open': ok(OPEN), '/complete': ok(complete), '/dict': ok('<a/>') });
  assert.deepEqual(report.idComparison, []);
  assert.match(report.idComparisonSkipped, /complete CSV incomplete \(invalid UTF-8\)/);
  assert.ok(failed.some((m) => m.incomplete.includes('invalid UTF-8')));
  assert.match(md, /INCOMPLETE: invalid UTF-8/); assert.match(md, /ID comparison not computed/);
  assert.ok(!md.includes('absent from complete |'));
});

test('probe: invalid UTF-8 inside the first window -> incomplete, no header', async () => {
  const bad = Buffer.concat([Buffer.from(HDR), Buffer.from([0xff]), Buffer.from('\n')]);
  const { report, failed } = await runProbe({ '/open': ok(bad), '/complete': ok(OPEN), '/dict': ok('<a/>') });
  assert.deepEqual(report.sources.open.meta.incomplete, ['invalid UTF-8', 'no header row']);
  assert.match(report.idComparisonSkipped, /open CSV incomplete/);
  assert.equal(failed.length, 1);
});

test('probe: transfer cut after parsing began -> incomplete, comparison skipped', async () => {
  const cut = (_, res) => { res.writeHead(200); res.write(HDR + bigRows + '\n'); setTimeout(() => res.socket.destroy(), 50); };
  const { report, failed } = await runProbe({ '/open': ok(OPEN), '/complete': cut, '/dict': ok('<a/>') });
  assert.ok(report.sources.complete.meta.error);
  assert.ok(report.sources.complete.meta.incomplete.length >= 1);
  assert.match(report.idComparisonSkipped, /complete CSV incomplete/);
  assert.deepEqual(report.idComparison, []);
  assert.ok(failed.length >= 1);
});

test('probe: unterminated quoted field -> incomplete, comparison skipped', async () => {
  const { report } = await runProbe({ '/open': ok(OPEN), '/complete': ok(HDR + 'TARGET,"Open\n'), '/dict': ok('<a/>') });
  assert.deepEqual(report.sources.complete.meta.incomplete, ['unterminated quoted field']);
  assert.match(report.idComparisonSkipped, /unterminated quoted field/);
});

test('probe: empty body -> no header row, comparison skipped', async () => {
  const { report } = await runProbe({ '/open': ok(OPEN), '/complete': ok(''), '/dict': ok('<a/>') });
  assert.deepEqual(report.sources.complete.meta.incomplete, ['no header row']);
  assert.ok(report.idComparisonSkipped);
});

test('probe: both feeds complete -> comparison computed, nothing skipped', async () => {
  const { report, failed } = await runProbe({ '/open': ok(OPEN), '/complete': ok(HDR + 'TARGET,Closed\n'), '/dict': ok('<a/>') });
  assert.equal(report.idComparisonSkipped, null);
  assert.deepEqual(report.idComparison, [{ column: 'referenceNumber', openDistinct: 1, completeDistinct: 1, openMissingFromComplete: 0 }]);
  assert.equal(failed.length, 0);
});

test('probe: truncated dictionary is neither parsed nor written as dictionary.xml', async () => {
  const cut = (_, res) => { res.writeHead(200); res.write('<dictionary><field/>'); setTimeout(() => res.socket.destroy(), 50); };
  const { report, hasDict } = await runProbe({ '/open': ok(OPEN), '/complete': ok(OPEN), '/dict': cut });
  assert.equal(hasDict, false);
  assert.deepEqual(report.sources.dictionary.tags, []);
  assert.ok(report.sources.dictionary.meta.incomplete.length >= 1);
});

test('probe: outputs of a previous run in the same directory are never left behind (review P2)', async () => {
  const { mkdtempSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const out = mkdtempSync(join(tmpdir(), 'probe-'));
  const cut = (_, res) => { res.writeHead(200); res.write('<dictionary>'); setTimeout(() => res.socket.destroy(), 50); };
  const routes = { '/open': ok(OPEN), '/complete': ok(OPEN) };

  const first = await runProbe({ ...routes, '/dict': ok('<dictionary><field/></dictionary>') }, out);
  assert.equal(first.hasDict, true);
  writeFileSync(join(out, 'report.json'), 'STALE'); writeFileSync(join(out, 'report.md'), 'STALE');

  const second = await runProbe({ ...routes, '/dict': cut }, out);
  assert.equal(second.hasDict, false, 'previous dictionary.xml must be removed');
  assert.ok(!second.md.includes('STALE'));
  assert.ok(!readFileSync(join(out, 'report.json'), 'utf8').includes('STALE'));
  assert.ok(second.report.sources.dictionary.meta.incomplete.length >= 1);
  assert.ok(existsSync(join(out, 'report.md')));
});

test('probe: stale outputs are removed when every source fails', async () => {
  const { mkdtempSync, writeFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { SOURCES, probe, OUTPUT_FILES } = await import('../scripts/probe-source.mjs');
  const out = mkdtempSync(join(tmpdir(), 'probe-'));
  for (const f of OUTPUT_FILES) writeFileSync(join(out, f), 'STALE');
  const saved = { ...SOURCES };
  Object.assign(SOURCES, { open: 'not a url', complete: 'not a url', dictionary: 'not a url' });
  try { await probe(out); } finally { Object.assign(SOURCES, saved); }
  // fetch errors are caught per source, so a report exists but must be this run's, with no stale dictionary
  assert.equal(existsSync(join(out, 'dictionary.xml')), false);
  assert.ok(!(await import('node:fs')).readFileSync(join(out, 'report.md'), 'utf8').includes('STALE'));
});

// --- audit pass: nothing partial, ambiguous or unverifiable is reported as an observed fact ---
test('audit: failed source -> no column diff (an empty header is not "all columns missing")', async () => {
  const { report, md } = await runProbe({ '/open': ok(OPEN), '/complete': (_, r) => { r.writeHead(404); r.end(); }, '/dict': ok('<a/>') });
  assert.equal(report.columnDiff, null);
  assert.match(report.columnDiffSkipped, /complete CSV incomplete/);
  assert.ok(!md.includes('columns only in complete'));
});

test('audit: transfer cut inside the header line -> truncated header never reaches a diff', async () => {
  const cut = (_, res) => { res.writeHead(200); res.write('referenceNumber,sta'); setTimeout(() => res.socket.destroy(), 50); };
  const { report } = await runProbe({ '/open': ok(OPEN), '/complete': cut, '/dict': ok('<a/>') });
  assert.equal(report.columnDiff, null);
  assert.ok(report.sources.complete.meta.incomplete.length >= 1);
});

test('audit: partial body has no size/hash; complete body hash and size are exact; length check is stated', async () => {
  const { createHash } = await import('node:crypto');
  const cut = (_, res) => { res.writeHead(200); res.write(HDR + 'TARGET,Open\n'); setTimeout(() => res.socket.destroy(), 50); };
  const partial = await runProbe({ '/open': ok(OPEN), '/complete': cut, '/dict': ok('<a/>') });
  const pm = partial.report.sources.complete.meta;
  assert.equal(pm.sha256, undefined); assert.equal(pm.bytes, undefined); assert.equal(typeof pm.bytesReceived, 'number');
  assert.match(partial.md, /no hash for a partial body/);

  const withLength = (_, res) => { res.writeHead(200, { 'content-length': Buffer.byteLength(OPEN) }); res.end(OPEN); };
  const full = await runProbe({ '/open': withLength, '/complete': ok(OPEN), '/dict': ok('<a/>') });
  const fm = full.report.sources.open.meta;
  assert.equal(fm.bytes, Buffer.byteLength(OPEN));
  assert.equal(fm.sha256, createHash('sha256').update(OPEN).digest('hex'));
  assert.equal(fm.lengthMatchesHeader, true);
  assert.match(full.md, /matches Content-Length/);
});

test('audit: chunked body without Content-Length -> report says completeness is not independently verified', async () => {
  const chunked = (_, res) => { res.writeHead(200); res.write(OPEN.slice(0, 5)); res.end(OPEN.slice(5)); };
  const { report, md } = await runProbe({ '/open': chunked, '/complete': ok(OPEN), '/dict': ok('<a/>') });
  assert.equal(report.sources.open.meta.lengthMatchesHeader, null);
  assert.match(md, /not independently verified/);
});

test('audit: HTTP 200 with an HTML body is not parsed as the source', async () => {
  const html = (_, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<html>Maintenance</html>'); };
  const { report, failed } = await runProbe({ '/open': ok(OPEN), '/complete': html, '/dict': html });
  assert.match(report.sources.complete.meta.error, /unexpected content-type/);
  assert.equal(report.sources.complete.header, null);
  assert.equal(report.sources.dictionary.tags.length, 0);
  assert.equal(failed.length, 2);
});

test('audit: redirect to another host is reported as a warning, data still observed', async () => {
  const redirect = (req, res) => { res.writeHead(302, { location: `http://localhost:${req.socket.localPort}/real` }); res.end(); };
  const { report, md } = await runProbe({ '/open': redirect, '/real': ok(OPEN), '/complete': ok(OPEN), '/dict': ok('<a/>') });
  assert.match(report.sources.open.meta.warnings[0], /redirected to another host: localhost:/);
  assert.equal(report.sources.open.meta.incomplete.length, 0);
  assert.match(md, /warnings: redirected to another host/);
});

test('audit: duplicate column names are excluded from the comparison and listed, not silently overwritten', async () => {
  const dup = 'referenceNumber,referenceNumber,status\nA,B,Open\n';
  const { report, md } = await runProbe({ '/open': ok(dup), '/complete': ok(HDR + 'A,Open\n'), '/dict': ok('<a/>') });
  assert.deepEqual(report.idComparison, []);
  assert.deepEqual(report.idComparisonExcluded, [{ source: 'open', column: 'referenceNumber', reason: 'duplicate column name' }, { source: 'open', column: 'referenceNumber', reason: 'duplicate column name' }]);
  assert.match(md, /id columns excluded from the comparison/);
  assert.equal(report.sources.open.profile.columns[0].duplicateName, true);
});

test('audit: id column over the cardinality cap is excluded and listed', () => {
  const p = createColumnProfiler(['referenceNumber'], { idCap: 2 });
  ['a', 'b', 'c'].forEach((v) => p.add([v]));
  assert.equal(p.idSets().size, 0);
  assert.deepEqual(p.idExcluded(), [{ column: 'referenceNumber', reason: 'distinct-value cap reached' }]);
});

test('audit: report.json marks a partial profile; a complete one is not marked', async () => {
  const bad = Buffer.concat([Buffer.from(HDR + bigRows + '\n'), Buffer.from([0xff]), Buffer.from('\n')]);
  const partial = await runProbe({ '/open': ok(OPEN), '/complete': ok(bad), '/dict': ok('<a/>') });
  assert.equal(partial.report.sources.complete.profile.partial, true);
  assert.equal(partial.report.sources.open.profile.partial, false);
});
