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
    await evaluate("new Promise((resolve,reject)=>{let n=0;const id=setInterval(()=>{if(document.querySelector('#rows')?.textContent.includes('STN-103')){clearInterval(id);resolve(true)}else if(++n>100){clearInterval(id);reject(Error('demo data not loaded'))}},100)})");
    let rows = await evaluate("document.querySelector('#rows').innerText");
    assert(rows.includes('STN-101') && rows.includes('STN-102') && rows.includes('STN-103'), 'demo table');

    await evaluate("document.querySelector('[data-filter=before]').click()");
    rows = await evaluate("document.querySelector('#rows').innerText");
    assert(rows.includes('STN-102') && !rows.includes('STN-101') && !rows.includes('STN-103'), 'delivery filter');
    const filteredProposals = await evaluate("document.querySelector('#proposals').innerText");
    assert(filteredProposals.includes('STN-102') && !filteredProposals.includes('STN-101'), 'proposal filter relevance');

    await evaluate("document.querySelector('[data-filter=all]').click()");
    await evaluate("document.querySelector('#rows tr:first-child td:nth-child(2) button').click()");
    const proof = await evaluate("({file:document.querySelector('#document-select').value,quote:document.querySelector('#inspect-content blockquote')?.innerText,highlights:document.querySelectorAll('.source-line.highlight').length})");
    assert(proof.file === '02_amendment_signed.txt', 'amended source file');
    assert(proof.quote.includes('1 380 000'), 'source quote');
    assert(proof.highlights >= 1, 'selected original paragraph');
    const timeline = await evaluate("document.querySelector('.term-history')?.innerText || ''");
    const normalizedTimeline = timeline.replace(/\s/gu, ' ');
    assert(normalizedTimeline.includes('1 200 000') && normalizedTimeline.includes('1 380 000'), 'old and new amount timeline: ' + JSON.stringify(normalizedTimeline));
    assert(timeline.includes('Действует') && timeline.includes('Исходное условие'), 'history status');
    await evaluate("document.querySelector('#rows tr:first-child td:nth-child(4) button').click()");
    const penaltyProof=await evaluate("({value:document.querySelector('#inspect-content .fact-value')?.innerText,source:document.querySelector('#document-select').value,quote:document.querySelector('#inspect-content blockquote')?.innerText})");
    assert(penaltyProof.source === '01_contract.txt', 'optional penalty evidence points at base contract');
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
    const aiProof = await evaluate("(async()=>{\n  const lines=[\n    'ДОГОВОР ПОСТАВКИ № BYK-999',\n    'Статус: подписан обеими сторонами 01.02.2026.',\n    '',\n    'Поставщик: ООО «Проверка AI».',\n    '',\n    'Стоимость продукции в рамках настоящего договора равна 640 000 рублей.',\n    'Весь товар должен быть поставлен до 11 июня 2026 года.'\n  ];\n  const txt=lines.join(String.fromCharCode(10));\n  const files=new DataTransfer();\n  files.items.add(new File([txt],'novel-wording.txt',{type:'text/plain'}));\n  const input=document.querySelector('#files');\n  input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));\n  await new Promise((resolve,reject)=>{\n    let n=0;const t=setInterval(()=>{\n      if(document.querySelector('#rows')?.textContent.includes('BYK-999')){\n        clearInterval(t);resolve();\n      } else if(++n>100){clearInterval(t);reject(Error('AI test document missing'))}\n    },100);\n  });\n  const before=document.querySelector('#rows').innerText;\n  if(!before.includes('Нет данных'))throw Error('New wording should be unknown before AI');\n  const originalFetch=window.fetch;\n  window.fetch=async (url,opts)=>{\n    if(String(url)==='https://example.test/v1/chat/completions'){\n      const payload=JSON.parse(opts.body);\n      if(!payload.messages[1].content.includes('Стоимость продукции'))throw Error('No source in request');\n      if(!opts.headers.Authorization.includes('E2E_ONLY_SECRET'))throw Error('Missing user key');\n      return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({\n        amount:{blockLine:6,valueText:'640 000'},\n        deadline:{blockLine:6,valueText:'11 июня 2026 года'}\n      })}}]})};\n    }\n    return originalFetch(url,opts);\n  };\n  document.querySelector('#ai-endpoint').value='https://example.test/v1/chat/completions';\n  document.querySelector('#ai-model').value='mock-model';\n  document.querySelector('#ai-key').value='E2E_ONLY_SECRET';\n  document.querySelector('#ai-run').click();\n  await new Promise((resolve,reject)=>{\n    let n=0;const t=setInterval(()=>{\n      if(document.querySelector('#ai-status')?.textContent.includes('AI: 2')){\n        clearInterval(t);resolve();\n      } else if(++n>100){clearInterval(t);reject(Error(document.querySelector('#ai-status')?.textContent))}\n    },100);\n  });\n  const after=document.querySelector('#rows').innerText;\n  const withBadge=after.includes('640') && after.includes('11.06.2026') && after.includes('ИИ · проверить');\n  document.querySelector('#rows tr td:nth-child(2) button').click();\n  const evidence=document.querySelector('#inspect-content blockquote')?.innerText||'';\n  const file=document.querySelector('#document-select').value;\n  const exported=JSON.stringify({contracts:document.querySelector('#rows').innerText});\n  document.querySelector('#ai-reset').click();\n  const reset=document.querySelector('#rows').innerText.includes('Нет данных') &&\n    document.querySelector('#ai-key').value==='';\n  window.fetch=originalFetch;\n  return {withBadge,after:after.slice(0,500),status:document.querySelector('#ai-status')?.textContent,quote:evidence.includes('640 000'),file,reset,keyLeak:exported.includes('E2E_ONLY_SECRET')};\n})()");
    assert(aiProof.withBadge, 'AI fallback adds visibly reviewable source-grounded fields: '+JSON.stringify(aiProof));
    assert(aiProof.quote && aiProof.file === 'novel-wording.txt', 'AI-assisted original quote navigation');
    assert(aiProof.reset && !aiProof.keyLeak, 'AI key and results cleared without token leak');
    console.log('Browser E2E OK: demo, delivery filter, source citation, new upload, mock BYOK fallback and reset.');
  } finally {
    ws?.close();
    chrome?.kill('SIGTERM');
    await new Promise(resolve => server.close(resolve));
    for (const dir of tempDirs) await rm(dir, { force:true, recursive:true, maxRetries:3, retryDelay:200 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
