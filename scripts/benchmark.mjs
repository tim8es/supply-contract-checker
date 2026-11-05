#!/usr/bin/env node
/**
 * Non-gating, source-backed quality report over a frozen synthetic holdout.
 * Labels are specified in benchmark/holdout.mjs and are NEVER used by the core.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { analyze, parseMoney, toIso } from '../src/engine.mjs';
import { holdout, benchmarkAsOf } from '../benchmark/holdout.mjs';

const rub = /(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{4,}|\d{1,3})(?:[,.]\d{2})?(?=\s*(?:\([^)]{0,140}\)\s*)?(?:рубл(?:ь|я|ей)|руб\.?|₽))/giu;
const dates = /\b(?:\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}(?:\s*(?:года|г\.))?)\b/giu;

function evidenceIsGrounded(files, field, name) {
  if (!field?.evidence) return false;
  const e = field.evidence;
  const doc = files.find(f => f.name === e.file);
  if (!doc || !Number.isInteger(e.line) || !Number.isInteger(e.endLine) ||
      e.line < 1 || e.endLine < e.line) return false;
  const source = doc.text.replace(/\r\n?/g, '\n').split('\n')
    .slice(e.line - 1, e.endLine).join('\n');
  if (source !== e.quote) return false;
  if (name === 'amount') {
    return [...e.quote.matchAll(rub)].some(m => parseMoney(m[0]) === field.value);
  }
  if (name === 'deadline') {
    return [...e.quote.matchAll(dates)].some(m => toIso(m[0]) === field.value);
  }
  return false;
}
function scoreField(benchmark, name) {
  const expected = benchmark.expected[name] ?? null;
  const data = benchmark.actual?.[name] ?? null;
  const actual = data?.value ?? null;
  let outcome;
  if (expected === null && actual === null) outcome = 'true_negative';
  else if (expected === null) outcome = 'false_positive';
  else if (actual === null) outcome = 'false_negative';
  else if (expected !== actual) outcome = 'wrong_value';
  else outcome = 'true_positive';
  return {
    field: name, expected, actual, outcome,
    evidenceValid: outcome === 'true_positive' ? evidenceIsGrounded(benchmark.files,data,name) : null,
    evidenceFile: data?.evidence?.file ?? null
  };
}
function r(num, den) { return den ? Math.round(num / den * 10000) / 100 : null; }
export function evaluateBenchmark(cases=holdout) {
  const scenarios = [];
  const counts = {
    true_positive:0, true_negative:0, false_positive:0, false_negative:0, wrong_value:0,
    grounded_true_positive:0
  };
  for (const testCase of cases) {
    const data = analyze(testCase.files, benchmarkAsOf);
    const current = data.rows.find(row => row.id === 'BMC-'+testCase.id);
    const item = {
      id: testCase.id, label: testCase.label,
      expected:testCase.expected, actual: current || null, files:testCase.files
    };
    const fields = ['amount','deadline'].map(field => scoreField(item,field));
    for (const f of fields) {
      counts[f.outcome]++;
      if (f.outcome==='true_positive' && f.evidenceValid) counts.grounded_true_positive++;
    }
    scenarios.push({
      id:testCase.id, label:testCase.label,
      fields, issues:[...data.issues,...(current?.review||[])]
    });
  }
  const predictedPositive = counts.true_positive+counts.false_positive+counts.wrong_value;
  const actualPositive = counts.true_positive+counts.false_negative+counts.wrong_value;
  const metrics = {
    fieldPrecisionPct:r(counts.true_positive,predictedPositive),
    fieldRecallPct:r(counts.true_positive,actualPositive),
    groundedCorrectPct:r(counts.grounded_true_positive,counts.true_positive),
    falseAuthoritativeAnswers:counts.false_positive+counts.wrong_value,
    incorrectOrMissing:counts.false_positive+counts.false_negative+counts.wrong_value,
    cases:cases.length, fields:cases.length*2
  };
  return {benchmark:'synthetic-holdout-v1',asOf:benchmarkAsOf,counts,metrics,scenarios};
}
export function markdownReport(report) {
  const m=report.metrics,c=report.counts;
  const lines=[
    '# Synthetic holdout benchmark — report',
    '',
    '> **Not production accuracy.** All cases are synthetic, authored for this evaluation and publicly inspectable. The benchmark is not independent real-customer data. Do not interpret these percentages as performance on arbitrary agreements.',
    '',
    'Check date: '+report.asOf+' · Cases: '+m.cases+' · Fields: '+m.fields,
    '',
    '| Metric | Value |',
    '|---|---:|',
    '| Correct-value precision | '+(m.fieldPrecisionPct??'n/a')+'% |',
    '| Correct-value recall | '+(m.fieldRecallPct??'n/a')+'% |',
    '| Exact source + value present (among correct answers) | '+(m.groundedCorrectPct??'n/a')+'% |',
    '| **Wrong values asserted as current** | **'+m.falseAuthoritativeAnswers+'** |',
    '| False negatives (abstentions on existing values) | '+c.false_negative+' |',
    '| True negatives (correctly abstained) | '+c.true_negative+' |',
    '',
    'The provenance metric checks a verbatim line interval and whether the expected numeric/date value occurs in that quote. **It does not prove the semantic or legal authority of the quote.**',
    '',
    '## Cases requiring attention',
    '',
    '| Case | Characteristic | Field | Expected | Actual | Outcome |',
    '|---|---|---|---|---|---|'
  ];
  for (const x of report.scenarios) for (const f of x.fields) {
    if (f.outcome==='true_positive' && f.evidenceValid) continue;
    if (f.outcome==='true_negative') continue;
    const fmt=v=>v==null?'нет данных':String(v);
    lines.push('| '+x.id+' | '+x.label.replaceAll('|','/')+' | '+f.field+' | '+fmt(f.expected)+' | '+fmt(f.actual)+' | '+
      (f.outcome==='true_positive'?'citation_not_grounded':f.outcome)+' |');
  }
  if (lines.at(-1)==='|---|---|---|---|---|---|') lines.push('| — | — | — | — | — | No errors |');
  lines.push('', '## Method',
    '- One run per scenario; same fixed date and engine.',
    '- Classify each amount/deadline as TP/TN/FP/FN/wrong value.',
    '- Precision = TP / (TP + FP + wrong); recall = TP / (TP + FN + wrong).',
    '- False authoritative answers = false positives + wrong values.',
    '- The corpus is committed **before further tuning**, and all observed errors remain visible.',
    '- Additional private/real-world evaluation is needed before enterprise claims.',
    '');
  return lines.join('\n');
}
if (process.argv[1] && import.meta.url.endsWith('/'+process.argv[1].split(/[\\/]/).at(-1))) {
  const outputFlag = process.argv.indexOf('--output');
  const markdownFlag = process.argv.indexOf('--markdown');
  const data = evaluateBenchmark();
  const md = markdownReport(data);
  if (outputFlag !== -1) {
    if (!process.argv[outputFlag+1]) throw Error('Missing --output path');
    const filepath=resolve(process.argv[outputFlag+1]);
    await mkdir(dirname(filepath),{recursive:true});
    await writeFile(filepath,JSON.stringify(data,null,2)+'\n');
  }
  if (markdownFlag !== -1) {
    if (!process.argv[markdownFlag+1]) throw Error('Missing --markdown path');
    const filepath=resolve(process.argv[markdownFlag+1]);
    await mkdir(dirname(filepath),{recursive:true});
    await writeFile(filepath,md);
  }
  process.stdout.write(md);
}
