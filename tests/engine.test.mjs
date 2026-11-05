import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { analyze, deliveriesBefore } from '../src/engine.mjs';

const inputs = readdirSync(new URL('../documents/', import.meta.url)).filter(name => name.endsWith('.txt'))
  .map(name => ({ name, text: readFileSync(new URL('../documents/' + name, import.meta.url), 'utf8') }));

test('signed amendments apply; drafts and supplier letters do not', () => {
  const data = analyze(inputs);
  assert.equal(data.rows.length, 3);
  const [a, b, c] = data.rows;
  assert.equal(a.id, 'STN-101');
  assert.equal(a.amount.value, 1380000);
  assert.equal(a.deadline.value, '2026-04-30');
  assert.equal(a.amount.changedBy, '02_amendment_signed.txt');
  assert.equal(a.proposals[0].amount.value, 1450000);
  assert.equal(a.proposals[0].deadline.value, '2026-05-10');
  assert.equal(b.id, 'STN-102');
  assert.equal(b.amount.value, 840000);
  assert.equal(b.deadline.value, '2026-03-20');
  assert.equal(b.proposals[0].deadline.value, '2026-03-27');
  assert.equal(c.id, 'STN-103');
  assert.equal(c.amount, null);
  assert.equal(c.deadline.value, '2026-04-30');
  assert.deepEqual(deliveriesBefore(data.rows).map(row => row.id), ['STN-102']);
});

test('evidence is exact original line with file and line number', () => {
  const result = analyze(inputs);
  for (const row of result.rows) for (const field of ['amount','deadline']) {
    if (!row[field]) continue;
    const source = inputs.find(doc => doc.name === row[field].evidence.file);
    assert.equal(source.text.split(/\r?\n/)[row[field].evidence.line - 1], row[field].evidence.quote);
  }
});

test('changed field in newly uploaded contract is parsed; no filename shortcuts', () => {
  const text = 'ДОГОВОР ПОСТАВКИ № ABC-204\nСтатус: подписан обеими сторонами 10.03.2026.\n' +
    'Поставщик: ООО «Новый поставщик».\nОбщая стоимость поставки составляет 987 654 рублей.\n' +
    'Поставщик обязуется поставить товар не позднее 19.03.2026.';
  const { rows } = analyze([{ name: 'renamed_file.txt', text }]);
  assert.equal(rows[0].id, 'ABC-204');
  assert.equal(rows[0].amount.value, 987654);
  assert.equal(rows[0].deadline.value, '2026-03-19');
});

test('future signed amendment does not replace the original', () => {
  const base = inputs.find(item => item.name === '01_contract.txt');
  const signed = inputs.find(item => item.name === '02_amendment_signed.txt');
  assert.equal(analyze([base, signed], '2026-02-28').rows[0].amount.value, 1200000);
  assert.equal(analyze([base, signed], '2026-03-10').rows[0].amount.value, 1380000);
});

test('unsigned amendment and missing values are conservative', () => {
  const base = { name: 'plain.txt', text: 'ДОГОВОР ПОСТАВКИ № NEW-555\nСтатус: подписан обеими сторонами 01.03.2026.\nЛимит закупки — 600 000 рублей.' };
  const draft = { name: 'draft.txt', text: 'ПРОЕКТ ДОПОЛНИТЕЛЬНОГО СОГЛАШЕНИЯ № 2 К ДОГОВОРУ NEW-555\nСтатус: не подписан ни одной стороной.\nПредлагается изменить общую стоимость поставки на 700 000 рублей.' };
  const row = analyze([base, draft]).rows[0];
  assert.equal(row.amount, null);
  assert.equal(row.deadline, null);
  assert.equal(row.proposals[0].amount.value, 700000);
});

test('conflicting signed amendments on the same date require review', () => {
  const base = inputs.find(item => item.name === '01_contract.txt');
  const amend = inputs.find(item => item.name === '02_amendment_signed.txt');
  const conflict = { name: 'conflict.txt', text: amend.text.replace('1 380 000', '1 990 000') };
  const row = analyze([base, amend, conflict]).rows[0];
  assert.equal(row.amount, null);
  assert.ok(row.review.some(item => item.includes('Противоречащие')));
});
