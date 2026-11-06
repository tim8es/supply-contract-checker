import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/engine.mjs';

const base = clause => ({
  name:'a-renamed-contract.txt',
  text:[
    'ДОГОВОР ПОСТАВКИ № CTX-987',
    'Статус: подписан обеими сторонами 01.02.2026.',
    'Поставщик: ООО «Контекст».',
    '',
    'Общая стоимость поставки составляет 888 000 рублей.',
    clause
  ].join('\n')
});
const deadlineOf = txt => analyze([base(txt)],'2026-03-10').rows[0].deadline?.value ?? null;

test('date of payment before delivery in same paragraph cannot become a delivery deadline',()=>{
  assert.equal(deadlineOf('Оплата производится до 10.04.2026. Поставка товара осуществляется до 03.04.2026.'),'2026-04-03');
});
test('signing date before stated delivery in same paragraph cannot become a delivery deadline',()=>{
  assert.equal(deadlineOf('Договор подписан 01.03.2026. Срок поставки: 20.04.2026.'),'2026-04-20');
});
test('mixed clauses separated by semicolon select delivery, not payment',()=>{
  assert.equal(deadlineOf('Оплатить товар до 10.04.2026; поставить товар не позднее 03.04.2026.'),'2026-04-03');
});
test('deadline is not synthesized from a separate payment date',()=>{
  assert.equal(deadlineOf('Срок поставки определяется графиком; оплата должна пройти до 20.04.2026.'),null);
});
test('two conflicting explicit delivery dates in same paragraph are marked ambiguous',()=>{
  const row=analyze([base('Срок поставки: 20.04.2026. Срок поставки: 30.04.2026.')],'2026-03-10').rows[0];
  assert.equal(row.deadline,null);
  assert.ok(row.review.some(x=>x.includes('Неоднозначный срок')));
});
test('date belonging to referenced appendix must not replace delivery date',()=>{
  assert.equal(deadlineOf('Согласно приложению от 01.03.2026, срок поставки: 11.04.2026.'),'2026-04-11');
});
test('date of goods acceptance does not supersede stated delivery',()=>{
  assert.equal(deadlineOf('Дата приемки товара — 15.04.2026, поставка товара должна завершиться до 10.04.2026.'),'2026-04-10');
});
test('original six-contract deadline values stay stable',async()=>{
  const fs=await import('node:fs/promises');
  const names=['01_contract.txt','02_amendment_signed.txt','03_contract.txt','04_contract.txt','05_supplier_email.txt','06_amendment_draft.txt'];
  const docs=await Promise.all(names.map(async name=>({name,text:await fs.readFile(new URL('../documents/'+name,import.meta.url),'utf8')})));
  const values=analyze(docs,'2026-03-10').rows.map(x=>[x.id,x.deadline?.value ?? null]);
  assert.deepEqual(values,[['STN-101','2026-04-30'],['STN-102','2026-03-20'],['STN-103','2026-04-30']]);
});
