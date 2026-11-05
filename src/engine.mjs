/** Deterministic TXT extraction engine. No filename- or contract-specific answers. */
const ID = /\b[A-ZА-ЯЁ]{2,12}[-–]\d{2,12}\b/u;

function toIso(value) {
  if (!value) return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return date.getUTCFullYear() === Number(yyyy) && date.getUTCMonth() === Number(mm) - 1 && date.getUTCDate() === Number(dd)
    ? yyyy + '-' + mm + '-' + dd : null;
}

function evidence(doc, line, match = null) {
  return { file: doc.name, line: line.no, quote: line.text, match: match || line.text };
}

function findField(doc, pattern, convert = value => value) {
  for (const line of doc.lines) {
    const found = line.text.match(pattern);
    if (found) {
      const value = convert(found[1]);
      if (value !== null && value !== undefined && value !== '') {
        return { value, evidence: evidence(doc, line, found[0]) };
      }
    }
  }
  return null;
}

const valueNumber = value => {
  const digits = value.replace(/[\s\u00a0\u202f]/g, '');
  const result = Number(digits);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
};

function extractAmount(doc) {
  return findField(doc, /(?:общая\s+стоимость\s+(?:поставки|договора)|общая\s+сумма\s+договора)\s+(?:составляет|равна|установлена\s+в\s+размере)\s+([\d\s\u00a0\u202f]+?)\s*(?:\([^)]*\)\s*)?рубл/iu, valueNumber);
}
function extractDeadline(doc) {
  return findField(doc, /(?:поставщик\s+обязуется\s+поставить[^\n]*?не\s+позднее|срок\s+поставки\s+(?:устанавливается\s+)?(?:не\s+позднее|до))\s+(\d{2}\.\d{2}\.\d{4})/iu, toIso);
}
function extractProposedAmount(doc) {
  return findField(doc, /(?:предлагается\s+изменить|предлагаем\s+изменить)[^\n]*?(?:общую\s+стоимость\s+поставки|сумму\s+договора)\s+на\s+([\d\s\u00a0\u202f]+?)\s*рубл/iu, valueNumber);
}
function extractProposedDeadline(doc) {
  return findField(doc, /(?:предлагается\s+изменить\s+срок\s+поставки\s+на|предлагаем\s+перенести\s+срок\s+поставки\s+с\s+\d{2}\.\d{2}\.\d{4}\s+на)\s+(\d{2}\.\d{2}\.\d{4})/iu, toIso);
}
function extractSupplier(doc) {
  return findField(doc, /Поставщик:\s*([^\.\n]+?)(?=\.\s|\.$|$)/iu, value => value.trim().replace(/[\.\s]+$/, ''));
}

/** Classification relies on the document heading and declared signature status. */
export function parseDocument({ name, text }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((text, index) => ({ no: index + 1, text }));
  const heading = (lines.find(line => line.text.trim()) || { text: '' }).text;
  const status = lines.find(line => /^\s*Статус\s*:/iu.test(line.text));
  const statusText = status?.text || '';
  const signed = /подписан[аоы]?\s+обеими\s+сторонами/iu.test(statusText) && !/не\s+подписан/iu.test(statusText);
  let kind = 'unknown';
  if (/проект\s+дополнительного\s+соглашения/iu.test(heading) || /проект\s+на\s+согласовании|не\s+подписан/iu.test(statusText)) kind = 'draft';
  else if (/дополнительн(?:ое|ого)\s+соглашени/iu.test(heading)) kind = 'amendment';
  else if (/^\s*договор\s+поставки/iu.test(heading)) kind = 'contract';
  else if (/^\s*письмо(?:\s|$)/iu.test(heading)) kind = 'letter';
  const id = (heading.match(ID) || text.match(ID))?.[0] || null;
  const doc = { name, text, lines, id, kind, signed, statusText };
  doc.supplier = extractSupplier(doc);
  doc.amount = extractAmount(doc);
  doc.deadline = extractDeadline(doc);
  doc.proposedAmount = extractProposedAmount(doc);
  doc.proposedDeadline = extractProposedDeadline(doc);
  doc.effective = findField(doc, /(?:настоящее\s+соглашение\s+)?вступает\s+в\s+силу\s+(\d{2}\.\d{2}\.\d{4})/iu, toIso);
  return doc;
}

function applyChanges(row, doc, effective) {
  for (const field of ['amount', 'deadline']) {
    if (!doc[field]) continue;
    if (row.conflicts.has(field)) continue;
    const previous = row[field];
    if (previous?.effective === effective && previous.value !== doc[field].value) {
      row[field] = null;
      row.conflicts.add(field);
      row.review.push('Противоречащие изменения поля ' + field + ' от ' + effective);
      continue;
    }
    row[field] = { ...doc[field], effective, changedBy: doc.name };
  }
}

export function analyze(files, asOf = '2026-03-10') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf))) throw new Error('Некорректная дата проверки');
  const docs = files.map(parseDocument);
  const rows = [];
  const issues = [];
  const seen = new Set();
  for (const base of docs.filter(doc => doc.kind === 'contract')) {
    if (!base.id || seen.has(base.id)) {
      issues.push('Не найден уникальный номер договора: ' + base.name);
      continue;
    }
    seen.add(base.id);
    const row = {
      id: base.id, supplier: base.supplier?.value || null,
      amount: base.amount ? { ...base.amount, effective: null, changedBy: null } : null,
      deadline: base.deadline ? { ...base.deadline, effective: null, changedBy: null } : null,
      documents: [base.name], proposals: [], review: [], source: base.name, conflicts: new Set()
    };
    if (!base.signed) row.review.push('Не подтверждено подписание основного договора');
    const related = docs.filter(doc => doc !== base && doc.id === base.id);
    row.documents.push(...related.map(doc => doc.name));
    const amendments = related.filter(doc => doc.kind === 'amendment');
    amendments.sort((a, b) => (a.effective?.value || '').localeCompare(b.effective?.value || ''));
    for (const amend of amendments) {
      if (!amend.signed || !amend.effective) {
        row.review.push('Статус или дата вступления в силу не подтверждены: ' + amend.name);
      } else if (amend.effective.value <= asOf) {
        applyChanges(row, amend, amend.effective.value);
      }
    }
    for (const doc of related.filter(doc => ['draft', 'letter'].includes(doc.kind))) {
      row.proposals.push({ kind: doc.kind, file: doc.name, amount: doc.proposedAmount, deadline: doc.proposedDeadline });
    }
    rows.push(row);
  }
  for (const doc of docs) {
    if (doc.kind === 'unknown' || !doc.id || (doc.kind !== 'contract' && !seen.has(doc.id))) {
      issues.push('Не удалось связать документ: ' + doc.name);
    }
  }
  return { rows: rows.sort((a,b) => a.id.localeCompare(b.id)), issues, documents: docs, asOf };
}

export function deliveriesBefore(rows, cutoff = '2026-04-01') {
  return rows.filter(row => row.deadline && row.deadline.value < cutoff);
}
