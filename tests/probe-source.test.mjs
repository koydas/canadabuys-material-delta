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
