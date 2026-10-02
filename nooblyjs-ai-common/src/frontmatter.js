// @ts-check
// A tiny parser and writer for "frontmatter": settings at the top of a Markdown file.
//
//   ---
//   description: Review the current diff
//   allowed-tools: Read, Grep, Bash(git diff:*)
//   labels: [factory, docs]
//   ---
//   The rest of the file…
//
// Real YAML is big; we only need "key: value" lines (and [a, b] lists).
// Parsing moved here from the harness's util/frontmatter.js, writing from the
// factory's util/frontmatter.js.

/**
 * @param {string} text
 * @returns {{ data: Record<string, string | string[]>, body: string }}
 */
export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text };

  /** @type {Record<string, string | string[]>} */
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;
    /** @type {string | string[]} */
    let value = pair[2].trim();
    if (/^\[.*\]$/.test(value)) value = value.slice(1, -1).split(',').map((v) => unquote(v.trim())).filter(Boolean);
    else value = unquote(value);
    data[pair[1]] = value;
  }
  return { data, body: text.slice(match[0].length) };
}

/** @param {string} value */
function unquote(value) {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * The reverse of parseFrontmatter. Values that could break the format
 * (a newline, a leading "[" or quote) are written as JSON strings, which the
 * parser reads back as quoted text. Undefined and null values are left out.
 * @param {Record<string, string | number | boolean | string[] | undefined | null>} data
 * @param {string} body
 */
export function formatFrontmatter(data, body) {
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) lines.push(`${key}: [${value.map((v) => String(v).replace(/[,\]\n]/g, ' ')).join(', ')}]`);
    else lines.push(`${key}: ${safeScalar(String(value))}`);
  }
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

/** @param {string} text */
function safeScalar(text) {
  const oneLine = text.replace(/\r?\n/g, ' ');
  return /^[\s['"]|\s$/.test(oneLine) ? JSON.stringify(oneLine) : oneLine;
}
