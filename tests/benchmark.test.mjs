import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBenchmark,markdownReport } from '../scripts/benchmark.mjs';
import { holdout } from '../benchmark/holdout.mjs';

test('synthetic holdout uses unique IDs and contains precisely 36 documented scenarios',()=>{
 assert.equal(holdout.length,36);
 assert.equal(new Set(holdout.map(x=>x.id)).size,36);
 for (const item of holdout) {
   assert.ok(item.files.every(f=>f.name.endsWith('.txt') && typeof f.text==='string'));
   assert.ok(item.files.some(f=>f.text.includes('BMC-'+item.id)));
   assert.ok(Object.prototype.hasOwnProperty.call(item.expected,'amount'));
   assert.ok(Object.prototype.hasOwnProperty.call(item.expected,'deadline'));
 }
});
test('benchmark counts every labelled field exactly once and never hides errors',()=>{
 const report=evaluateBenchmark();
 const total=Object.entries(report.counts)
  .filter(([key])=>key!=='grounded_true_positive').reduce((n,[,count])=>n+count,0);
 assert.equal(total,72);
 assert.equal(report.metrics.cases,36);
 assert.equal(report.metrics.fields,72);
 assert.equal(report.scenarios.length,36);
 for(const x of report.scenarios) assert.equal(x.fields.length,2);
 assert.equal(report.metrics.falseAuthoritativeAnswers,
   report.counts.false_positive+report.counts.wrong_value);
 const markdown=markdownReport(report);
 for(const x of report.scenarios) if(x.fields.some(f=>f.outcome==='false_negative'))
   assert.ok(markdown.includes('| '+x.id+' |'));
});
test('reported precision and recall are derived from counts rather than authored constants',()=>{
 const report=evaluateBenchmark();
 const {true_positive:tp,wrong_value:wrong,false_positive:fp,false_negative:fn}=report.counts;
 const percentage=(num,den)=>den ? Math.round(num/den*10000)/100:null;
 assert.equal(report.metrics.fieldPrecisionPct,percentage(tp,tp+fp+wrong));
 assert.equal(report.metrics.fieldRecallPct,percentage(tp,tp+fn+wrong));
});
