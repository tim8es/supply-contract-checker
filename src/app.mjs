import { analyze, deliveriesBefore } from './engine.mjs';

const byId = id => document.getElementById(id);
const fmtAmount = value => value === null ? 'Нет данных' : new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const fmtDate = value => value ? value.split('-').reverse().join('.') : 'Нет данных';
let files = [];
let result = null;
let filter = 'all';

function textElement(tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function sourceButton(source, label) {
  if (!source) return textElement('span', 'Источник отсутствует', 'muted');
  const button = textElement('button', label || source.file + ':' + source.line, 'evidence');
  button.type = 'button';
  button.title = source.quote;
  button.addEventListener('click', () => showSource(source.file, source.line));
  return button;
}

function showSource(name, lineNumber) {
  const doc = result?.documents.find(item => item.name === name);
  if (!doc) return;
  byId('document-select').value = name;
  const host = byId('source');
  host.replaceChildren();
  for (const line of doc.lines) {
    const row = document.createElement('div');
    row.className = 'source-line' + (line.no === lineNumber ? ' target' : '');
    row.id = 'source-line-' + line.no;
    row.append(textElement('span', String(line.no), 'line-num'), textElement('span', line.text || ' ', 'line-text'));
    host.append(row);
  }
  if (lineNumber) host.querySelector('.target')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function fieldCell(field, format) {
  const cell = document.createElement('td');
  if (!field) { cell.append(textElement('span', 'Нет данных', 'muted')); return cell; }
  cell.append(textElement('span', format(field.value), 'data-value'));
  cell.append(sourceButton(field.evidence));
  if (field.changedBy) cell.append(textElement('small', 'Изменено: ' + field.changedBy, 'muted'));
  return cell;
}

function render() {
  const body = byId('contracts');
  const note = byId('filter-message');
  const proposalHost = byId('proposals');
  const issueHost = byId('issues');
  body.replaceChildren(); proposalHost.replaceChildren(); issueHost.replaceChildren();
  if (!result) return;
  const rows = filter === 'before' ? deliveriesBefore(result.rows) : result.rows;
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.append(textElement('td', row.id), textElement('td', row.supplier || 'Нет данных'));
    tr.append(fieldCell(row.amount, fmtAmount), fieldCell(row.deadline, fmtDate));
    const status = document.createElement('td');
    status.append(textElement('span', row.review.length ? 'Нужна проверка' : 'Основания найдены', row.review.length ? 'tag warn' : 'tag'));
    if (row.review.length) status.append(textElement('p', row.review.join('; '), 'muted'));
    tr.append(status); body.append(tr);
  }
  if (!rows.length) {
    const td = textElement('td', 'Нет подходящих договоров.', 'muted'); td.colSpan = 5;
    const tr = document.createElement('tr'); tr.append(td); body.append(tr);
  }
  note.textContent = filter === 'before'
    ? 'Поставка раньше 01.04.2026: ' + rows.length + '. Несогласованные переносы показаны ниже.'
    : 'Договоров: ' + result.rows.length + '. Дата проверки: ' + fmtDate(result.asOf) + '.';
  let count = 0;
  for (const row of result.rows) for (const proposal of row.proposals) {
    const box = textElement('div', '', 'proposal');
    box.append(textElement('strong', row.id + ' — ' + (proposal.kind === 'draft' ? 'неподписанный проект' : 'письмо поставщика')));
    box.append(textElement('p', proposal.file, 'muted'));
    if (proposal.amount) {
      const p = document.createElement('p'); p.append('Предлагаемая сумма: ' + fmtAmount(proposal.amount.value) + ' · ');
      p.append(sourceButton(proposal.amount.evidence)); box.append(p);
    }
    if (proposal.deadline) {
      const p = document.createElement('p'); p.append('Предлагаемый срок: ' + fmtDate(proposal.deadline.value) + ' · ');
      p.append(sourceButton(proposal.deadline.evidence)); box.append(p);
    }
    if (!proposal.amount && !proposal.deadline) box.append(textElement('p', 'Предложение требует ручной проверки.', 'muted'));
    proposalHost.append(box); count++;
  }
  if (!count) proposalHost.append(textElement('p', 'Несогласованных изменений не обнаружено.', 'muted'));
  for (const issue of result.issues) issueHost.append(textElement('p', issue, 'issues'));
}

function recalc() {
  if (!files.length) return;
  try {
    result = analyze(files, byId('asof').value);
    const select = byId('document-select'); select.replaceChildren();
    for (const doc of result.documents) {
      const option = document.createElement('option'); option.value = doc.name; option.textContent = doc.name; select.append(option);
    }
    showSource(result.documents[0]?.name);
    byId('upload-message').textContent = 'Обработано файлов: ' + files.length + '. Все вычисления выполнены локально.';
    render();
  } catch (error) { byId('upload-message').textContent = 'Ошибка: ' + error.message; }
}

async function accept(list) {
  const all = Array.from(list);
  if (!all.length) return;
  if (all.some(file => !file.name.toLowerCase().endsWith('.txt') || file.size > 2_000_000)) {
    byId('upload-message').textContent = 'Можно загрузить только TXT до 2 МБ каждый.'; return;
  }
  files = await Promise.all(all.map(async file => ({ name: file.name, text: await file.text() })));
  filter = 'all'; recalc();
}
byId('files').addEventListener('change', event => accept(event.target.files));
byId('asof').addEventListener('change', recalc);
byId('document-select').addEventListener('change', event => showSource(event.target.value));
byId('before').addEventListener('click', () => { filter = 'before'; render(); });
byId('all').addEventListener('click', () => { filter = 'all'; render(); });
byId('demo').addEventListener('click', async () => {
  try {
    const names = ['01_contract.txt','02_amendment_signed.txt','03_contract.txt','04_contract.txt','05_supplier_email.txt','06_amendment_draft.txt'];
    const docs = await Promise.all(names.map(async name => {
      const response = await fetch('documents/' + name);
      if (!response.ok) throw new Error('Не найден ' + name);
      return { name, text: await response.text() };
    }));
    files = docs; filter = 'all'; recalc();
  } catch (error) { byId('upload-message').textContent = 'Ошибка загрузки набора: ' + error.message; }
});
