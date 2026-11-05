import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { analyze, parseDocument, deliveriesBefore, toPublicResult, parseMoney, toIso } from '../src/engine.mjs';

const fixtureFiles = readdirSync(new URL('../documents/', import.meta.url))
  .filter(n => n.endsWith('.txt'))
  .map(name => ({ name, text: readFileSync(new URL('../documents/' + name, import.meta.url), 'utf8') }));
function contract(terms, id = 'QRS-500', status = 'подписан обеими сторонами 05.02.2026') {
  return { name: 'free-name.txt', text: 'ДОГОВОР ПОСТАВКИ № ' + id + '\nСтатус: ' + status + '\n\nПоставщик: ООО «Новый Контрагент».\n\n' + terms };
}
function amendment(terms, date = '01.03.2026', status = 'подписано обеими сторонами 01.03.2026', id = 'QRS-500') {
  return { name: 'an-unrelated-filename.txt', text: 'ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ № 3 К ДОГОВОРУ ' + id +
    '\nСтатус: ' + status + '\n\n' + terms + '\n\nНастоящее соглашение вступает в силу ' + date + '.' };
}
const amount = (row) => row.amount?.value ?? null;
const deadline = (row) => row.deadline?.value ?? null;

test('acceptance: exact answers to all four procurement questions', () => {
  const { rows, issues } = analyze(fixtureFiles, '2026-03-10');
  assert.equal(issues.length, 0);
  assert.deepEqual(rows.map(x => x.id), ['STN-101', 'STN-102', 'STN-103']);
  assert.deepEqual(rows.map(x => amount(x)), [1380000, 840000, null]);
  assert.deepEqual(rows.map(x => deadline(x)), ['2026-04-30', '2026-03-20', '2026-04-30']);
  assert.deepEqual(deliveriesBefore(rows).map(x => x.id), ['STN-102']);
  assert.equal(rows[0].proposals[0].deadline.value, '2026-05-10');
  assert.equal(rows[1].proposals[0].deadline.value, '2026-03-27');
  assert.equal(rows[0].amount.changedBy, '02_amendment_signed.txt');
});

test('provenance: values point to verbatim original substrings, including changed values', () => {
  const { rows } = analyze(fixtureFiles);
  for (const row of rows) {
    for (const field of ['amount','deadline']) {
      const data = row[field];
      if (!data) continue;
      const original = fixtureFiles.find(x => x.name === data.evidence.file);
      const originalLines = original.text.split(/\r?\n/);
      assert.equal(originalLines.slice(data.evidence.line - 1, data.evidence.endLine).join('\n'), data.evidence.quote);
      assert.ok(data.evidence.quote.length > 10);
    }
  }
});

test('new name and number never require code changes', () => {
  const row = analyze([contract('Цена договора — 987 654 рублей.\nСрок поставки: 19.03.2026.', 'ABC-204')]).rows[0];
  assert.equal(row.id, 'ABC-204');
  assert.equal(amount(row), 987654);
  assert.equal(deadline(row), '2026-03-19');
});

test('alternative price phrasing and comma decimal are accepted', () => {
  const row = analyze([contract('Общая сумма контракта установлена в размере 2 100 000,50 рублей.')]).rows[0];
  assert.equal(amount(row), 2100000.5);
});

test('price and deadline spanning physical lines retain exact quote', () => {
  const input = contract('Общая стоимость поставки\nсоставляет 1 777 000 рублей.\n\n' +
    'Поставщик обязуется поставить товар\nне позднее 17.04.2026.');
  const row = analyze([input]).rows[0];
  assert.equal(amount(row), 1777000);
  assert.equal(deadline(row), '2026-04-17');
  assert.match(row.amount.evidence.quote, /\n/);
  assert.equal(row.amount.evidence.quote, 'Общая стоимость поставки\nсоставляет 1 777 000 рублей.');
});

test('date phrasing "Поставка осуществляется до" works', () => {
  const row = analyze([contract('Поставка осуществляется до 21.04.2026.')]).rows[0];
  assert.equal(deadline(row), '2026-04-21');
});

test('unrelated dates: payment and acceptance do not become delivery', () => {
  const row = analyze([contract('Оплата не позднее 12.05.2026.\nДата приемки товара — 17.04.2026.')]).rows[0];
  assert.equal(deadline(row), null);
});

test('unrelated amounts: budget, advance and fines do not become contract price', () => {
  const row = analyze([contract('Лимит внутреннего бюджета — 600 000 рублей.\nАванс — 200 000 рублей.\nНеустойка 10% от суммы.')]).rows[0];
  assert.equal(amount(row), null);
});

test('missing specification does not invent contract amount', () => {
  const row = analyze([contract('Стоимость определяется приложением № 1, которое не представлено.')]).rows[0];
  assert.equal(amount(row), null);
  assert.ok(row.review.some(s => s.includes('Стоимость не установлена')));
});

