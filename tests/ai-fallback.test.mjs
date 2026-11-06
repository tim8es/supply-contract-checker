import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze,parseDocument } from '../src/engine.mjs';
import { collectFallbackTargets, candidateFromModel, fetchFallbackCandidates, validateEndpoint } from '../src/ai-fallback.mjs';
import {penaltyRateExtractor} from '../src/extractors/penalty.mjs';

const contract=(text='Стоимость продукции в рамках настоящего договора равна 640 000 рублей.\nВесь товар должен быть поставлен до 11 июня 2026 года.')=>({
 name:'unseen-contract.txt',text:[
  'ДОГОВОР ПОСТАВКИ № BYK-543','Статус: подписан обеими сторонами 01.02.2026.',
  'Поставщик: ООО «Тест»','','',text
 ].join('\n')
});
const draft={
 name:'unsigned-proposal.txt',text:'ПРОЕКТ ДОПОЛНИТЕЛЬНОГО СОГЛАШЕНИЯ К ДОГОВОРУ BYK-543\nСтатус: не подписано.\n\nПредлагаем изменить сумму договора на 900 000 рублей.'
};
const future={
 name:'later-amendment.txt',text:'ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ К ДОГОВОРУ BYK-543\nСтатус: подписано обеими сторонами 01.03.2026.\n\nНовая сумма договора равна 800 000 рублей.\nНастоящее соглашение вступает в силу 01.04.2026.'
};
const block=(doc,fragment)=>parseDocument(doc).blocks.find(b=>b.text.includes(fragment)).startLine;
const candidate=(doc,field,line,valueText)=>candidateFromModel(parseDocument(doc),field,{blockLine:line,valueText});
const response=text=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(text)}}]})});

