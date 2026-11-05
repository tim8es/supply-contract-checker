/**
 * Evidence verifier shared by rules, optional extractors and future models.
 * A quote existing in source is necessary but NOT sufficient for semantic
 * entitlement. That is why document type, signing/effectiveness and
 * contradictions remain independent policy-engine checks.
 */
export function verifyEvidence(document, candidate, parseToken) {
  const failures = [];
  if (!document || typeof document.name !== 'string' || typeof document.text !== 'string') {
    return {valid:false,failures:['invalid_document']};
  }
  const evidence = candidate?.evidence;
  if (!evidence || typeof evidence !== 'object') return {valid:false,failures:['no_evidence']};
  if (evidence.file !== document.name) failures.push('wrong_file');
  if (!Number.isInteger(evidence.line) || !Number.isInteger(evidence.endLine) ||
      evidence.line < 1 || evidence.endLine < evidence.line) failures.push('invalid_line_interval');
  else {
    const lines = document.text.replace(/\r\n?/g,'\n').split('\n');
    if (evidence.endLine > lines.length ||
        evidence.quote !== lines.slice(evidence.line-1,evidence.endLine).join('\n')) {
      failures.push('quote_mismatch');
    }
  }
  // Match a normalized token against the exact *unmodified* source quote.
  // Russian financial TXT may use NBSP/thin spaces or wrap amounts across lines.
  const sameWhitespace = text => text.replace(/[\u00a0\u202f]/gu,' ').replace(/\s+/gu,' ');
  if (typeof evidence.valueText !== 'string' || !evidence.valueText.length ||
      !sameWhitespace(evidence.quote ?? '').includes(sameWhitespace(evidence.valueText))) {
    failures.push('token_not_in_quote');
  }
  if (typeof parseToken !== 'function') failures.push('missing_token_parser');
  else if (!failures.includes('token_not_in_quote')) {
    try {
      const normalized = parseToken(evidence.valueText);
      if (normalized == null || !Object.is(normalized,candidate.value)) failures.push('value_mismatch');
    } catch { failures.push('invalid_value_token'); }
  }
  return {valid:failures.length===0,failures};
}

/**
 * The strongest safe assertion from quote-only validation is:
 *   "the value can be reconstructed from exactly these source bytes".
 * It is NOT a verification of legal validity or applicability.
 */
export function asEvidenceResult(document,candidate,parseToken) {
  const check = verifyEvidence(document,candidate,parseToken);
  return check.valid
    ? {candidate:{...candidate,evidence:{...candidate.evidence,verified:true}},issues:[]}
    : {candidate:null,issues:['Доказательство не прошло проверку: '+check.failures.join(', ')]};
}
