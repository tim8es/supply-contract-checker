import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/engine.mjs';

const base = (body = 'Общая стоимость поставки составляет 1 200 000 рублей.\nСрок поставки: 15.04.2026.') =>
 ({name:'contract.txt',text:'ДОГОВОР ПОСТАВКИ № RSK-801\nСтатус: подписан обеими сторонами 01.02.2026.\n\nПоставщик: ООО «Резонанс».\n\n'+body});
const amendment = (body, date='01.03.2026', name='amendment.txt') =>
 ({name,text:'ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ № 5 К ДОГОВОРУ RSK-801\nСтатус: подписано обеими сторонами 01.03.2026.\n\n'+body+'\n\nНастоящее соглашение вступает в силу '+date+'.'});
const select = docs => analyze(docs,'2026-03-10').rows[0];

test('signed amendment changes amount FROM old TO new, not the first monetary value',()=>{
 const row = select([base(), amendment('Сумма договора изменяется с 1 200 000 рублей на 1 380 000 рублей.')]);
 assert.equal(row.amount?.value,1380000);
 assert.equal(row.amount.changedBy,'amendment.txt');
 assert.equal(row.deadline?.value,'2026-04-15');
});

test('signed amendment changes deadline FROM old TO new, not the first date',()=>{
 const row=select([base(),amendment('Перенести срок поставки с 15.04.2026 на 30.04.2026.')]);
 assert.equal(row.deadline?.value,'2026-04-30');
 assert.equal(row.deadline.changedBy,'amendment.txt');
});

test('signed amendment that explicitly changes amount but does not provide parseable number invalidates old amount',()=>{
 const row=select([base(),amendment('Общая стоимость поставки теперь определяется спецификацией № 2, не приложенной к материалам.')]);
 assert.equal(row.amount,null);
 assert.ok(row.review.some(x=>/изменени[ея]|определить|неоднознач/iu.test(x)));
 assert.equal(row.deadline?.value,'2026-04-15');
});

test('signed amendment with conflicting new prices must not keep stale base price',()=>{
 const row=select([base(),amendment('Общая стоимость поставки составляет 1 380 000 рублей.\n\nОбщая стоимость поставки составляет 1 410 000 рублей.')]);
 assert.equal(row.amount,null);
 assert.ok(row.review.some(x=>/неоднознач|изменени[ея]|противореч/iu.test(x)));
});

test('signed amendment that updates deadline with no explicit date must not keep the old deadline',()=>{
 const row=select([base(),amendment('Срок поставки изменён. Новый срок определяется утверждённым календарным графиком, который отсутствует.')]);
 assert.equal(row.deadline,null);
 assert.equal(row.amount?.value,1200000);
});

test('signed addendum only changes penalty, existing price/date stay unchanged',()=>{
 const row=select([base(),amendment('Изменить размер неустойки с 0,1% на 0,2% за каждый день просрочки.')]);
 assert.equal(row.amount?.value,1200000);
 assert.equal(row.deadline?.value,'2026-04-15');
});

test('later unambiguous signed amendment restores field after earlier ambiguity',()=>{
 const row=select([base(),
  amendment('Общая стоимость поставки составляет 1 380 000 рублей.\nОбщая стоимость поставки составляет 1 410 000 рублей.','01.03.2026','ambiguous.txt'),
  amendment('Общая стоимость поставки составляет 1 500 000 рублей.','05.03.2026','resolved.txt')
 ]);
 assert.equal(row.amount?.value,1500000);
 assert.equal(row.amount.changedBy,'resolved.txt');
});

test('same-day contradictory amendments invalidate only affected term',()=>{
 const row=select([base(),
   amendment('Сумма договора составляет 1 380 000 рублей.','01.03.2026','a.txt'),
   amendment('Сумма договора составляет 1 450 000 рублей.','01.03.2026','b.txt')]);
 assert.equal(row.amount,null);
 assert.equal(row.deadline?.value,'2026-04-15');
});

test('signed amendment with OLD and NEW values in same paragraph keeps entire source paragraph',()=>{
 const row=select([base(),amendment('Изменить сумму договора с 1 200 000 рублей на 1 380 000 рублей.')]);
 assert.equal(row.amount?.value,1380000);
 assert.match(row.amount.evidence.quote,/1 200 000 рублей на 1 380 000 рублей/);
});

test('unsigned draft with ambiguous or unrecognized values never invalidates the signed term',()=>{
 const draft={name:'draft.txt',text:'ПРОЕКТ ДОПОЛНИТЕЛЬНОГО СОГЛАШЕНИЯ № 9 К ДОГОВОРУ RSK-801\nСтатус: проект на согласовании, не подписан.\n\nЦена договора изменяется с 1 200 000 рублей на сумму согласно приложению.'};
 const row=select([base(),draft]);
 assert.equal(row.amount?.value,1200000);
 assert.equal(row.proposals.length,1);
});