test('model returns grounded amount and date for previously unrecognized contract wording',()=>{
 const doc=contract();
 const amount=candidate(doc,'amount',block(doc,'Стоимость продукции'),'640 000');
 const date=candidate(doc,'deadline',block(doc,'Весь товар'),'11 июня 2026 года');
 assert.equal(amount?.value,640000);
 assert.equal(date?.value,'2026-06-11');
 assert.equal(amount.evidence.verified,true);
 assert.equal(date.evidence.file,doc.name);
 assert.ok(amount.evidence.quote.includes('Стоимость продукции'));
});
test('payment, budget and fabricated value cannot pass semantic and byte-range guards',()=>{
 const doc=contract('Аванс по договору составляет 550 000 рублей.\nСрок оплаты до 12.04.2026.');
 assert.equal(candidate(doc,'amount',block(doc,'Аванс'),'550 000'),null);
 assert.equal(candidate(doc,'deadline',block(doc,'Срок оплаты'),'12.04.2026'),null);
 assert.equal(candidate(doc,'deadline',block(doc,'Аванс'),'19.05.2026'),null);
});
test('model response references must match original paragraph start, not arbitrary line or new text',()=>{
 const doc=contract();
 assert.equal(candidate(doc,'amount',999,'640 000'),null);
 assert.equal(candidate(doc,'amount',block(doc,'Стоимость продукции'),'990 000'),null);
 assert.equal(candidate(doc,'amount',block(doc,'Поставщик'),'640 000'),null);
});
test('provider URL must be explicit HTTPS or local HTTP, without credentials or query secrets',()=>{
 assert.equal(validateEndpoint('https://example.org/v1/chat/completions'),'https://example.org/v1/chat/completions');
 assert.equal(validateEndpoint('http://localhost:11434/v1/chat/completions'),'http://localhost:11434/v1/chat/completions');
 assert.throws(()=>validateEndpoint('http://example.org/v1/chat/completions'),/HTTPS/);
 assert.throws(()=>validateEndpoint('https://api:secret@example.org/v1/chat/completions'),/пароль/);
 assert.throws(()=>validateEndpoint('https://example.org/v1/chat/completions?key=abc'),/параметры/);
 assert.throws(()=>validateEndpoint('https://example.org/v1'),/endpoint/);
});
test('target selection excludes unsigned proposals and future effective amendments',()=>{
 const data=collectFallbackTargets([contract(),draft,future],'2026-03-10');
 assert.deepEqual(data.targets.map(x=>x.doc.name),['unseen-contract.txt']);
 assert.deepEqual(data.targets[0].missing,['amount','deadline']);
});
test('unsigned base can be scanned as diagnostic evidence, not legal authority',()=>{
 const unsigned={...contract(),text:contract().text.replace('подписан обеими сторонами','не подписан сторонами')};
 assert.equal(collectFallbackTargets([unsigned],'2026-03-10').targets.length,1);
 const result=analyze([unsigned],'2026-03-10',{
   aiCandidates:{[unsigned.name]:{amount:candidate(unsigned,'amount',block(unsigned,'Стоимость продукции'),'640 000')}}
 });
 assert.equal(result.rows[0].amount,null);
 assert.ok(result.rows[0].review.some(x=>x.includes('Подписание')));
});
test('target selection does not resend parsed fields but permits duplicate diagnostics',()=>{
 const known=contract('Цена договора составляет 700 000 рублей.\nСрок поставки: 15.04.2026.');
 assert.equal(collectFallbackTargets([known],'2026-03-10').targets.length,0);
 const duplicate={...contract(),name:'duplicate.txt'};
 const targets=collectFallbackTargets([contract(),duplicate],'2026-03-10').targets;
 assert.equal(targets.length,2);
 const result=analyze([contract(),duplicate],'2026-03-10',{
  aiCandidates:{[contract().name]:{amount:candidate(contract(),'amount',
   block(contract(),'Стоимость продукции'),'640 000')}}
 });
 assert.equal(result.rows[0].amount,null);
 assert.ok(result.rows[0].review.some(x=>x.includes('Дубликат')));
});
test('fake OpenAI-compatible response is verified and applied with review flag',async()=>{
 const doc=contract();
 let calls=0;
 const result=await fetchFallbackCandidates([doc],'2026-03-10',{
  endpoint:'https://example.test/v1/chat/completions',
  model:'test-qwen',apiKey:'SECRET_DO_NOT_LOG',
  fetchImpl:async(url,options)=>{
   calls++;
   assert.equal(url,'https://example.test/v1/chat/completions');
   assert.equal(options.credentials,'omit');
   assert.equal(options.headers.Authorization,'Bearer SECRET_DO_NOT_LOG');
   const payload=JSON.parse(options.body);
   assert.ok(payload.messages[1].content.includes('Стоимость продукции'));
   assert.ok(!JSON.stringify(payload).includes('SECRET_DO_NOT_LOG'));
   return response({
    amount:{blockLine:block(doc,'Стоимость продукции'),valueText:'640 000'},
    deadline:{blockLine:block(doc,'Весь товар'),valueText:'11 июня 2026 года'}
   });
  }
 });
 assert.equal(calls,1);
 assert.equal(result.accepted,2);
 const row=analyze([doc],'2026-03-10',{aiCandidates:result.candidates}).rows[0];
 assert.equal(row.amount.value,640000);
 assert.equal(row.deadline.value,'2026-06-11');
 assert.equal(row.amount.via,'ai');
 assert.ok(row.review.some(x=>x.includes('ИИ-кандидат')));
 assert.ok(JSON.stringify(row).includes('640 000'));
 assert.ok(!JSON.stringify(result).includes('SECRET_DO_NOT_LOG'));
});
test('model rejection leaves normal deterministic analysis unchanged',async()=>{
 const doc=contract();
 const result=await fetchFallbackCandidates([doc],'2026-03-10',{
  endpoint:'https://example.test/v1/chat/completions',
  model:'test',apiKey:'SECRET',
  fetchImpl:async()=>response({amount:{blockLine:99,valueText:'999 999'},deadline:null})
 });
 assert.equal(result.accepted,0);
 assert.equal(result.failures.length,1);
 const row=analyze([doc],'2026-03-10',{aiCandidates:result.candidates}).rows[0];
 assert.equal(row.amount,null);
 assert.equal(row.deadline,null);
});
test('provider HTTP errors and CORS-like failures return sanitized diagnostics',async()=>{
 for(const mock of [async()=>({ok:false,status:401}),async()=>{throw Error('API-KEY-SECRET');}]) {
  const result=await fetchFallbackCandidates([contract()],'2026-03-10',{
   endpoint:'https://example.test/v1/chat/completions',model:'test',apiKey:'MY-SECRET',fetchImpl:mock
  });
  assert.equal(result.requested,1);
  assert.equal(result.accepted,0);
  assert.equal(result.failures.length,1);
  assert.ok(!JSON.stringify(result).includes('MY-SECRET'));
  assert.ok(!JSON.stringify(result).includes('API-KEY-SECRET'));
 }
});
test('wrongly formatted model JSON does not affect rule-based result',async()=>{
 const result=await fetchFallbackCandidates([contract()],'2026-03-10',{
  endpoint:'https://example.test/v1/chat/completions',model:'test',apiKey:'x',
  fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'not json'}}]})})
 });
 assert.equal(result.accepted,0);
 assert.match(result.failures[0],/неподдерживаемый JSON/);
});
test('unsigned/proposed model candidates cannot override legal authority',()=>{
 const doc=contract('Цена договора: 600 000 рублей.\nСрок поставки: 30.04.2026.');
 const fake={...candidate(contract(),'amount',block(contract(),'Стоимость продукции'),'640 000')};
 const row=analyze([doc,draft],'2026-03-10',{
  aiCandidates:{[draft.name]:{amount:fake}}
 }).rows[0];
 assert.equal(row.amount.value,600000);
 assert.ok(row.proposals.length===1);
});
test('future-signed amendment candidate remains ineffective before its effective date',()=>{
 const doc=contract('Цена договора: 600 000 рублей.\nСрок поставки: 30.04.2026.');
 const addonCandidate=candidate(future,'amount',block(future,'Новая сумма'),'800 000');
 const before=analyze([doc,future],'2026-03-10',{aiCandidates:{[future.name]:{amount:addonCandidate}}}).rows[0];
 assert.equal(before.amount.value,600000);
});
test('missing required endpoint/model/key rejected before network',async()=>{
 const props={endpoint:'https://example.test/v1/chat/completions',model:'test',apiKey:'key'};
 await assert.rejects(()=>fetchFallbackCandidates([contract()],'2026-03-10',{...props,model:''}),/модель/);
 await assert.rejects(()=>fetchFallbackCandidates([contract()],'2026-03-10',{...props,apiKey:''}),/API-ключ/);
});

