/**
 * Optional contract-term plugin. The registry calls extract() for the base
 * contract, signed addenda and proposed changes, while core applies the same
 * signed/effective rules as other contract fields.
 *
 * Rate unit is percent per day: 0.1 means 0.1%/day, NOT fraction 0.001.
 */
export function parsePenaltyRate(token) {
  const m=/^\s*(\d{1,3}(?:[,.]\d{1,4})?)\s*%\s*$/u.exec(String(token));
  if (!m) return null;
  const n=Number(m[1].replace(',','.'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}
const TERM=/(?:неустойк|пен[ия]|штрафн(?:ой|ая)\s+ставк)/iu;
const PERCENT=/\d{1,3}(?:[,.]\d{1,4})?\s*%/gu;
const CONTEXT=/(?:за\s+каждый\s+день|ежедневн|в\s+день|ставк[ауы]|размер\s+неустойки|неустойк)/iu;
function isUnchanged(s) { return /(?:остальные\s+условия|оста(?:ётся|ется|ются|ются)\s+без\s+изменений|не\s+изменя(?:ется|ются)|без\s+изменений)/iu.test(s); }
function proposed(doc) { return doc.kind === 'draft' || doc.kind === 'letter'; }

export const penaltyRateExtractor = {
  key:'penaltyRate',
  label:'Ставка неустойки',
  unit:'percent_per_day',
  parseToken:parsePenaltyRate,
  extract(doc,{proposedOnly=false}={}) {
    if (proposedOnly !== proposed(doc)) return null;
    const found=[];
    for (const block of doc.blocks) {
      const text=block.text.replace(/\s+/gu,' ');
      if (!TERM.test(text) || !CONTEXT.test(text) || isUnchanged(text)) continue;
      const tokens=[...text.matchAll(PERCENT)].map(m=>({text:m[0],index:m.index,value:parsePenaltyRate(m[0])}))
        .filter(m=>m.value!==null);
      if (!tokens.length) continue;
      // A cap ("не более 10%") is not the daily penalty rate.
      const rates=tokens.filter(t=>!/не\s+более\s*$/iu.test(text.slice(0,t.index)));
      if (!rates.length) continue;
      const replacement=rates.find((t,i)=>i>0 && /\sна\s*$/iu.test(text.slice(0,t.index)));
      const selected=replacement || rates[0];
      found.push({
        value:selected.value,
        evidence:{file:doc.name,line:block.startLine,endLine:block.endLine,
          quote:block.text,valueText:selected.text},
        reason:'penaltyRate'
      });
    }
    if (!found.length) return null;
    if (new Set(found.map(x=>x.value)).size>1) {
      // A null result plus positive intent in an effective addendum forces review.
      return null;
    }
    return found[0];
  },
  changedIntent(doc) {
    if (doc.kind!=='amendment') return null;
    for (const block of doc.blocks) {
      const text=block.text.replace(/\s+/gu,' ');
      if (!TERM.test(text) || isUnchanged(text)) continue;
      if (!/(?:измен|установ|утверд|составля|увелич|уменьш|повыс|сниз|будет|становит|нов(?:ый|ая|ую))/iu.test(text)) continue;
      return {file:doc.name,line:block.startLine,endLine:block.endLine,quote:block.text};
    }
    return null;
  }
};
