/**
 * Supply Contract Checker / deterministic extraction core.
 * Inputs are user-supplied strings; rules never depend on fixture filenames or IDs.
 * Never infer missing terms, and never accept an amendment without explicit status + effective date.
 */
const ID_RE = /\b[A-ZА-ЯЁ]{2,12}[-–]\d{2,12}\b/gu;
const DATE_RE = /\b(?:\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}(?:\s*(?:года|г\.))?)/giu;
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const AMOUNT_RE = /(?<![\d])(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{4,}|\d{1,3})(?:[,.]\d{2})?(?![\d])/gu;

export function toIso(value) {
  if (!value) return null;
  const v = String(value);
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
  const words = /^(\d{1,2})\s+([а-яё]+)\s+(\d{4})(?:\s*(?:года|г\.))?$/iu.exec(v);
  const month = words ? MONTHS.indexOf(words[2].toLocaleLowerCase('ru')) + 1 : 0;
  const iso = m ? m[3] + '-' + m[2] + '-' + m[1] :
    month ? words[3] + '-' + String(month).padStart(2, '0') + '-' + words[1].padStart(2, '0') : v;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

function normalize(text) {
  return text.replace(/\u00a0|\u202f/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseMoney(value) {
  const clean = String(value).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return Number.isSafeInteger(cents) ? cents / 100 : null;
}

function blocksFromLines(lines) {
  const blocks = [];
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    blocks.push({
      text: pending.map(x => x.text).join('\n'),
      startLine: pending[0].no,
      endLine: pending.at(-1).no
    });
    pending = [];
  };
  for (const line of lines) {
    if (!line.text.trim()) { flush(); continue; }
    // Clauses within the same TXT file may be adjacent without blank lines.
    if ((/^\s*\d+(?:\.\d+)*\.\s/u.test(line.text) || /^\s*(?:Статус\s*:|Поставщик\s*:|(?:Общая|Цена|Стоимость|Сумма)\s|Срок\s+поставки\s*[:—–-]|Поставщик\s+(?:обязуется|обязан)\s|Поставка\s+осуществляется\s|Оплата\s)/iu.test(line.text)) && pending.length) flush();
    pending.push(line);
  }
  flush();
  return blocks;
}

function citation(doc, block) {
  return { file: doc.name, line: block.startLine, endLine: block.endLine, quote: block.text };
}
function result(doc, block, value, reason) {
  return { value, evidence: citation(doc, block), reason };
}
function best(candidates) {
  if (candidates.length === 0) return { selected: null, ambiguous: false };
  // Conflicting explicit values are a data-quality warning, not a tie-breaking game.
  if (new Set(candidates.map(x => String(x.value))).size > 1) return { selected: null, ambiguous: true };
  const highest = Math.max(...candidates.map(x => x.score));
  return { selected: candidates.find(x => x.score === highest), ambiguous: false };
}
function priceCandidates(doc, proposed) {
  const found = [];
  for (const block of doc.blocks) {
    const flat = normalize(block.text);
    const explicitProposal = /(?:предлагается|предлагаем|просим|проект)/iu.test(flat);
    if (proposed && !explicitProposal && !['draft','letter'].includes(doc.kind)) continue;
    if (!proposed && (['draft','letter'].includes(doc.kind) || /(?:предлагается|предлагаем|проект\s+изменения)/iu.test(flat))) continue;
    if (/лимит|бюджет|аванс|предоплат|остаток\s+к\s+оплате|штраф|неустойк|не\s+является\s+согласованной\s+стоимостью/iu.test(flat)) continue;
    if (/стоимост[ьи]\s+определяется\s+спецификацией|числовое\s+значение\s+стоимости[^\n]*не\s+указано/iu.test(flat)) continue;
    const anchors = [
      { re: /(?:общ(?:ая|ую)|итогов(?:ая|ую))\s+(?:стоимост[ьи]|сумм[ауы])(?:\s+(?:поставки|договора|контракта))?/giu, score: 5 },
      { re: /(?:стоимост[ьи]|сумм[ауы]|цен[ауы])\s+(?:договора|контракта|поставки|товаров|оборудования)/giu, score: 4 },
      { re: /(?:договорная\s+цена|итого\s+по\s+договору)/giu, score: 4 }
    ];
    for (const anchor of anchors) {
      for (const match of flat.matchAll(anchor.re)) {
        const suffix = flat.slice(match.index + match[0].length, match.index + match[0].length + 220);
        // Phrasing must explicitly associate the price with a monetary value.
        if (!/(?:составля(?:ет|ют)|установлен[аоы]?|равн[аоы]?|в\s+размере|определен[аоы]?|изменя(?:ется|ют|ть)|на\s+|[:—–-])/iu.test(suffix.slice(0, 100))) continue;
        const nums = [...suffix.matchAll(AMOUNT_RE)].filter(x => {
          const after = suffix.slice(x.index + x[0].length);
          return /^(?:\s*\([^)]{0,140}\))?\s*(?:рубл(?:ь|я|ей)|руб\.?|₽)/iu.test(after);
        });
        if (!nums.length) continue;
        // The old value in "с OLD рублей на NEW рублей" must never become
        // current value — even when this text is in a *signed* amendment.
        const transition = nums.find((candidate, index) => index > 0 &&
          /\sна\s*$/iu.test(suffix.slice(0, candidate.index)));
        const num = transition || (proposed ? nums.at(-1) : nums[0]);
        const value = parseMoney(num[0]);
        if (value === null) continue;
        found.push({ ...result(doc, block, value, 'amount'), score: anchor.score });
      }
    }
  }
  return best(found);
}
function deadlineCandidates(doc, proposed) {
  const found = [];
  for (const block of doc.blocks) {
    const flat = normalize(block.text);
    if (!/поставк|поставить|отгрузк|отгрузить|передать\s+товар/iu.test(flat)) continue;
    if (/оплат[аыуе]|приемк|приёмк/iu.test(flat) &&
        !/(?:поставк|поставить).{0,80}(?:не\s+позднее|до|срок)/iu.test(flat)) continue;
    const isProposal = ['draft','letter'].includes(doc.kind) || /предлага(?:ется|ем|ет)|просим\s+перенести|планируем\s+перенести/iu.test(flat);
    if (proposed !== isProposal) continue;
    const dates = [...flat.matchAll(DATE_RE)]
      .map(match => ({ value: toIso(match[0]), index: match.index }))
      .filter(match => match.value);
    if (!dates.length) continue;
    const hasClearAnchor = /(?:срок\s+(?:поставки|отгрузки)|постав(?:ить|ку|ка|ке)|отгруз(?:ить|ку|ка)|передать\s+товар)/iu.test(flat);
    if (!hasClearAnchor) continue;
    const direct = /(?:не\s+позднее|до\s+|по\s+|срок\s+(?:поставки|отгрузки)\s*[:—–-]|перенести[^\n]*\sна\s+|изменить\s+срок\s+поставки\s+на)/iu.test(flat);
    if (!direct) continue;
    // "с OLD на NEW": date following "на" is the replacement regardless
    // of document status. A signed addendum may use the same wording as a letter.
    const transition = dates.find((candidate, index) => index > 0 &&
      /\sна\s*$/iu.test(flat.slice(0, candidate.index)));
    const selected = transition || (proposed ? dates.at(-1) : dates[0]);
    found.push({ ...result(doc, block, selected.value, 'deliveryDeadline'), score: /не\s+позднее/iu.test(flat) ? 5 : 4 });
  }
  return best(found);
}
function supplierCandidate(doc) {
  for (const block of doc.blocks) {
    const m = /(?:^|[\s.])Поставщик\s*[:—–-]\s*(ООО\s*«[^»]+»|АО\s*«[^»]+»|ИП\s+[А-ЯЁ][^.,\n]*|[^.\n]+)/iu.exec(block.text);
    if (m) return result(doc, block, m[1].trim(), 'supplier');
  }
  return null;
}
function signature(doc) {
  const declared = doc.lines.filter(line => /^\s*Статус\s*:/iu.test(line.text))
    .map(x => x.text).join(' ');
  if (!declared) return 'unknown';
  if (/не\s+подписан|без\s+подпис|одной\s+стороной|на\s+согласовании|подписан\s+только/iu.test(declared)) return 'unsigned';
  if (/подписан[аоы]?\s+(?:обеими\s+)?сторонами/iu.test(declared)) {
    const allText = doc.lines.map(x => x.text).join(' ');
    if (/подписание\s+не\s+состоялось|(?:соглашени[ея]|договор)\s+не\s+подписан/iu.test(allText)) return 'unknown';
    return 'signed';
  }
  return 'unknown';
}
function effectiveDate(doc) {
  for (const block of doc.blocks) {
    const dateToken = String.raw`(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}(?:\s*(?:года|г\.))?)`;
    const matches = [
      new RegExp(String.raw`(?:настоящее\s+соглашение\s+)?вступает\s+в\s+силу\s+(?:с\s+)?` + dateToken, 'iu'),
      new RegExp(String.raw`дата\s+вступления\s+в\s+силу\s*[:—–-]\s*` + dateToken, 'iu')
    ];
    for (const re of matches) {
      const m = block.text.match(re);
      if (m) {
        const value = toIso(m[1]);
        if (value) return result(doc, block, value, 'effectiveDate');
      }
    }
  }
  return null;
}
function kindOf(lines) {
  const heading = lines.find(x => x.text.trim())?.text || '';
  if (/проект\s+(?:дополнительного\s+соглашения|изменения)/iu.test(heading)) return 'draft';
  if (/дополнительно(?:е|го)\s+соглашени|допсоглашени/iu.test(heading)) return 'amendment';
  if (/(?:договор|контракт)\s+(?:поставки|№)/iu.test(heading)) return 'contract';
  if (/письмо|уведомлени|предложени/iu.test(heading)) return 'letter';
  return 'unknown';
}

/**
 * Detect that a signed amendment addresses a field even when the new value
 * cannot be extracted. Without this signal the previous contract value would
 * incorrectly remain visible as a confirmed, current value.
 */
function termModificationIntents(doc) {
  const intents = { amount: null, deadline: null };
  if (doc.kind !== 'amendment') return intents;
  for (const block of doc.blocks) {
    const text = normalize(block.text);
    if (/(?:остальные\s+условия|без\s+изменений|не\s+изменя(?:ются|ется))/iu.test(text)) continue;
    const modification = /(?:измен|излож|установ|составля|определя|перенес|перенести|продл|будет|нов(?:ую|ой|ая|ый)|теперь|\bстановится\b)/iu.test(text);
    if (!modification) continue;
    if (/(?:общ(?:ая|ую)\s+(?:стоимость|сумма|стоимости|сумму)|сумм[ауы]\s+(?:договора|контракта|поставки)|цен[ауы]\s+(?:договора|контракта|поставки)|стоимост[ьи]\s+(?:договора|контракта|поставки))/iu.test(text)) intents.amount ??= citation(doc, block);
    if (/(?:срок\s+(?:поставки|отгрузки)|дат[ауы]\s+поставки|поставк[аиуы]?\s+(?:оборудования|товара|осуществляется)|постав(?:ить|ку|ка|ке)|отгруз(?:ить|ку|ка))/iu.test(text)) intents.deadline ??= citation(doc, block);
  }
  return intents;
}

export function parseDocument({ name, text }) {
  if (typeof name !== 'string' || typeof text !== 'string') throw new TypeError('Ожидаются имя файла и TXT');
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((text, index) => ({ no: index + 1, text }));
  const blocks = blocksFromLines(lines);
  let kind = kindOf(lines);
  const declared = lines.filter(line => /^\s*Статус\s*:/iu.test(line.text)).map(x => x.text).join(' ');
  if (kind === 'amendment' && /проект|на\s+согласовании|не\s+подписан/iu.test(declared)) kind = 'draft';
  const ids = [...new Set([...text.matchAll(ID_RE)].map(x => x[0].replace('–', '-')))];
  const doc = { name, text, lines, blocks, id: ids.length === 1 ? ids[0] : null, ids,
    kind, signature: signature({ lines }), issues: [] };
  if (!ids.length) doc.issues.push('Не найден номер договора');
  if (ids.length > 1) doc.issues.push('Несколько номеров договоров: ' + ids.join(', '));
  doc.supplier = supplierCandidate(doc);
  const amount = priceCandidates(doc, false);
  const deadline = deadlineCandidates(doc, false);
  const proposedAmount = priceCandidates(doc, true);
  const proposedDeadline = deadlineCandidates(doc, true);
  doc.amount = amount.selected;
  doc.deadline = deadline.selected;
  doc.proposedAmount = proposedAmount.selected;
  doc.proposedDeadline = proposedDeadline.selected;
  if (amount.ambiguous) doc.issues.push('Неоднозначная сумма');
  if (deadline.ambiguous) doc.issues.push('Неоднозначный срок поставки');
  if (proposedAmount.ambiguous || proposedDeadline.ambiguous) doc.issues.push('Неоднозначное предложение об изменении');
  doc.effective = effectiveDate(doc);
  doc.termIntents = termModificationIntents(doc);
  const statusLine = lines.find(line => /^\s*Статус\s*:/iu.test(line.text))?.text || '';
  const signedMatch = [...statusLine.matchAll(DATE_RE)].find(m => toIso(m[0]));
  doc.signedAt = doc.signature === 'signed' && signedMatch
    ? toIso(signedMatch[0]) : null;
  return doc;
}

function fieldValue(field) {
  return field ? { value: field.value, evidence: field.evidence, changedBy: field.changedBy ?? null,
    effective: field.effective ?? null } : null;
}
function apply(row, doc) {
  for (const field of ['amount', 'deadline']) {
    if (!doc[field] && !doc.termIntents[field]) continue;
    const effective = doc.effective.value;
    const existingConflict = row.conflictFields.get(field);
    // A later signed correction can repair an earlier unresolved field;
    // another same-day document must not arbitrarily resolve a conflict.
    if (existingConflict && existingConflict === effective) continue;
    const previous = row[field];
    if (previous?.effective === effective && previous.value !== doc[field]?.value) {
      row.history[field].push({
        value: doc[field]?.value ?? null, evidence: doc[field]?.evidence ?? null,
        file: doc.name, effective, outcome: 'conflict'
      });
      row[field] = null;
      row.conflictFields.set(field, effective);
      row.review.push('Противоречащие подписанные изменения: ' + field + ' на дату ' + effective);
      continue;
    }
    if (!doc[field]) {
      row.history[field].push({
        value: null, evidence: doc.termIntents[field] ?? null,
        file: doc.name, effective, outcome: 'unresolved'
      });
      row[field] = null;
      row.conflictFields.set(field, effective);
      row.review.push('Подписанное изменение затрагивает поле ' + field +
        ', но новое значение нельзя достоверно определить: ' + doc.name);
      continue;
    }
    row.conflictFields.delete(field);
    row.history[field].push({
      value: doc[field].value, evidence: doc[field].evidence,
      file: doc.name, effective, outcome: 'applied'
    });
    row[field] = { ...fieldValue(doc[field]), changedBy: doc.name, effective };
  }
}
export function analyze(files, asOf = '2026-03-10') {
  if (!toIso(asOf) || toIso(asOf) !== asOf) throw new Error('Некорректная дата проверки');
  if (!Array.isArray(files)) throw new TypeError('Ожидается массив TXT');
  const docs = files.map(parseDocument);
  const rows = [];
  const issues = [];
  const baseDocuments = docs.filter(x => x.kind === 'contract');
  const contractIds = new Set();
  for (const base of baseDocuments) {
    if (!base.id) { issues.push('Невозможно определить договор: ' + base.name); continue; }
    if (contractIds.has(base.id)) {
      issues.push('Дубликат основного договора ' + base.id + ': ' + base.name);
      const existing = rows.find(x => x.id === base.id);
      if (existing) {
        existing.amount = null;
        existing.deadline = null;
        existing.review.push('Дубликат основного договора: действующие значения требуют ручной проверки');
      }
      continue;
    }
    contractIds.add(base.id);
    const related = docs.filter(x => x !== base && x.id === base.id);
    const row = { id: base.id, supplier: base.supplier?.value ?? null,
      supplierEvidence: base.supplier?.evidence ?? null,
      amount: fieldValue(base.amount), deadline: fieldValue(base.deadline),
      source: base.name, documents: [base.name, ...related.map(x => x.name)],
      proposals: [], review: [...base.issues],
      history: {
        amount: base.amount ? [{
          value: base.amount.value, evidence: base.amount.evidence,
          file: base.name, effective: null, outcome: 'base'
        }] : [],
        deadline: base.deadline ? [{
          value: base.deadline.value, evidence: base.deadline.evidence,
          file: base.name, effective: null, outcome: 'base'
        }] : []
      },
      conflictFields: new Map() };
    if (base.signature !== 'signed') {
      row.amount = null;
      row.deadline = null;
      row.review.push('Подписание исходного договора не подтверждено');
    } else if (!base.signedAt || base.signedAt > asOf) {
      row.amount = null;
      row.deadline = null;
      row.review.push('Дата подписания основного договора не подтверждена на дату проверки');
    }
    const amendments = related.filter(x => x.kind === 'amendment')
      .sort((a, b) => (a.effective?.value || '').localeCompare(b.effective?.value || ''));
    for (const doc of amendments) {
      row.review.push(...doc.issues.map(x => doc.name + ': ' + x));
      if (doc.signature !== 'signed') {
        row.review.push('Допсоглашение не подтверждено как подписанное: ' + doc.name);
      } else if (!doc.signedAt || doc.signedAt > asOf) {
        row.review.push('Подписание допсоглашения на дату проверки не подтверждено: ' + doc.name);
      } else if (!doc.effective) {
        row.review.push('Не установлена дата вступления в силу: ' + doc.name);
      } else if (doc.supplier && base.supplier &&
          normalize(doc.supplier.value).toLocaleLowerCase('ru') !== normalize(base.supplier.value).toLocaleLowerCase('ru')) {
        row.review.push('Поставщик в допсоглашении не совпадает с договором: ' + doc.name);
      } else if (doc.effective.value <= asOf) {
        if (base.signature === 'signed' && base.signedAt && base.signedAt <= asOf) apply(row, doc);
        else row.review.push('Изменение нельзя применить: основной договор не подтверждён');
      }
    }
    for (const doc of related.filter(x => x.kind === 'draft' || x.kind === 'letter')) {
      row.proposals.push({ kind: doc.kind, file: doc.name,
        amount: fieldValue(doc.proposedAmount), deadline: fieldValue(doc.proposedDeadline),
        evidence: doc.blocks[0] ? citation(doc, doc.blocks[0]) : null });
      row.review.push(...doc.issues.map(x => doc.name + ': ' + x));
    }
    if (!row.amount && !row.conflictFields.has('amount')) row.review.push('Стоимость не установлена в загруженных документах');
    if (!row.deadline && !row.conflictFields.has('deadline')) row.review.push('Срок поставки не установлен в загруженных документах');
    delete row.conflictFields;
    rows.push(row);
  }
  for (const doc of docs) {
    if (doc.kind === 'unknown') issues.push('Неизвестный тип документа: ' + doc.name);
    if (doc.kind !== 'contract' && (!doc.id || !contractIds.has(doc.id))) {
      issues.push('Документ не связан с договором: ' + doc.name);
    }
  }
  return { rows: rows.sort((a, b) => a.id.localeCompare(b.id)),
    issues, documents: docs, asOf };
}
export function deliveriesBefore(rows, cutoff = '2026-04-01') {
  if (!toIso(cutoff)) throw new Error('Некорректная дата границы');
  return rows.filter(row => row.deadline && row.deadline.value < toIso(cutoff));
}
export function toPublicResult(result) {
  return { asOf: result.asOf, contracts: result.rows, issues: result.issues,
    documentCount: result.documents.length, schemaVersion: '1.0' };
}
