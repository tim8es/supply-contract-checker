import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argumentsFrom, batch } from '../scripts/analyze.mjs';

test('CLI flags support input/date/output with validation', () => {
  assert.deepEqual(argumentsFrom(['--input','documents','--date','2026-03-10']).date, '2026-03-10');
  assert.throws(() => argumentsFrom(['--date','bad-date']));
  assert.throws(() => argumentsFrom(['--bad','1']));
  assert.equal(argumentsFrom(['--help']).help, true);
});

test('batch processes real directory and serializes stable public fields', async () => {
  const { snapshot } = await batch({ input: 'documents', date: '2026-03-10' });
  assert.equal(snapshot.schemaVersion, '1.0');
  assert.equal(snapshot.contracts.length, 3);
  assert.equal(snapshot.contracts.find(x=>x.id==='STN-103').amount, null);
});

test('batch output can be consumed as JSON and does not require any network API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stn-batch-'));
  try {
    const source = join(dir, 'input');
    await mkdir(source);
    await writeFile(join(source, 'first.txt'), 'ДОГОВОР ПОСТАВКИ № ZYX-100\nСтатус: подписан обеими сторонами 01.03.2026.\n\nЦена договора: 150 000 рублей.');
    const path = join(dir, 'out', 'terms.json');
    await batch({ input: source, date: '2026-03-10', output: path });
    const data = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(data.contracts[0].amount.value, 150000);
    assert.equal(data.contracts[0].amount.evidence.file, 'first.txt');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('batch refuses empty input directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stn-empty-'));
  try { await assert.rejects(batch({input: dir, date:'2026-03-10'})); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
