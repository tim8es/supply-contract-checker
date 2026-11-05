import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, parseDocument, toIso } from '../src/engine.mjs';

const base = (body='Цена договора: 300 000 рублей.\nСрок поставки: 10.04.2026.', status='подписан обеими сторонами 01.02.2026') =>
  ({name:'base.txt', text:'ДОГОВОР ПОСТАВКИ № QWE-777\nСтатус: '+status+'\n\nПоставщик: ООО «Ромашка».\n\n'+body});
const amendment = (body='Цена договора: 600 000 рублей.', signed='01.03.2026', effective='01.03.2026', supplier='ООО «Ромашка»') =>
  ({name:'amend.txt', text:'ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ № 1 К ДОГОВОРУ QWE-777\nСтатус: подписано обеими сторонами '+signed+
     '\nПоставщик: '+supplier+'.\n\n'+body+'\nНастоящее соглашение вступает в силу '+effective+'.'});

test('date in natural Russian form resolves to ISO and retains original quote', () => {
  const row = analyze([base('Цена договора: 300 000 рублей.\nСрок поставки: 15 апреля 2026 года.')]).rows[0];
  assert.equal(row.deadline?.value, '2026-04-15');
  assert.match(row.deadline.evidence.quote, /15 апреля 2026 года/);
  assert.equal(toIso('29 февраля 2026 года'), null);
});

test('date of signing must precede review date even when effective date is retroactive', () => {
  const row = analyze([base(), amendment(undefined, '12.03.2026', '01.03.2026')], '2026-03-10').rows[0];
  assert.equal(row.amount.value, 300000);
  assert.ok(row.review.some(x => x.includes('Подписание допсоглашения')));
});

test('signed amendment without signature date cannot override', () => {
  const doc = amendment();
  doc.text = doc.text.replace('Статус: подписано обеими сторонами 01.03.2026','Статус: подписано обеими сторонами');
  const row = analyze([base(), doc]).rows[0];
  assert.equal(row.amount.value, 300000);
  assert.ok(row.review.some(x => x.includes('Подписание допсоглашения')));
});

test('party mismatch blocks an otherwise signed and effective amendment', () => {
  const row = analyze([base(), amendment(undefined, undefined, undefined, 'ООО «Другой поставщик»')]).rows[0];
  assert.equal(row.amount.value, 300000);
  assert.ok(row.review.some(x => x.includes('не совпадает')));
});

test('draft status is respected even without project prefix in heading', () => {
  const draft = { name:'unsigned.txt',
    text:'ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ № 2 К ДОГОВОРУ QWE-777\nСтатус: проект на согласовании, не подписан.\n\nОбщая стоимость поставки составляет 700 000 рублей.' };
  const result = analyze([base(), draft]);
  assert.equal(result.documents.find(x => x.name === 'unsigned.txt').kind, 'draft');
  assert.equal(result.rows[0].amount.value, 300000);
  assert.equal(result.rows[0].proposals[0].amount.value, 700000);
});

test('explicit contradiction of signature in document body requires review', () => {
  const doc = amendment();
  doc.text += '\n\nПо состоянию на дату проверки соглашение не подписано.';
  const row = analyze([base(), doc]).rows[0];
  assert.equal(row.amount.value, 300000);
  assert.ok(row.review.some(x => x.includes('не подтверждено')));
});

test('base contract signed after check date is flagged', () => {
  const row = analyze([base(undefined, 'подписан обеими сторонами 13.03.2026')], '2026-03-10').rows[0];
  assert.ok(row.review.some(x => x.includes('Дата подписания')));
});

test('different document number must never be linked by a supplier match', () => {
  const am = amendment();
  am.text = am.text.replace('QWE-777','QWE-778');
  const data = analyze([base(),am]);
  assert.equal(data.rows[0].amount.value, 300000);
  assert.ok(data.issues.some(x => x.includes('не связан')));
});
