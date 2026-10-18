/**
 * @fileoverview Personal-data redaction for content that arrives from outside
 * (NooblyJS Phase 8: "ingest with personal data redacted before anything is written").
 *
 * redact(text) replaces, in this order:
 *   1. South African ID numbers (13 digits, a valid birth date in the first six)  → [REDACTED ID]
 *   2. email addresses                                                            → [REDACTED EMAIL]
 *   3. phone numbers (+27 82 555 0142, 082 555 0142, (021) 555-0142, +44 20 …)    → [REDACTED PHONE]
 *
 * The order matters: an ID number would otherwise be half-eaten as a phone number.
 * Names are NOT redacted: that needs a model and a list of who may be named.
 *
 * Pure (no I/O), so it is unit-testable in isolation, the same shape as
 * components/reviewBlocks.js. The caller must never log what it passes in.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

'use strict';

const MARK = { id: '[REDACTED ID]', email: '[REDACTED EMAIL]', phone: '[REDACTED PHONE]' };

// YYMMDD + 7 more digits, standing alone (not inside a longer number).
const ID_NUMBER = /(?<![\d.])(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{7}(?![\d.])/g;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// A phone number as people write it: an optional +country code, then 9 to 15
// digits in groups separated by a space, a dot or a hyphen, with an optional
// bracketed area code. Anchored so it does not start or end inside a longer
// number, a decimal, a date (2026-10-10) or a version (1.2.3).
const PHONE = /(?<![\w.+-])(?:\+\d{1,3}[ .-]?)?(?:\(0?\d{1,4}\)[ .-]?)?\d{2,4}(?:[ .-]\d{2,4}){1,4}(?![\w-])|(?<![\w.+-])\+\d{9,15}(?![\w-])|(?<![\w.+-])0\d{9}(?![\w-])/g;

/** Is this match a phone number rather than a date, a range or a list of small numbers? */
function looksLikePhone(match) {
  const digits = match.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(match.trim())) return false; // an ISO date
  // A local number starts with 0 or a bracket; an international one with +.
  return /^[+(0]/.test(match.trim());
}

/**
 * @param {string} text
 * @return {{ text: string, counts: { id: number, email: number, phone: number }, total: number }}
 */
function redact(text) {
  const counts = { id: 0, email: 0, phone: 0 };
  let out = String(text ?? '');
  out = out.replace(ID_NUMBER, () => { counts.id += 1; return MARK.id; });
  out = out.replace(EMAIL, () => { counts.email += 1; return MARK.email; });
  out = out.replace(PHONE, (m) => {
    if (!looksLikePhone(m)) return m;
    counts.phone += 1;
    return MARK.phone;
  });
  return { text: out, counts, total: counts.id + counts.email + counts.phone };
}

/** File types whose content is text and so is redacted on the way in. */
const TEXT_FILE = /\.(md|markdown|txt|csv|json|ya?ml|html?)$/i;
const isTextFile = (name) => TEXT_FILE.test(String(name || ''));

module.exports = { redact, isTextFile, MARK };