test('signed effective amendment overrides only fields it actually changes', () => {
  const row = analyze([contract('Общая стоимость поставки составляет 500 000 рублей.\nСрок поставки: 10.04.2026.'),
    amendment('Цена договора — 750 000 рублей.')]).rows[0];
  assert.equal(amount(row), 750000);
  assert.equal(deadline(row), '2026-04-10');
});

test('future effective amendment is ignored for earlier review date', () => {
  const input = [contract('Цена договора: 400 000 рублей.'), amendment('Цена договора: 900 000 рублей.', '11.03.2026')];
  assert.equal(amount(analyze(input, '2026-03-10').rows[0]), 400000);
  assert.equal(amount(analyze(input, '2026-03-11').rows[0]), 900000);
});

test('missing effective date leaves agreement unapplied and creates a review issue', () => {
  const modified = amendment('Цена договора: 900 000 рублей.');
  modified.text = modified.text.replace(/\nНастоящее соглашение вступает в силу.*/, '');
  const row = analyze([contract('Цена договора: 400 000 рублей.'), modified]).rows[0];
  assert.equal(amount(row), 400000);
  assert.ok(row.review.some(s => s.includes('дата вступления')));
});

test('one-sided or unsigned amendment is never applied', () => {
  const altered = amendment('Цена договора: 800 000 рублей.', '01.03.2026', 'подписано одной стороной');
  const row = analyze([contract('Цена договора: 400 000 рублей.'), altered]).rows[0];
  assert.equal(amount(row), 400000);
  assert.ok(row.review.some(s => s.includes('не подтверждено')));
});

test('contradictory signed amendments on the same date cannot silently win', () => {
  const row = analyze([contract('Цена договора: 400 000 рублей.'),
    amendment('Цена договора: 800 000 рублей.'),
    { ...amendment('Цена договора: 950 000 рублей.'), name: 'second.txt' }]).rows[0];
  assert.equal(amount(row), null);
  assert.ok(row.review.some(s => s.includes('Противоречащие')));
});

test('two contradictory explicit prices in original document are ambiguous', () => {
  const row = analyze([contract('Общая стоимость поставки составляет 700 000 рублей.\n\n' +
    'Общая стоимость поставки составляет 900 000 рублей.')]).rows[0];
  assert.equal(amount(row), null);
  assert.ok(row.review.some(s => s.includes('Неоднозначная сумма')));
});

test('invalid impossible dates must never enter the result', () => {
  const row = analyze([contract('Срок поставки: 31.02.2026.')]).rows[0];
  assert.equal(deadline(row), null);
  assert.equal(toIso('31.02.2026'), null);
});

test('proposed deadline does not overwrite executed term', () => {
  const docs = [contract('Срок поставки: 20.03.2026.'), {
    name:'email-2.txt',
    text:'ПИСЬМО ПОСТАВЩИКА\nТема: договор QRS-500\n\nПредлагаем перенести срок поставки с 20.03.2026 на 27.03.2026.'
  }];
  const row = analyze(docs).rows[0];
  assert.equal(deadline(row), '2026-03-20');
  assert.equal(row.proposals[0].deadline?.value, '2026-03-27');
});

test('unmatched and unknown documents are surfaced rather than dropped', () => {
  const input = [{ name:'orphan.txt', text:'ПИСЬМО\nПо договору XYZ-999 предлагаем перенести срок поставки на 01.05.2026.' },
    { name:'unknown.txt', text:'ПРОТОКОЛ\nНеизвестное содержание' }];
  const data = analyze(input);
  assert.equal(data.rows.length, 0);
  assert.ok(data.issues.length >= 2);
});

test('duplicate base document is reported', () => {
  const input = contract('Цена договора: 100 000 рублей.');
  const data = analyze([input, { ...input, name:'duplicate.txt' }]);
  assert.equal(data.rows.length, 1);
  assert.ok(data.issues.some(x => x.includes('Дубликат')));
});

test('JSON schema export contains no raw documents, can be consumed by integrators', () => {
  const snap = toPublicResult(analyze([contract('Цена договора: 400 000 рублей.')]));
  const serialized = JSON.stringify(snap);
  assert.equal(snap.schemaVersion, '1.0');
  assert.ok(serialized.includes('400000'));
  assert.ok(!serialized.includes('documentCountOverride'));
  assert.equal(typeof snap.documentCount, 'number');
});

test('files in random order yield identical interpreted terms', () => {
  const a = analyze(fixtureFiles);
  const b = analyze([...fixtureFiles].reverse());
  const selected = data => data.rows.map(row => [row.id, row.amount?.value, row.deadline?.value]);
  assert.deepEqual(selected(a), selected(b));
});

test('basic input validation', () => {
  assert.throws(() => analyze([], 'not-a-date'));
  assert.throws(() => parseDocument({name: 'a.txt', text: null}));
  assert.equal(parseMoney('999 999,50'), 999999.5);
});
