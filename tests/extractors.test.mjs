import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze } from '../src/engine.mjs';
import { penaltyRateExtractor,parsePenaltyRate } from '../src/extractors/penalty.mjs';
const ext={extractors:[penaltyRateExtractor]};
const base={
 name:'base.txt',text:'ДОГОВОР ПОСТАВКИ № PEN-501\nСтатус: подписан обеими сторонами 01.02.2026.\n' +
 'Поставщик: ООО «Точность».\n\nЦена договора — 900 000 рублей.\nСрок поставки: 18.04.2026.\n' +
 'Неустойка за просрочку поставки составляет 0,1% стоимости за каждый день, но не более 10% стоимости.'
};
const amend=(clause,status='подписано обеими сторонами 01.03.2026',effective='01.03.2026')=>({
 name:'amend.txt',text:'ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ К ДОГОВОРУ PEN-501\nСтатус: '+status+'\n' +
 'Поставщик: ООО «Точность».\n\n'+clause+'\n\nНастоящее соглашение вступает в силу '+effective+'.'
});
const current=docs=>analyze(docs,'2026-03-10',ext).rows[0];

test('penalty rate is an optional plugin; default core remains amount and deadline only',()=>{
 const plain=analyze([base]).rows[0];
 assert.equal(plain.extraFields.penaltyRate,undefined);
 const row=current([base]);
 assert.equal(row.extraFields.penaltyRate?.value,0.1);
 assert.equal(row.amount.value,900000);
 assert.equal(row.deadline.value,'2026-04-18');
 assert.equal(row.extraFields.penaltyRate.evidence.verified,true);
});
test('upper cap of 10% must not become the daily penalty rate',()=>{
 assert.equal(current([base]).extraFields.penaltyRate.value,0.1);
});
test('signed amendment changes penalty FROM 0.1% TO 0.2%',()=>{
 const row=current([base,amend('Изменить размер неустойки с 0,1% на 0,2% за каждый день просрочки.')]);
 assert.equal(row.extraFields.penaltyRate.value,0.2);
 assert.equal(row.extraFields.penaltyRate.changedBy,'amend.txt');
 assert.equal(row.history.penaltyRate.length,2);
 assert.equal(row.history.penaltyRate.at(-1).outcome,'applied');
 assert.equal(row.amount.value,900000);
});
test('future effective penalty modification does not apply',()=>{
 const row=current([base,amend('Установить неустойку 0,3% за каждый день.','подписано обеими сторонами 01.03.2026','12.03.2026')]);
 assert.equal(row.extraFields.penaltyRate.value,0.1);
});
test('unsigned penalty modification cannot override the base term',()=>{
 const row=current([base,amend('Изменить размер неустойки на 0,4% за каждый день.','не подписано сторонами 01.03.2026')]);
 assert.equal(row.extraFields.penaltyRate.value,0.1);
});
test('unsigned draft penalty change appears only in proposals',()=>{
 const draft={name:'draft.txt',text:'ПРОЕКТ ДОПОЛНИТЕЛЬНОГО СОГЛАШЕНИЯ К ДОГОВОРУ PEN-501\nСтатус: проект не подписан.\n\nПредлагается установить ставку неустойки 0,5% за каждый день.'};
 const row=current([base,draft]);
 assert.equal(row.extraFields.penaltyRate.value,0.1);
 assert.equal(row.proposals[0].extraFields.penaltyRate.value,0.5);
});
test('unresolvable signed penalty amendment does not leave stale daily rate',()=>{
 const row=current([base,amend('Ставка неустойки изменена и определяется дополнительным приложением, которого нет.')]);
 assert.equal(row.extraFields.penaltyRate,null);
 assert.equal(row.history.penaltyRate.at(-1).outcome,'unresolved');
});
test('base missing penalty returns null even when other terms are present',()=>{
 const changed={...base,text:base.text.replace(/Неустойка за просрочку[^\n]+/u,'Ставка неустойки не установлена.')};
 assert.equal(current([changed]).extraFields.penaltyRate,null);
});
test('reject duplicate extractor registry and unsupported parse tokens',()=>{
 assert.throws(()=>analyze([base],'2026-03-10',{extractors:[penaltyRateExtractor,penaltyRateExtractor]}),/Invalid or duplicate/);
 assert.equal(parsePenaltyRate('0,1%'),0.1);
 assert.equal(parsePenaltyRate('105%'),null);
 assert.equal(parsePenaltyRate('неустойка'),null);
});
test('six original documents yield baseline amount/date and independent penalty fields',()=>{
 const names=['01_contract.txt','02_amendment_signed.txt','03_contract.txt','04_contract.txt','05_supplier_email.txt','06_amendment_draft.txt'];
 const files=names.map(name=>({name,text:readFileSync(new URL('../documents/'+name,import.meta.url),'utf8')}));
 const rows=analyze(files,'2026-03-10',ext).rows;
 assert.deepEqual(rows.map(x=>x.extraFields.penaltyRate?.value??null),[0.1,0.05,null]);
 assert.deepEqual(rows.map(x=>x.amount?.value??null),[1380000,840000,null]);
});