test('requested field and contract filter keep unrelated documents out of the API payload',async()=>{
 const first=contract();
 const second={...contract(),name:'other.txt',
   text:contract().text.replaceAll('BYK-543','BYK-544')};
 const target=collectFallbackTargets([first,second],'2026-03-10',{contractId:'BYK-543',field:'amount'});
 assert.equal(target.targets.length,1);
 assert.deepEqual(target.targets[0].missing,['amount']);
 let requests=0;
 const result=await fetchFallbackCandidates([first,second],'2026-03-10',{
   contractId:'BYK-543',field:'amount',
   endpoint:'https://example.test/v1/chat/completions',model:'test',apiKey:'key',
   fetchImpl:async(_,options)=>{
     requests++;
     const payload=JSON.parse(options.body);
     const sent=JSON.parse(payload.messages[1].content);
     assert.equal(sent.file,first.name);
     assert.deepEqual(sent.requestedFields,['amount']);
     assert.ok(!options.body.includes(second.name));
     return response({
       amount:{blockLine:block(first,'Стоимость продукции'),valueText:'640 000'},
       deadline:null
     });
   }
 });
 assert.equal(requests,1);
 assert.equal(result.accepted,1);
 assert.deepEqual(Object.keys(result.candidates),[first.name]);
 assert.ok(!result.candidates[first.name].deadline);
});
test('penalty rate is supported as an AI-only source-grounded plugin field',()=>{
 const doc=contract('Неустойка за каждый день просрочки составляет 0,25% от суммы договора.');
 const target=collectFallbackTargets([doc],'2026-03-10',{field:'penaltyRate'});
 assert.equal(target.targets.length,1);
 assert.deepEqual(target.targets[0].missing,['penaltyRate']);
 const found=candidate(doc,'penaltyRate',block(doc,'Неустойка'),'0,25%');
 assert.equal(found?.value,0.25);
 const row=analyze([doc],'2026-03-10',{
   extractors:[penaltyRateExtractor],aiCandidates:{[doc.name]:{penaltyRate:found}}
 }).rows[0];
 assert.equal(row.extraFields.penaltyRate.value,0.25);
 assert.equal(row.extraFields.penaltyRate.via,'ai');
 assert.equal(row.extraFields.penaltyRate.evidence.verified,true);
 assert.ok(row.review.some(x=>x.includes('ИИ-кандидат')));
});
test('penalty cap or percentage without daily term is not accepted by AI',()=>{
 const cap=contract('Предельный размер неустойки не более 10%.');
 assert.equal(candidate(cap,'penaltyRate',block(cap,'Предельный'),'10%'),null);
 const unrelated=contract('Ставка неустойки установлена 2% однократно.');
 assert.equal(candidate(unrelated,'penaltyRate',block(unrelated,'Ставка'),'2%'),null);
});
test('invalid requested field is rejected before reaching the external API',()=>{
 assert.throws(()=>collectFallbackTargets([contract()],'2026-03-10',{field:'unknown'}),/Неподдерживаемое поле/);
});
