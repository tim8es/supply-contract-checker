import { analyze, deliveriesBefore, toPublicResult } from './engine.mjs';
import { penaltyRateExtractor } from './extractors/penalty.mjs';
import { fetchFallbackCandidates, collectFallbackTargets } from './ai-fallback.mjs';

const $ = id => document.getElementById(id);
const money = n => n == null ? 'Нет данных' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n) + ' ₽';
const dateLabel = v => v ? v.split('-').reverse().join('.') : 'Нет данных';
const percentDaily = n => n == null ? 'Нет данных' : new Intl.NumberFormat('ru-RU',{maximumFractionDigits:4}).format(n) + '% / день';
const MAX_FILES = 100;
const MAX_SIZE = 2_000_000;
let inputs = [];
let analysis = null;
let filter = 'all';
let activeEvidence = null;
let search = '';
let aiCandidates = null;
let aiController = null;
let aiRunVersion = 0;
let aiComparison = null;
function invalidateAI({wipeKey=false}={}) {
  aiRunVersion++;
  aiController?.abort(); aiController=null; aiCandidates=null; aiComparison=null;
  $('ai-impact').hidden=true;
  $('ai-impact-list').replaceChildren();
  $('ai-run').disabled = !inputs.length;
  if (wipeKey) $('ai-key').value='';
  $('ai-status').textContent = 'По умолчанию анализ полностью локальный.';
}

