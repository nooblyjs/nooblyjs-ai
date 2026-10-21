// Personal data is redacted before an agent log is written (nooblyjs-ai.md): e-mail addresses, phone numbers and South
// African ID numbers become placeholders. What the person typed still goes to the teammate as they wrote it; only
// what this engine keeps on disk is redacted. `[CONFIRM the full list with the privacy team]`.

const RULES = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // SA ID numbers first: phone numbers would otherwise match part of them.
  [/\b\d{13}\b/g, '[id number]'],
  // +27 21 555 0000, 082 555 1234, (021) 555-0000
  [/(?:\+\d{1,3}[\s-]?\d{1,3}|\(?0\d{1,3}\)?)[\s-]?\d{3}[\s-]?\d{3,4}\b/g, '[phone]'],
];

export function redact(text) {
  if (typeof text !== 'string' || !text) return text;
  return RULES.reduce((out, [pattern, label]) => out.replace(pattern, label), text);
}
