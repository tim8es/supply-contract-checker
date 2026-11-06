#!/usr/bin/env node
/**
 * Browser end-to-end smoke with Chrome DevTools Protocol and built-in WebSocket.
 * No Playwright/Puppeteer dependency. Runs on GitHub-hosted Ubuntu runners.
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';

const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.txt':'text/plain', '.json':'application/json' };
const root = resolve('.');
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const filePath = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': (mime[extname(filePath)] || 'application/octet-stream') + '; charset=utf-8',
      'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForChrome(profileDir, child) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error('Chrome exited before opening CDP: exit ' + child.exitCode);
    try {
      const active = await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8');
      const port = Number(active.split(String.fromCharCode(10))[0]);
      if (Number.isInteger(port) && port > 0) {
        const response = await fetch('http://127.0.0.1:' + port + '/json/list');
        if (response.ok) {
          const targets = await response.json();
          const page = targets.find(x => x.type === 'page');
          if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        }
      }
    } catch {}
    await delay(200);
  }
  throw new Error('Chrome DevTools unavailable after 30 seconds');
}
function makeCDP(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });
  return (method, params={}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
function assert(condition, label) {
  if (!condition) throw Error('E2E failed: ' + label);
}
async function main() {
  const tempDirs = [];
  const chromePath = process.env.CHROME_BIN || 'google-chrome';
  let chrome;
  let ws;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    let target;
    let chromeError = '';
    // Retry only browser startup, never a failed product assertion.
    // GitHub-hosted runners occasionally fail to expose CDP on first launch.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const dir = await mkdtemp(join(tmpdir(), 'textnavigator-browser-'));
      tempDirs.push(dir);
      chrome = spawn(chromePath, [
        '--headless=new','--disable-gpu','--disable-dev-shm-usage','--no-sandbox',
        '--no-first-run','--no-default-browser-check','--disable-background-networking',
        '--remote-debugging-port=0','--remote-allow-origins=*',
        '--user-data-dir=' + dir, 'http://127.0.0.1:' + port + '/?demo=1'
      ], { stdio: ['ignore','ignore','pipe'] });
      chrome.stderr.on('data', chunk => { chromeError = (chromeError + chunk.toString()).slice(-4000); });
      try {
        target = await waitForChrome(dir, chrome);
        break;
      } catch (error) {
        chrome.kill('SIGTERM');
        console.warn('Chrome startup attempt '+attempt+' failed: '+error.message);
        if (attempt === 3) throw new Error(error.message + '; stderr='+chromeError.slice(-800));
        await delay(400);
      }
    }
    ws = new WebSocket(target);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const call = makeCDP(ws);
    async function evaluate(expression) {
      const data = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (data.exceptionDetails) throw Error('Browser evaluation failed: ' + data.exceptionDetails.text);
      return data.result.value;
    }
    // CDP can attach during initial about:blank -> app navigation. Retry only
    // readiness, never a failed product check or browser assertion.
    let appReady=false;
    for(let attempt=0;attempt<40;attempt++) {
      try {
        appReady=await evaluate("document.readyState === 'complete' && !!document.querySelector('#rows')");
        if(appReady) break;
      } catch(error) {
        if(!/Execution context was destroyed|Cannot find context with specified id/u.test(error.message))
          throw error;
      }
      await delay(150);
    }
    assert(appReady,'app loaded before E2E assertions');
    await evaluate("new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.querySelector('#rows')?.textContent.includes('STN-103')){clearInterval(id);resolve(true)}else if(++n>100){clearInterval(id);reject(Error('demo data not loaded'))}},100)})");
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    const dateAudit=await evaluate("(()=>{\n      const input=document.querySelector('#asof');\n      const read=()=>document.querySelector('#rows tr:first-child').innerText;\n      const update=v=>{input.value=v;input.dispatchEvent(new Event('change',{bubbles:true}));return read();};\n      const previous=update('2026-02-28');\n      const earlier=previous.replace(/\\s/gu,' ').includes('1 200 000') && previous.includes('15.04.2026') &&\n        !previous.replace(/\\s/gu,' ').includes('1 380 000');\n      const notYetSigned=update('2026-01-01');\n      const absent=(notYetSigned.match(/Нет данных/gu)||[]).length>=2;\n      const current=update('2026-03-10');\n      const restored=current.replace(/\\s/gu,' ').includes('1 380 000') &&\n        current.includes('30.04.2026') && input.value==='2026-03-10';\n      return {earlier,absent,restored};\n    })()");
    assert(dateAudit.earlier && dateAudit.absent && dateAudit.restored,
      'as-of date changes enforce signed/effective chronology: '+JSON.stringify(dateAudit));
    let rows = await evaluate("document.querySelector('#rows').innerText");
    assert(rows.includes('STN-101') && rows.includes('STN-102') && rows.includes('STN-103'), 'demo table');

    await evaluate("document.querySelector('[data-filter=before]').click()");
    rows = await evaluate("document.querySelector('#rows').innerText");
    assert(rows.includes('STN-102') && !rows.includes('STN-101') && !rows.includes('STN-103'), 'delivery filter');
    const filteredProposals = await evaluate("document.querySelector('#proposals').innerText");
    assert(filteredProposals.includes('STN-102') && !filteredProposals.includes('STN-101'), 'proposal filter relevance');

    await evaluate("document.querySelector('[data-filter=all]').click()");
    const missingActions=await evaluate("({amount:!!document.querySelector('[data-contract=\"STN-103\"][data-ai-field=\"amount\"]'),penalty:!!document.querySelector('[data-contract=\"STN-103\"][data-ai-field=\"penaltyRate\"]')})");
    assert(missingActions.amount && missingActions.penalty,
      'every missing registry cell has an AI button, including no-price and penalty');
    await evaluate("document.querySelector('#rows tr:first-child td:nth-child(2) button').click()");
    const proof = await evaluate("({file:document.querySelector('#document-select').value,quote:document.querySelector('#inspect-content blockquote')?.innerText,highlights:document.querySelectorAll('.source-line.highlight').length})");
    assert(proof.file === '01_contract.txt', 'source panel stays on previous document');
    assert(proof.quote.includes('1 380 000'), 'cited clause visible in inspector without source jump');
    assert(proof.highlights === 0, 'opening inspector must not scroll/highlight original TXT');
    await evaluate("document.querySelector('#inspect-content .inspect-action').click()");
    const explicitSource=await evaluate("({file:document.querySelector('#document-select').value,highlights:document.querySelectorAll('.source-line.highlight').length})");
    assert(explicitSource.file === '02_amendment_signed.txt' && explicitSource.highlights>=1,
      'only explicit source navigation opens original TXT');
    await evaluate("document.querySelector('#document-select').value='01_contract.txt';document.querySelector('#document-select').dispatchEvent(new Event('change',{bubbles:true}))");
    const timeline = await evaluate("document.querySelector('.term-history')?.innerText || ''");
    const normalizedTimeline = timeline.replace(/\s/gu, ' ');
    assert(normalizedTimeline.includes('1 200 000') && normalizedTimeline.includes('1 380 000'), 'old and new amount timeline: ' + JSON.stringify(normalizedTimeline));
    assert(timeline.includes('Действует') && timeline.includes('Исходное условие'), 'history status');
    await evaluate("document.querySelector('#rows tr:first-child td:nth-child(4) button').click()");
    const penaltyProof=await evaluate("({value:document.querySelector('#inspect-content .fact-value')?.innerText,source:document.querySelector('#document-select').value,quote:document.querySelector('#inspect-content blockquote')?.innerText})");
    assert(penaltyProof.source === '01_contract.txt', 'inspector does not automatically change original TXT');
    assert(penaltyProof.value?.includes('0,1%') && penaltyProof.quote?.includes('0,1%'), 'optional term visible with daily rate');


    const uploaded = await evaluate(`(async()=>{
      const txt='ДОГОВОР ПОСТАВКИ № XYZ-234\\nСтатус: подписан обеими сторонами 01.03.2026.\\n\\nПоставщик: ООО «Новый поставщик».\\n\\nЦена договора: 654 321 рублей.\\nСрок поставки: 18.03.2026.';
      const data=new DataTransfer();
      data.items.add(new File([txt],'custom.txt',{type:'text/plain'}));
      const input=document.querySelector('#files');
      input.files=data.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(document.querySelector('#rows').textContent.includes('XYZ-234')){clearInterval(t);resolve()}else if(++n>100){clearInterval(t);reject(Error('upload did not finish'))}},100)});
      return document.querySelector('#rows').innerText;
    })()`);
    assert(uploaded.replace(/\s/gu, ' ').includes('654 321') && uploaded.includes('18.03.2026'), 'new TXT upload and extraction');
    const inlineAI = await evaluate("(async()=>{\n  const load=document.querySelector('#ai-example');\n  load.click();\n  await new Promise((resolve,reject)=>{\n    let n=0;const tick=setInterval(()=>{\n      if(document.querySelector('#rows').textContent.includes('NLP-204')){\n        clearInterval(tick);resolve();\n      }else if(++n>100){clearInterval(tick);reject(Error('AI sample missing'))}\n    },100);\n  });\n  const before=document.querySelector('#rows').innerText;\n  const amountBtn=()=>document.querySelector('[data-contract=\"NLP-204\"][data-ai-field=\"amount\"]');\n  const dateBtn=()=>document.querySelector('[data-contract=\"NLP-204\"][data-ai-field=\"deadline\"]');\n  const allDocs=[...document.querySelectorAll('#rows .contract-id')].map(x=>x.textContent);\n  const inUpload=document.querySelector('#ai-example').parentElement===document.querySelector('#demo').parentElement;\n  const multipleContracts=allDocs.length===4 && ['NLP-204','NLP-205','NLP-206','NLP-207'].every(x=>allDocs.includes(x)) && document.querySelector('#doc-count').textContent==='6';\n  const initial=before.includes('Нет данных') && !!amountBtn() && !!dateBtn() &&\n    document.querySelector('#ai-impact')===null && document.querySelector('#ai-panel')===null;\n  amountBtn().click();\n  const configPrompt=document.querySelector('#ai-settings').hidden===false &&\n    document.querySelector('#rows').textContent.includes('Укажите API');\n  const storedKey='stn.model-settings.v1';\n  document.querySelector('#ai-endpoint').value='https://example.test/v1/chat/completions';\n  document.querySelector('#ai-endpoint').dispatchEvent(new Event('input',{bubbles:true}));\n  document.querySelector('#ai-model').value='mock-model';\n  document.querySelector('#ai-model').dispatchEvent(new Event('input',{bubbles:true}));\n  document.querySelector('#ai-key').value='NEVER_SAVE_THIS_KEY';\n  document.querySelector('#ai-key').dispatchEvent(new Event('input',{bubbles:true}));\n  const saved=JSON.parse(window.localStorage.getItem(storedKey));\n  const defaultSaved=saved.endpoint.includes('example.test') &&\n    saved.model==='mock-model' && !JSON.stringify(saved).includes('NEVER_SAVE_THIS_KEY');\n  const existingFetch=window.fetch;\n  let calls=0,scoped=true;\n  window.fetch=async(url,options)=>{\n    if(String(url)==='https://example.test/v1/chat/completions'){\n      calls++;\n      const request=JSON.parse(options.body);\n      const prompt=JSON.parse(request.messages[1].content);\n      if(prompt.requestedFields.length!==1 || prompt.file!=='ai_fallback_example.txt' ||\n        !request.messages[1].content.includes('640 000')) scoped=false;\n      const field=prompt.requestedFields[0];\n      return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(\n        field==='amount'?{amount:{blockLine:prompt.blocks.find(b=>b.text.includes('640 000')).line,valueText:'640 000'},deadline:null}:\n        {amount:null,deadline:{blockLine:prompt.blocks.find(b=>b.text.includes('11 июня')).line,valueText:'11 июня 2026 года'}}\n      )}}]})};\n    }\n    return existingFetch(url,options);\n  };\n  amountBtn().click();\n  await new Promise((resolve,reject)=>{\n    let n=0;const tick=setInterval(()=>{\n      if(document.querySelector('#rows').innerText.includes('640') &&\n          document.querySelector('[data-contract=\"NLP-204\"][data-ai-field=\"amount\"]')===null){\n        clearInterval(tick);resolve();\n      }else if(++n>100){clearInterval(tick);reject(Error('Amount not inserted'))}\n    },100);\n  });\n  const halfway=!!dateBtn() && document.querySelector('#rows').textContent.includes('ИИ · проверить');\n  dateBtn().click();\n  await new Promise((resolve,reject)=>{\n    let n=0;const tick=setInterval(()=>{\n      if(document.querySelector('#rows').innerText.includes('11.06.2026')){\n        clearInterval(tick);resolve();\n      }else if(++n>100){clearInterval(tick);reject(Error('Deadline not inserted'))}\n    },100);\n  });\n  const valueCount=(document.querySelector('#rows').textContent.match(/ИИ · проверить/gu)||[]).length;\n  document.querySelector('#rows tr td:nth-child(2) .evidence-link').click();\n  const quote=document.querySelector('#inspect-content blockquote')?.textContent||'';\n  const citation=quote.includes('640 000') && document.querySelector('#document-select').value==='ai_fallback_example.txt';\n  const remember=document.querySelector('#ai-remember-key');\n  remember.checked=true;\n  remember.dispatchEvent(new Event('change',{bubbles:true}));\n  const optIn=window.localStorage.getItem(storedKey).includes('NEVER_SAVE_THIS_KEY');\n  remember.checked=false;\n  remember.dispatchEvent(new Event('change',{bubbles:true}));\n  const revoked=!window.localStorage.getItem(storedKey).includes('NEVER_SAVE_THIS_KEY');\n  document.querySelector('#ai-clear-settings').click();\n  const cleared=window.localStorage.getItem(storedKey)===null &&\n    document.querySelector('#ai-key').value==='' &&\n    (document.querySelector('#rows').textContent.match(/Нет данных/gu)||[]).length>=2;\n  window.fetch=existingFetch;\n  return {initial,inUpload,multipleContracts,configPrompt,defaultSaved,scoped,calls,halfway,valueCount,citation,optIn,revoked,cleared};\n})()");
    assert(inlineAI.initial && inlineAI.inUpload && inlineAI.multipleContracts && inlineAI.configPrompt && inlineAI.defaultSaved,
      'inline AI controls and no hidden key storage: '+JSON.stringify(inlineAI));
    assert(inlineAI.scoped && inlineAI.calls === 2 && inlineAI.halfway &&
      inlineAI.valueCount === 2 && inlineAI.citation,
      'one-field-at-a-time source-grounded AI recovery: '+JSON.stringify(inlineAI));
    assert(inlineAI.optIn && inlineAI.revoked && inlineAI.cleared,
      'browser settings storage consent/revoke/reset: '+JSON.stringify(inlineAI));
    // Exercise an actual mouse wheel event over the right column, not only
    // a programmatic scrollTop assignment or injected layout spacer.
    const wheelStart=await evaluate("(()=>{const side=document.querySelector('.workspace-aside');side.scrollTop=0;const r=side.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(Math.max(80,Math.min(innerHeight-80,r.y+150))),pageY:scrollY,scrollY:side.scrollTop,position:getComputedStyle(side).position,overflow:getComputedStyle(side).overflowY}})()");
    assert(wheelStart.position==='sticky' && wheelStart.overflow==='auto',
      'right-hand source column uses a single independent scroll area: '+JSON.stringify(wheelStart));
    await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:wheelStart.x,y:wheelStart.y,
      deltaX:0,deltaY:320});
    await delay(180);
    const wheelAfter=await evaluate("({pageY:scrollY,railY:document.querySelector('.workspace-aside').scrollTop,quoteScroll:document.querySelector('.inspector').scrollTop,sourceScroll:document.querySelector('.source-view').scrollTop})");
    assert(wheelAfter.railY>=80 && wheelAfter.quoteScroll===0 && wheelAfter.sourceScroll===0,
      'real wheel should scroll ONE rail, not quote or original TXT: '+JSON.stringify({wheelStart,wheelAfter}));
    await evaluate("document.querySelector('.workspace-aside').scrollTop=0");
    const railAudit=await evaluate("(async()=>{\n  const side=document.querySelector('.workspace-aside');\n  const inspector=side.querySelector('.inspector');\n  const source=side.querySelector('.source-view');\n  const main=document.querySelector('.workspace-main');\n  const spacer=document.createElement('div');\n  spacer.style.height='1400px'; spacer.setAttribute('aria-hidden','true');\n  main.append(spacer);\n  // Simulate a long evidence/history panel; its FULL natural height must be\n  // shown, rather than clipped into a nested, independently scrollable box.\n  const extra=document.createElement('div');\n  extra.textContent=('Проверяемый исторический фрагмент с обоснованием и дополнительными пунктами. ').repeat(75);\n  inspector.querySelector('#inspect-content').append(extra);\n  await new Promise(resolve=>requestAnimationFrame(resolve));\n  const style=getComputedStyle(side);\n  const inspectorStyle=getComputedStyle(inspector);\n  const sourceStyle=getComputedStyle(source);\n  const viewport={width:innerWidth,height:innerHeight};\n  const rail=style.position==='sticky' && style.overflowY==='auto' &&\n    side.clientHeight<=innerHeight && side.scrollHeight>side.clientHeight;\n  const expanded=inspectorStyle.position==='static' &&\n    inspectorStyle.overflowY==='visible' && inspectorStyle.maxHeight==='none' &&\n    inspector.clientHeight>Math.round(innerHeight*.50) &&\n    inspector.scrollHeight<=inspector.clientHeight+3;\n  const wholeText=sourceStyle.overflowY==='visible' && sourceStyle.maxHeight==='none' &&\n    source.scrollHeight<=source.clientHeight+3;\n  const start=document.querySelector('.workspace').getBoundingClientRect().top+scrollY;\n  window.scrollTo(0,start+200);\n  await new Promise(resolve=>requestAnimationFrame(resolve));\n  const bodyScroll=scrollY>300;\n  const stickyTop=side.getBoundingClientRect().top;\n  const pinned=stickyTop>=8 && stickyTop<=20;\n  const insBefore=inspector.getBoundingClientRect().top;\n  const docBefore=side.querySelector('.document-card').getBoundingClientRect().top;\n  side.scrollTop=Math.min(180,side.scrollHeight-side.clientHeight);\n  await new Promise(resolve=>requestAnimationFrame(resolve));\n  const moved=side.scrollTop>60;\n  const inspectorDelta=insBefore-inspector.getBoundingClientRect().top;\n  const docDelta=docBefore-side.querySelector('.document-card').getBoundingClientRect().top;\n  const together=Math.abs(inspectorDelta-side.scrollTop)<5 &&\n    Math.abs(docDelta-side.scrollTop)<5 &&\n    Math.abs(inspectorDelta-docDelta)<5;\n  // Attempting to scroll a child must never create an independent scroll.\n  inspector.scrollTop=100;\n  source.scrollTop=100;\n  const noChildScroll=inspector.scrollTop===0 && source.scrollTop===0;\n  extra.remove(); spacer.remove();\n  window.scrollTo(0,0);side.scrollTop=0;\n  return {viewport,rail,expanded,wholeText,bodyScroll,pinned,moved,\n    together,noChildScroll,inspectorDelta,docDelta,stickyTop};\n})()");
    assert(railAudit.rail && railAudit.expanded && railAudit.wholeText &&
      railAudit.bodyScroll && railAudit.pinned && railAudit.moved &&
      railAudit.together && railAudit.noChildScroll,
      'desktop single-scroll rail moves BOTH full-height evidence cards together: '+JSON.stringify(railAudit));
    await call('Emulation.setDeviceMetricsOverride',
      {width:430,height:900,deviceScaleFactor:1,mobile:true});
    const mobileAudit=await evaluate("(async()=>{\n  await new Promise(resolve=>requestAnimationFrame(resolve));\n  const side=document.querySelector('.workspace-aside');\n  const inspector=side.querySelector('.inspector');\n  const style=getComputedStyle(side);\n  const iStyle=getComputedStyle(inspector);\n  const sourceStyle=getComputedStyle(side.querySelector('.source-view'));\n  const box=side.getBoundingClientRect();\n  const ok=innerWidth<=1100 && style.position==='static' &&\n    style.maxHeight==='none' && iStyle.position==='static' &&\n    iStyle.overflowY==='visible' && sourceStyle.overflowY==='visible' &&\n    style.overflowY==='visible' && box.width>0 &&\n    box.left>=-1 && box.right<=innerWidth+1;\n  return {ok,width:innerWidth,position:style.position,height:style.height,\n    overflow:style.overflowY,rect:box.toJSON()};\n})()");
    assert(mobileAudit.ok,'mobile inspector returns to natural page flow: '+JSON.stringify(mobileAudit));
    console.log('Browser E2E OK: historical as-of date, single-scroll full-height evidence rail, mobile flow and BYOK AI.');

  } finally {
    ws?.close();
    chrome?.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    for (const dir of tempDirs) await rm(dir, { force:true, recursive:true, maxRetries:3, retryDelay:200 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
