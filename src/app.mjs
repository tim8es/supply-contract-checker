import { analyze, deliveriesBefore, toPublicResult } from './engine.mjs';

const $ = id => document.getElementById(id);
const money = n => n == null ? 'Нет данных' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n) + ' ₽';
const dateLabel = v => v ? v.split('-').reverse().join('.') : 'Нет данных';
const MAX_FILES = 100;
const MAX_SIZE = 2_000_000;
let inputs = [];
let analysis = null;
let filter = 'all';
let activeEvidence = null;
let search = '';

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
  }
}

function sourceButton(row, field, data, format) {
  const btn = el('button', '↗ Проверить источник', 'evidence-link');
  btn.type = 'button';
  btn.title = data.evidence.file + ', строки ' + data.evidence.line + '–' + data.evidence.endLine;
  btn.addEventListener('click', () => inspect(row, field, format(data.value), data.evidence,
    data.changedBy ? 'Условие изменено документом ' + data.changedBy : 'Условие из основного договора'));
  return btn;
}

function valueCell(row, field, formatter, label) {
  const cell = el('td');
  const data = row[field];
  cell.append(el('strong', data ? formatter(data.value) : 'Нет данных', 'value' + (data ? '' : ' missing')));
  if (data?.evidence) cell.append(sourceButton(row, label, data, formatter));
  else cell.append(el('small', 'Требует проверки', 'hint'));
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
      valueCell(row, 'deadline', dateLabel, 'Срок поставки'));
    const status = el('td');
    const warn = row.review.length > 0;
    status.append(el('span', warn ? '● Проверить' : '✓ Подтверждено', 'status ' + (warn ? 'review' : 'good')));
    tr.append(status);
    container.append(tr);
  }
  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', analysis.rows.length ? 'Нет договоров по выбранному фильтру.' : 'Договоры не найдены.', 'empty-cell');
    td.colSpan = 4; tr.append(td); container.append(tr);
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
  for (const row of analysis?.rows || []) for (const proposal of row.proposals) {
    const item = el('div', null, 'proposal');
    item.append(el('div', '↗', 'proposal-badge'));
    const box = el('div', null, 'proposal-body');
    box.append(el('p', row.id + ' · ' + (proposal.kind === 'draft' ? 'Проект соглашения' : 'Письмо поставщика'), 'proposal-title'));
    box.append(el('p', proposal.file, 'proposal-meta'));
    proposalLine(box, row, 'amount', proposal.amount, 'Предложенная сумма', money);
    proposalLine(box, row, 'deadline', proposal.deadline, 'Предложенный срок', dateLabel);
    if (!proposal.amount && !proposal.deadline) box.append(el('p', 'Нужна ручная проверка предложения', 'proposal-description'));
    item.append(box); host.append(item); count++;
  }
  if (!count) host.append(el('p', 'Несогласованных предложений об изменении не найдено.', 'blank'));
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
    analysis = analyze(inputs, $('asof').value);
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
    message('Готово: ' + analysis.documents.length + ' документов, ' + analysis.rows.length +
      ' договоров. TXT обработаны локально; ничего не отправлено на сервер.');
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
    inputs = await Promise.all(files.map(async f => ({ name: f.name, text: await f.text() })));
    filter = 'all'; search = ''; $('search').value = '';
    document.querySelectorAll('[data-filter]').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === 'all'));
    recalculate();
  } catch (error) { message('Ошибка чтения TXT: ' + error.message, true); }
}
$('files').addEventListener('change', e => loadFiles([...e.target.files]));
$('asof').addEventListener('change', recalculate);
$('document-select').addEventListener('change', e => showDocument(e.target.value));
$('search').addEventListener('input', e => { search = e.target.value; renderTable(); });
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(other => other.classList.toggle('active', other === button));
  renderTable();
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
    inputs = data; filter = 'all'; search = ''; $('search').value = '';
    document.querySelectorAll('[data-filter]').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === 'all'));
    recalculate();
  } catch (error) { message('Учебные файлы недоступны: ' + error.message, true); }
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
