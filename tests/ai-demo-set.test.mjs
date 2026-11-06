import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze,parseDocument} from '../src/engine.mjs';
import {collectFallbackTargets,candidateFromModel} from '../src/ai-fallback.mjs';
import {penaltyRateExtractor} from '../src/extractors/penalty.mjs';

const names=[
  'ai_fallback_example.txt',
  'ai_medical_equipment_205.txt',
  'ai_medical_amendment_signed_205.txt',
  'ai_office_furnishings_206.txt',
  'ai_office_supplier_letter_206.txt',
  'ai_lab_supplies_207.txt'
];
const files=names.map(name=>({
  name,text:readFileSync(new URL('../examples/'+name,import.meta.url),'utf8')
}));
const byId=(rows,id)=>rows.find(x=>x.id===id);
const quoteCandidate=(document,field,needle,valueText)=>{
  const doc=parseDocument(document);
  const block=doc.blocks.find(x=>x.text.includes(needle));
  assert.ok(block,'original paragraph exists: '+needle);
  return candidateFromModel(doc,field,{blockLine:block.startLine,valueText});
};

test('separate AI demo consists of four substantial, realistic contracts and two linked files',()=>{
 assert.equal(files.length,6);
 const docs=files.map(parseDocument);
 assert.equal(docs.filter(x=>x.kind==='contract').length,4);
 assert.equal(docs.filter(x=>x.kind==='amendment').length,1);
 assert.equal(docs.filter(x=>x.kind==='letter').length,1);
 for(const doc of docs.filter(x=>x.kind==='contract')) {
   assert.ok(doc.text.length>=3000,doc.name+' needs realistic length');
   assert.ok(doc.blocks.length>=12,doc.name+' needs independent contractual clauses');
   assert.ok(doc.text.includes('Поставщик:'),doc.name+' supplier is explicit');
   assert.ok(doc.text.includes('Статус: подписан'),doc.name+' signed status is explicit');
 }
 const result=analyze(files,'2026-03-10',{extractors:[penaltyRateExtractor]});
 assert.deepEqual(result.rows.map(x=>x.id),['NLP-204','NLP-205','NLP-206','NLP-207']);
 assert.equal(result.documents.length,6);
});

test('rules distinguish actual missed wording from known terms and true missing values',()=>{
 const {rows}=analyze(files,'2026-03-10',{extractors:[penaltyRateExtractor]});
 assert.equal(byId(rows,'NLP-204').amount,null);
 assert.equal(byId(rows,'NLP-204').deadline,null);
 assert.equal(byId(rows,'NLP-205').amount?.value,975000);
 assert.equal(byId(rows,'NLP-205').amount?.changedBy,'ai_medical_amendment_signed_205.txt');
 assert.equal(byId(rows,'NLP-205').deadline,null);
 assert.equal(byId(rows,'NLP-206').amount,null);
 assert.equal(byId(rows,'NLP-206').deadline?.value,'2026-03-31');
 assert.equal(byId(rows,'NLP-207').amount,null);
 assert.equal(byId(rows,'NLP-207').deadline?.value,'2026-04-27');
 assert.equal(byId(rows,'NLP-205').extraFields.penaltyRate?.value,0.05);
});

test('letter is visibly a proposal but must never override the original delivery obligation',()=>{
 const {rows}=analyze(files,'2026-03-10',{extractors:[penaltyRateExtractor]});
 const row=byId(rows,'NLP-206');
 assert.equal(row.deadline.value,'2026-03-31');
 assert.equal(row.proposals.length,1);
 assert.equal(row.proposals[0].kind,'letter');
 assert.equal(row.proposals[0].deadline?.value,'2026-04-14');
 const unrelated=byId(rows,'NLP-205');
 assert.equal(unrelated.proposals.length,0);
});

test('AI can recover three different missing fields from different realistic contracts',()=>{
 const examples=[
  ['ai_fallback_example.txt','amount','640 000','640 000',640000],
  ['ai_fallback_example.txt','deadline','11 июня','11 июня 2026 года','2026-06-11'],
  ['ai_medical_equipment_205.txt','deadline','24 апреля','24 апреля 2026 года','2026-04-24'],
  ['ai_office_furnishings_206.txt','amount','785 000','785 000',785000]
 ];
 for(const [name,field,phrase,token,expected] of examples){
   const source=files.find(x=>x.name===name);
   const found=quoteCandidate(source,field,phrase,token);
   assert.equal(found?.value,expected,name+': '+field);
   assert.equal(found?.evidence.file,name);
   assert.ok(found?.evidence.verified);
 }
});

test('genuine missing annex price cannot be replaced by a budget limit',()=>{
 const source=files.find(x=>x.name==='ai_lab_supplies_207.txt');
 const attempt=quoteCandidate(source,'amount','600 000','600 000');
 assert.equal(attempt,null);
 const target=collectFallbackTargets(files,'2026-03-10',{contractId:'NLP-207',field:'amount'});
 assert.equal(target.targets.length,1);
 assert.deepEqual(target.targets[0].missing,['amount']);
});

test('AI calls remain scoped to a single contract in the multi-file realistic dataset',()=>{
 const target=collectFallbackTargets(files,'2026-03-10',{contractId:'NLP-204',field:'amount'});
 assert.equal(target.targets.length,1);
 assert.equal(target.targets[0].doc.name,'ai_fallback_example.txt');
 assert.deepEqual(target.targets[0].missing,['amount']);
});
