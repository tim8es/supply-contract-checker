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
const DAILY=/(?:за\s+каждый\s+день|ежедневн|в\s+день|за\s+сутки)/iu;
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
      if (!TERM.test(text) || !DAILY.test(text) || isUnchanged(text)) continue;
      const tokens=[...text.matchAll(PERCENT)].map(m=>({text:m[0],index:m.index,value:parsePenaltyRate(m[0])}))
        .filter(m=>m.value!==null);
      if (!tokens.length) continue;
      // Rate must be *daily* and is not a maximum/overall penalty cap.
      // Inspect the local sentence; caps may appear before the daily rate.
      const isCap = t => {
        const prefix = text.slice(Math.max(0,t.index-140),t.index).split(/[.;\n]/u).at(-1);
        return /(?:не\s+более|не\s+выше|не\s+превышает|предельн|предел|максимальн|ограничен).{0,60}$/iu.test(prefix);
      };
      const rates=tokens.filter(t=>!isCap(t));
      if (!rates.length) continue;
      const replacement=rates.find((t,i)=>i>0 && /\sна\s*$/iu.test(text.slice(0,t.index)));
      // More than one non-cap rate without "с OLD на NEW" is ambiguous.
      const selected=replacement || (rates.length===1 ? rates[0] : null);
      if (!selected) continue;
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
