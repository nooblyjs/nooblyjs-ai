// `## Heading` sections of a Markdown body, read into { key: text } and written back in a fixed order. Used by
// ADRs (Context / Decision / Consequences); specs have their own richer format (services/spec-format.js).

/** @param {{ key: string, heading: string }[]} parts */
export function readSections(body, parts) {
  const out = Object.fromEntries(parts.map((p) => [p.key, '']));
  const byHeading = new Map(parts.map((p) => [p.heading.toLowerCase(), p.key]));
  let key = null;
  const lines = { };
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      key = byHeading.get(m[1].toLowerCase()) ?? null;
      continue;
    }
    if (key) (lines[key] ??= []).push(line);
  }
  for (const [k, ls] of Object.entries(lines)) out[k] = ls.join('\n').trim();
  return out;
}

/**
 * Every `## Heading` section of a body, in order, as { heading, text }: for documents whose headings come from a
 * template people change (portfolios, value streams). Text before the first heading is left out.
 */
export function splitSections(body) {
  const out = [];
  let current = null;
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) out.push(current = { heading: m[1], lines: [] });
    else current?.lines.push(line);
  }
  return out.map((s) => ({ heading: s.heading, text: s.lines.join('\n').trim() }));
}

export function writeSections(values, parts) {
  return parts.filter((p) => values[p.key]?.trim()).map((p) => `## ${p.heading}\n\n${values[p.key].trim()}`).join('\n\n');
}