function el(type, text = null, className = '') {
  const node = document.createElement(type);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function message(text, isError = false) {
  const target = $('message');
  target.textContent = text;
  target.classList.toggle('error', isError);
}
function setMetric(id, value) { $(id).textContent = String(value); }

function showDocument(name, from = 0, to = from) {
  if (!analysis) return;
  const doc = analysis.documents.find(x => x.name === name);
  if (!doc) return;
  $('document-select').value = name;
  const source = $('source');
  source.replaceChildren();
  for (const line of doc.lines) {
    const div = el('div', null, 'source-line' + (from && line.no >= from && line.no <= to ? ' highlight' : ''));
    div.dataset.line = String(line.no);
    div.append(el('span', String(line.no), 'line-no'), el('span', line.text || ' ', 'line-content'));
    source.append(div);
  }
  if (from) {
    const target = [...source.querySelectorAll('.source-line')].find(x => x.dataset.line === String(from));
    target?.scrollIntoView({ block: 'center', behavior: 'instant' });
  } else source.scrollTop = 0;
}

function renderFieldHistory(row, label) {
  const field = label === 'Сумма договора' ? 'amount'
    : label === 'Срок поставки' ? 'deadline'
    : label === 'Ставка неустойки' ? 'penaltyRate' : null;
  const entries = field && row?.history?.[field];
  if (!entries || entries.length < 2) return;
  const history = el('section', null, 'term-history');
  history.append(el('h3', 'История условия'));
  const timeline = el('ol', null, 'term-timeline');
  for (const entry of entries) {
    const current = row[field] ?? row.extraFields?.[field] ?? null;
    const active = !!current && entry.evidence &&
      entry.evidence.file === current.evidence?.file &&
      entry.value === current.value;
    const item = el('li', null, 'term-event' + (active ? ' active' : ''));
    const heading = el('div', null, 'term-event-head');
    const value = entry.value == null ? 'Значение не определено'
      : field === 'amount' ? money(entry.value) : field === 'penaltyRate' ? percentDaily(entry.value) : dateLabel(entry.value);
    heading.append(el('strong', value));
    heading.append(el('span', active ? 'Действует' :
      entry.outcome === 'conflict' ? 'Конфликт' :
      entry.outcome === 'unresolved' ? 'На проверку' :
      entry.outcome === 'base' ? 'Исходное условие' : 'Заменено',
    'term-event-status'));
    item.append(heading);
    if (entry.via === 'ai') item.append(el('span','ИИ-гипотеза · проверить','ai-origin'));
    const meta = el('div', entry.file + (entry.effective ? ' · с ' + dateLabel(entry.effective) : ''),
      'term-event-meta');
    item.append(meta);
    if (entry.evidence) {
      const jump = el('button', 'Открыть исходный абзац ↗', 'inspect-action');
      jump.type = 'button';
      jump.addEventListener('click', () => showDocument(entry.evidence.file,
        entry.evidence.line, entry.evidence.endLine));
      item.append(jump);
    } else {
      item.append(el('span', 'Требуется проверить формулировку изменения',
        'term-event-note'));
    }
    timeline.append(item);
  }
  history.append(timeline);
  $('inspect-content').append(history);
}

function inspect(row, field, value, evidence, description) {
  activeEvidence = evidence;
  $('inspect-title').textContent = row ? row.id + ' · ' + field : field;
  $('inspect-subtitle').textContent = description || 'Подтверждение по исходному документу';
  const content = $('inspect-content');
  content.replaceChildren();
  const label = el('p', 'ЗНАЧЕНИЕ', 'fact-label');
  const output = el('p', value, 'fact-value');
  content.append(label, output);
  if (evidence) {
    const box = el('div', null, 'evidence-box');
    box.append(el('span', evidence.file + ' · строки ' +
      (evidence.line === evidence.endLine ? evidence.line : evidence.line + '–' + evidence.endLine),
      'citation-meta'));
    box.append(el('blockquote', evidence.quote));
    content.append(box);
    const jump = el('button', 'Показать в исходном тексте ↗', 'inspect-action');
    jump.type = 'button';
    jump.addEventListener('click', () => {
      showDocument(evidence.file, evidence.line, evidence.endLine || evidence.line);
      $('source').focus({ preventScroll: true });
      $('document-select').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    content.append(jump);
    showDocument(evidence.file, evidence.line, evidence.endLine || evidence.line);
  } else {
    content.append(el('p', 'Подтверждённого основания для этого значения нет. Поле требует ручной проверки.', 'issue'));
    if (row?.review?.length) content.append(el('p', row.review.join(' · '), 'hint'));
  }
  renderFieldHistory(row, field);
}

function sourceButton(row, field, data, format) {
  const btn = el('button', '↗ Проверить источник', 'evidence-link');
  btn.type = 'button';
  btn.title = data.evidence.file + ', строки ' + data.evidence.line + '–' + data.evidence.endLine;
  btn.addEventListener('click', () => inspect(row, field, format(data.value), data.evidence,
    data.via === 'ai' ? 'ИИ-гипотеза, проверенная по дословной цитате: требуется ручная проверка смысла' :
      data.changedBy ? 'Условие изменено документом ' + data.changedBy : 'Условие из основного договора'));
  return btn;
}

function valueCell(row, field, formatter, label) {
  const cell = el('td');
  const data = row[field] ?? row.extraFields?.[field] ?? null;
  cell.append(el('strong', data ? formatter(data.value) : 'Нет данных', 'value' + (data ? '' : ' missing')));
  if (data?.evidence) {
    if (data.via === 'ai') cell.append(el('span','ИИ · проверить','ai-origin'));
    cell.append(sourceButton(row, label, data, formatter));
  }
  else {
    const explain = el('button', '↗ Почему нет данных?', 'evidence-link');
    explain.type = 'button';
    explain.addEventListener('click', () => inspect(row, label, 'Нет данных', null,
      'Значение не удалось подтвердить по загруженным документам'));
    cell.append(explain);
  }
  return cell;
}

function rowsVisible() {
  if (!analysis) return [];
  let rows = analysis.rows;
  if (filter === 'before') rows = deliveriesBefore(rows);
  if (filter === 'review') rows = rows.filter(x => x.review.length > 0);
  if (search.trim()) {
    const term = search.toLocaleLowerCase('ru');
    rows = rows.filter(x => (x.id + ' ' + (x.supplier || '')).toLocaleLowerCase('ru').includes(term));
  }
  return rows;
}
function renderTable() {
  const container = $('rows');
  container.replaceChildren();
  if (!analysis) return;
  const rows = rowsVisible();
  for (const row of rows) {
    const tr = el('tr');
    const meta = el('td');
    const name = el('button', row.id, 'contract-id evidence-link');
    name.type = 'button';
    name.addEventListener('click', () => inspect(row, 'Карточка договора', row.id, row.supplierEvidence ||
      analysis.documents.find(d => d.name === row.source)?.blocks?.[0] && {
        file: row.source,
        line: analysis.documents.find(d => d.name === row.source).blocks[0].startLine,
        endLine: analysis.documents.find(d => d.name === row.source).blocks[0].endLine,
        quote: analysis.documents.find(d => d.name === row.source).blocks[0].text
      }, row.documents.length + ' связанных документов'));
    meta.append(name, el('span', row.supplier || 'Поставщик не установлен', 'supplier'));
    tr.append(meta, valueCell(row, 'amount', money, 'Сумма договора'),
      valueCell(row, 'deadline', dateLabel, 'Срок поставки'),
      valueCell(row, 'penaltyRate', percentDaily, 'Ставка неустойки'));
    const status = el('td');
    const warn = row.review.length > 0;
    status.append(el('span', warn ? '● Проверить' : '✓ Подтверждено', 'status ' + (warn ? 'review' : 'good')));
    tr.append(status);
    container.append(tr);
  }
  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', analysis.rows.length ? 'Нет договоров по выбранному фильтру.' : 'Договоры не найдены.', 'empty-cell');
    td.colSpan = 5; tr.append(td); container.append(tr);
  }
  $('table-count').textContent = 'Показано ' + rows.length + ' из ' + analysis.rows.length +
    ' · проверка на ' + dateLabel(analysis.asOf) +
    (filter === 'before' ? ' · есть несогласованные переносы — см. ниже' : '');
}
function proposalLine(box, row, field, value, label, formatter) {
  if (!value) return;
  const div = el('p', null, 'proposal-description');
  div.append(document.createTextNode(label + ': ' + formatter(value.value) + ' · '));
  const btn = el('button', 'Цитата ↗');
  btn.type = 'button';
  btn.addEventListener('click', () => inspect(row, label, formatter(value.value), value.evidence,
    'Предложение не является действующим изменением условий'));
  div.append(btn);
  box.append(div);
}
function renderProposals() {
  const host = $('proposals');
  host.replaceChildren();
  let count = 0;
  for (const row of rowsVisible()) for (const proposal of row.proposals) {
    const item = el('div', null, 'proposal');
    item.append(el('div', '↗', 'proposal-badge'));
    const box = el('div', null, 'proposal-body');
    box.append(el('p', row.id + ' · ' + (proposal.kind === 'draft' ? 'Проект соглашения' : 'Письмо поставщика'), 'proposal-title'));
    box.append(el('p', proposal.file, 'proposal-meta'));
    proposalLine(box, row, 'amount', proposal.amount, 'Предложенная сумма', money);
    proposalLine(box, row, 'deadline', proposal.deadline, 'Предложенный срок', dateLabel);
    proposalLine(box, row, 'penaltyRate', proposal.extraFields?.penaltyRate, 'Предложенная неустойка', percentDaily);
    if (!proposal.amount && !proposal.deadline) box.append(el('p', 'Нужна ручная проверка предложения', 'proposal-description'));
    item.append(box); host.append(item); count++;
  }
  if (!count) host.append(el('p', 'Несогласованных предложений об изменении не найдено.', 'blank'));
}
function updateAIEligibility() {
  if (!inputs.length) {
    $('ai-eligibility').textContent='Загрузите документы для оценки возможной пользы AI.';
    return;
  }
  const {targets, omitted}=collectFallbackTargets(inputs,$('asof').value);
  const fieldCount=targets.reduce((sum,target)=>sum+target.missing.length,0);
  $('ai-eligibility').textContent=fieldCount
    ? 'Модель может проверить '+fieldCount+' нераспознанных полей в '+targets.length+
      ' документах'+(omitted?' (ещё '+omitted+' за лимитом запросов)':'')+
      '. Отсутствующие в исходных документах значения она не восстановит.'
    : 'Для AI нет подходящих пропусков: локальный парсер уже нашёл значения либо документы требуют ручной проверки.';
}
function showAIComparison(before, after, report) {
  aiComparison={before,after,report};
  const panel=$('ai-impact');
  const list=$('ai-impact-list');
  panel.hidden=false; list.replaceChildren();
  let improved=0;
  for (const base of before.rows) {
    const updated=after.rows.find(row=>row.id===base.id);
    if (!updated) continue;
    for (const field of ['amount','deadline']) {
      if (base[field]) continue;
      const data=updated[field];
      const title=field==='amount'?'Сумма договора':'Срок поставки';
      const format=field==='amount'?money:dateLabel;
      const item=el('div',null,'ai-impact-item');
      const head=el('strong',base.id+' · '+title,'ai-impact-name');
      const values=el('div',null,'ai-impact-values');
      values.append(el('span','До AI: Нет данных'));
      const added=!!data?.via && data.via==='ai';
      values.append(el('span',added ? 'После AI: '+format(data.value) :
        'После AI: Нет подтверждённого значения',added?'ai-impact-good':'ai-impact-unchanged'));
      item.append(head,values);
      if (added && data.evidence) {
        improved++;
        const jump=el('button','Проверить исходную цитату ↗','evidence-link');
        jump.type='button';
        jump.addEventListener('click',()=>inspect(updated,title,format(data.value),data.evidence,
          'ИИ-гипотеза: цитата подтверждена, юридический смысл требует проверки'));
        item.append(jump);
      }
      list.append(item);
    }
  }
  $('ai-impact-summary').textContent='Добавлено подтверждённых по источнику значений: '+improved+
    ' из '+report.requestedFields+' запрошенных полей. Модель вернула «нет данных»: '+
    report.emptyFields+'; кандидатов отклонено проверками: '+report.rejectedFields+
    '; сетевых/API-ошибок: '+report.failedRequests+'. '+
    (improved ? 'Найдите пометку «ИИ · проверить» в таблице.' :
      'Таблица не изменилась: подтверждённых новых данных модель не предоставила.');
}
function renderIssues() {
  const host = $('issues'); host.replaceChildren();
  const items = [...analysis.issues];
  for (const row of analysis.rows) items.push(...row.review.map(x => row.id + ': ' + x));
  $('issues-card').hidden = items.length === 0;
  for (const issue of items) host.append(el('p', issue, 'issue'));
}
function render() {
  if (!analysis) return;
  setMetric('metric-count', analysis.rows.length);
  const confirmed = analysis.rows.reduce((n, x) => n + Number(!!x.amount?.evidence) + Number(!!x.deadline?.evidence), 0);
  setMetric('metric-confirmed', confirmed + ' / ' + (analysis.rows.length * 2));
  setMetric('metric-review', analysis.rows.filter(x => x.review.length).length + analysis.issues.length);
  setMetric('metric-proposals', analysis.rows.reduce((n, x) => n + x.proposals.length, 0));
  renderTable();
  renderProposals();
  renderIssues();
  $('doc-count').textContent = String(analysis.documents.length);
  $('export').disabled = false;
}

function recalculate() {
  if (!inputs.length) return;
  try {
    analysis = analyze(inputs, $('asof').value,{extractors:[penaltyRateExtractor],aiCandidates});
    const select = $('document-select');
    const chosen = select.value;
    select.replaceChildren();
    for (const doc of analysis.documents) {
      const opt = el('option', doc.name);
      opt.value = doc.name; select.append(opt);
    }
    select.disabled = false;
    showDocument(analysis.documents.some(d => d.name === chosen) ? chosen : analysis.documents[0]?.name);
    $('inspect-title').textContent = 'Инспектор условий';
    $('inspect-subtitle').textContent = 'Нажмите на сумму или срок в таблице, чтобы проверить основание.';
    $('inspect-content').replaceChildren(el('div', 'Выберите значение в реестре. Исходная цитата появится здесь.', 'inspect-placeholder'));
    render();
    updateAIEligibility();
    $('ai-run').disabled = !!aiController || !inputs.length;
    message('Готово: ' + analysis.documents.length + ' документов, ' + analysis.rows.length +
      ' договоров. ' + (aiCandidates ? 'AI-кандидаты выделены для ручной проверки; TXT ранее передавались провайдеру.' :
      'TXT обработаны локально; ничего не отправлено на сервер.'));
  } catch (error) { message('Не удалось обработать файлы: ' + error.message, true); }
}

async function loadFiles(files) {
  if (!files.length) return;
  if (files.length > MAX_FILES) return message('Можно загрузить не более ' + MAX_FILES + ' файлов за один раз.', true);
  if (files.some(f => !f.name.toLowerCase().endsWith('.txt') || f.size > MAX_SIZE))
    return message('Поддерживаются только TXT размером не более 2 МБ каждый.', true);
  // Duplicate basenames undermine source navigation: don't silently overwrite them.
  const names = files.map(f => f.name);
  if (new Set(names).size !== names.length)
    return message('Обнаружены повторяющиеся имена файлов. Переименуйте файлы для однозначной ссылки на источник.', true);
  try {
    invalidateAI();
    inputs = await Promise.all(files.map(async f => ({ name: f.name, text: await f.text() })));
    filter = 'all'; search = ''; $('search').value = '';
    document.querySelectorAll('[data-filter]').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === 'all'));
    recalculate();
  } catch (error) { message('Ошибка чтения TXT: ' + error.message, true); }
}
$('files').addEventListener('change', e => loadFiles([...e.target.files]));
$('asof').addEventListener('change', () => { invalidateAI(); recalculate(); });
$('document-select').addEventListener('change', e => showDocument(e.target.value));
$('search').addEventListener('input', e => { search = e.target.value; renderTable(); renderProposals(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(other => other.classList.toggle('active', other === button));
  renderTable();
  renderProposals();
}));
$('demo').addEventListener('click', async () => {
  try {
    const names = ['01_contract.txt','02_amendment_signed.txt','03_contract.txt',
      '04_contract.txt','05_supplier_email.txt','06_amendment_draft.txt'];
    const data = await Promise.all(names.map(async name => {
      const response = await fetch('./documents/' + name);
      if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
      return { name, text: await response.text() };
    }));
    invalidateAI();
    inputs = data; filter = 'all'; search = ''; $('search').value = '';
    document.querySelectorAll('[data-filter]').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === 'all'));
    recalculate();
  } catch (error) { message('Учебные файлы недоступны: ' + error.message, true); }
});
$('ai-example').addEventListener('click', async () => {
  const button=$('ai-example');
  button.disabled=true;
  try {
    const response=await fetch('./documents/07_ai_fallback_example.txt');
    if (!response.ok) throw Error('HTTP '+response.status);
    const text=await response.text();
    invalidateAI();
    inputs=[{name:'07_ai_fallback_example.txt',text}];
    filter='all'; search=''; $('search').value='';
    document.querySelectorAll('[data-filter]').forEach(btn=>
      btn.classList.toggle('active',btn.dataset.filter==='all'));
    recalculate();
    $('ai-panel').open=true;
    message('Загружен отдельный синтетический договор для сравнения AI с локальными правилами. '+
      'Сумма и срок должны оставаться «Нет данных» до проверки моделью.');
  } catch(error) {
    message('Не удалось открыть AI-пример: '+error.message,true);
  } finally {button.disabled=false;}
});
$('ai-run').addEventListener('click', async () => {
  if (!inputs.length || aiController) return;
  const run = ++aiRunVersion;
  const controller = new AbortController();
  aiController = controller;
  const timeout=setTimeout(()=>controller.abort(),90000);
  $('ai-run').disabled=true;
  $('ai-status').textContent='Подготовка запроса. Договоры будут переданы выбранному API.';
  try {
    const baseline=analysis;
    const result=await fetchFallbackCandidates(inputs,$('asof').value,{
      endpoint:$('ai-endpoint').value,
      model:$('ai-model').value,
      apiKey:$('ai-key').value,
      signal:controller.signal,
      onProgress:({completed,total,filename})=>{
        if (run===aiRunVersion) $('ai-status').textContent='Обработано '+completed+'/'+total+
          (filename?' · '+filename:'');
      }
    });
    if(run!==aiRunVersion || controller.signal.aborted) return;
    aiCandidates=result.candidates;
    recalculate();
    showAIComparison(baseline,analysis,result);
    $('ai-status').textContent='AI: '+result.accepted+' подтверждённых по источнику кандидатов из '+
      result.requested+' документов; отклонений: '+result.failures.length+
      (result.omitted?'; лимит запросов: пропущено '+result.omitted:'')+
      '. Гипотезы требуют ручной проверки.';
    if(result.failures.length) message('AI: '+result.failures.join('; ')+
      '. Если API не поддерживает CORS, понадобится серверный прокси.',true);
  } catch(error) {
    if(run===aiRunVersion) $('ai-status').textContent='AI-запрос не выполнен: '+error.message+
      '. Проверьте endpoint, модель, ключ и CORS.';
  } finally {
    clearTimeout(timeout);
    if(run===aiRunVersion) {
      aiController=null;
      $('ai-run').disabled=!inputs.length;
    }
  }
});
$('ai-reset').addEventListener('click',()=>{
  invalidateAI({wipeKey:true});
  if(inputs.length) recalculate();
});
$('export').addEventListener('click', () => {
  if (!analysis) return;
  const json = JSON.stringify(toPublicResult(analysis), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const anchor = el('a'); anchor.href = url;
  anchor.download = 'contracts-' + analysis.asOf + '.json';
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// Reproducible browser smoke-test / demo link; never uploads user files.
const query=new URLSearchParams(window.location.search);
if (query.get('ai-demo')==='1') $('ai-example').click();
else if (query.get('demo')==='1') $('demo').click();
