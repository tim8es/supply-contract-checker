import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyEvidence, asEvidenceResult } from '../src/evidence.mjs';
import { parseMoney, toIso, analyze } from '../src/engine.mjs';
const doc={name:'sample.txt',text:'ДОГОВОР ПОСТАВКИ № XYZ-201\nОбщая стоимость поставки составляет 1 380 000 рублей.\nСрок поставки: 30.04.2026.'};
const claim={
  value:1380000,
  evidence:{file:'sample.txt',line:2,endLine:2,
    quote:'Общая стоимость поставки составляет 1 380 000 рублей.',
    valueText:'1 380 000'}
};
const copy=x=>structuredClone(x);

test('valid source quote with parsable original token is verified',()=>{
 const r=verifyEvidence(doc,claim,parseMoney);
 assert.equal(r.valid,true);
 assert.equal(asEvidenceResult(doc,claim,parseMoney).candidate.evidence.verified,true);
});
test('hallucinated quote is rejected even if value is plausible',()=>{
 const c=copy(claim);c.evidence.quote='Общая стоимость поставки составляет 1 380 000 рублей. Подписано.';
 assert.ok(verifyEvidence(doc,c,parseMoney).failures.includes('quote_mismatch'));
});
test('wrong document identity rejects otherwise valid quotation',()=>{
 const c=copy(claim);c.evidence.file='other.txt';
 assert.ok(verifyEvidence(doc,c,parseMoney).failures.includes('wrong_file'));
});
test('value absent from a genuine quote is rejected',()=>{
 const c=copy(claim);c.evidence.valueText='1 550 000';
 assert.ok(verifyEvidence(doc,c,parseMoney).failures.includes('token_not_in_quote'));
});
test('value mismatching a real token is rejected',()=>{
 const c=copy(claim);c.value=1450000;
 assert.ok(verifyEvidence(doc,c,parseMoney).failures.includes('value_mismatch'));
});
test('quote pointing to incorrect line is rejected',()=>{
 const c=copy(claim);c.evidence.line=1;c.evidence.endLine=1;
 assert.ok(verifyEvidence(doc,c,parseMoney).failures.includes('quote_mismatch'));
});
test('multi-line quote maintains exact original line interval',()=>{
 const d={name:'x.txt',text:'Общая стоимость поставки\nсоставляет 900 000 рублей.'};
 const c={value:900000,evidence:{file:d.name,line:1,endLine:2,quote:d.text,valueText:'900 000'}};
 assert.equal(verifyEvidence(d,c,parseMoney).valid,true);
});
test('date token must resolve to the claimed ISO date',()=>{
 const c={value:'2026-04-30',evidence:{file:doc.name,line:3,endLine:3,quote:'Срок поставки: 30.04.2026.',valueText:'30.04.2026'}};
 assert.equal(verifyEvidence(doc,c,toIso).valid,true);
 c.value='2026-05-30';assert.equal(verifyEvidence(doc,c,toIso).valid,false);
});
test('core actual results all carry source verification flag',()=>{
 const input={name:'contract.txt',text:'ДОГОВОР ПОСТАВКИ № ABC-999\nСтатус: подписан обеими сторонами 01.03.2026.\n\nПоставщик: ООО «Тест».\n\nЦена договора: 600 000 рублей.\nСрок поставки: 18.04.2026.'};
 const row=analyze([input]).rows[0];
 assert.equal(row.amount.evidence.verified,true);
 assert.equal(row.deadline.evidence.verified,true);
});
