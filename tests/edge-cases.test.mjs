import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/engine.mjs';

const contract = {
  name:'contract.txt',
  text:'ДОГОВОР ПОСТАВКИ № RST-200\nСтатус: подписан обеими сторонами 01.02.2026.\n\nПоставщик: ООО «ТехКомплект».\n\nЦена договора: 700 000 рублей.\nСрок поставки: 20.03.2026.'
};

test('proposal of old and new amounts selects new amount, never old', () => {
  const letter = {name:'letter.txt',text:'ПИСЬМО ПОСТАВЩИКА\nТема: договор RST-200\n\nПредлагаем изменить сумму договора с 700 000 рублей на 900 000 рублей.'};
  const row = analyze([contract, letter]).rows[0];
  assert.equal(row.amount.value, 700000);
  assert.equal(row.proposals[0].amount?.value, 900000);
});

test('proposal of delivery date prefers new date despite later status date', () => {
  const letter = {name:'letter.txt',text:'ПИСЬМО ПОСТАВЩИКА\nТема: договор RST-200\n\nПредлагаем перенести срок поставки с 20.03.2026 на 27.03.2026. По состоянию на 10.03.2026 соглашение не подписано.'};
  const row = analyze([contract, letter]).rows[0];
  assert.equal(row.deadline.value, '2026-03-20');
  assert.equal(row.proposals[0].deadline?.value, '2026-03-27');
});

test('duplicate signed base contracts cannot silently determine active terms', () => {
  const duplicate = { ...contract, name:'second.txt', text:contract.text.replace('700 000','900 000') };
  const row = analyze([contract, duplicate]).rows[0];
  assert.equal(row.amount, null);
  assert.equal(row.deadline, null);
  assert.ok(row.review.some(s=>s.includes('Дубликат')));
});

test('ambiguous same contract clauses require manual review', () => {
  const conflicting = { ...contract, text:contract.text+'\nОбщая стоимость поставки составляет 800 000 рублей.' };
  const row = analyze([conflicting]).rows[0];
  assert.equal(row.amount, null);
  assert.ok(row.review.some(x=>x.includes('Неоднозначная сумма')));
});
