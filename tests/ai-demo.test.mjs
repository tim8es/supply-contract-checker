import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze} from '../src/engine.mjs';
import {collectFallbackTargets,candidateFromModel,fetchFallbackCandidates} from '../src/ai-fallback.mjs';

const file={name:'ai_fallback_example.txt',
  text:readFileSync(new URL('../examples/ai_fallback_example.txt',import.meta.url),'utf8')};

test('AI fixture is missing both values before model analysis',()=>{
 const row=analyze([file],'2026-03-10').rows[0];
 assert.equal(row.id,'NLP-204');
 assert.equal(row.amount,null);
 assert.equal(row.deadline,null);
});
test('AI fixture exposes two locally eligible source-grounded terms',()=>{
 const targets=collectFallbackTargets([file],'2026-03-10').targets;
 assert.equal(targets.length,1);
 assert.deepEqual(targets[0].missing,['amount','deadline']);
 const doc=targets[0].doc;
 const price=doc.blocks.find(x=>x.text.includes('640 000'));
 const date=doc.blocks.find(x=>x.text.includes('11 июня'));
 assert.equal(candidateFromModel(doc,'amount',{blockLine:price.startLine,valueText:'640 000'}).value,640000);
 assert.equal(candidateFromModel(doc,'deadline',{blockLine:date.startLine,valueText:'11 июня 2026 года'}).value,'2026-06-11');
});
test('mock model demonstrates before/after recovered values with evidence',async()=>{
 const doc=collectFallbackTargets([file],'2026-03-10').targets[0].doc;
 const lineFor=x=>doc.blocks.find(b=>b.text.includes(x)).startLine;
 const result=await fetchFallbackCandidates([file],'2026-03-10',{
  endpoint:'https://example.org/v1/chat/completions',model:'demo-model',apiKey:'key',
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({
    amount:{blockLine:lineFor('640 000'),valueText:'640 000'},
    deadline:{blockLine:lineFor('11 июня'),valueText:'11 июня 2026 года'}
  })}}]})})
 });
 assert.equal(result.requestedFields,2);
 assert.equal(result.accepted,2);
 const row=analyze([file],'2026-03-10',{aiCandidates:result.candidates}).rows[0];
 assert.equal(row.amount.value,640000);
 assert.equal(row.deadline.value,'2026-06-11');
 assert.equal(row.amount.via,'ai');
 assert.ok(row.amount.evidence.quote.includes('640 000'));
});
test('model abstentions are counted without inserting invented answers',async()=>{
 const result=await fetchFallbackCandidates([file],'2026-03-10',{
  endpoint:'https://example.org/v1/chat/completions',model:'demo-model',apiKey:'key',
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"amount":null,"deadline":null}'}}]})})
 });
 assert.equal(result.accepted,0);
 assert.equal(result.emptyFields,2);
 const row=analyze([file],'2026-03-10',{aiCandidates:result.candidates}).rows[0];
 assert.equal(row.amount,null);
 assert.equal(row.deadline,null);
});
