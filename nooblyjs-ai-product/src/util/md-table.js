// Markdown tables in artefact bodies (goals, quality attributes, journey rows): written so people can read and
// edit them in the file, and read back into rows. Pipes inside a cell are escaped as \|.

const escapeCell = (value) => String(value ?? '').replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ').trim();

/**
 * Writes rows as a Markdown table.
 * @param {{ key: string, label: string }[]} columns
 * @param {object[]} rows
 */
export function toTable(columns, rows) {
  const header = `| ${columns.map((c) => escapeCell(c.label)).join(' | ')} |`;
  const rule = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((c) => escapeCell(row[c.key])).join(' | ')} |`);
  return [header, rule, ...body].join('\n');
}

/** Splits one table line into cells, honouring \| and \\. */
function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cell = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && (inner[i + 1] === '|' || inner[i + 1] === '\\')) {
      cell += inner[++i];
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

const isRule = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());

/**
 * Reads the first Markdown table in `text` into rows keyed by column. Columns are matched by label
 * (case-insensitive); a table without every column is ignored.
 * @param {string} text
 * @param {{ key: string, label: string }[]} columns
 * @returns {object[]}
 */
export function parseTable(text, columns) {
  const lines = String(text ?? '').split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].trim().startsWith('|') || !isRule(lines[i + 1])) continue;
    const labels = splitRow(lines[i]).map((l) => l.toLowerCase());
    const index = columns.map((c) => labels.indexOf(c.label.toLowerCase()));
    if (index.includes(-1)) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      rows.push(Object.fromEntries(columns.map((c, k) => [c.key, cells[index[k]] ?? ''])));
    }
    return rows;
  }
  return [];
}
