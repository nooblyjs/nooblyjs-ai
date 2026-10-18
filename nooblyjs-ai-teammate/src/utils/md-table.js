// Minimal Markdown table (de)serializer used for append-only ledgers such as timesheets.

const escapeCell = (value) =>
  String(value ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function splitRow(line) {
  const cells = [];
  let current = '';
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && i + 1 < inner.length) {
      current += inner[++i];
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseTable(body) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const headers = splitRow(lines[0]);
  return lines.slice(2).map((line) => {
    const cells = splitRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });
}

export function renderTable(columns, rows) {
  const header = `| ${columns.join(' | ')} |`;
  const divider = `|${columns.map(() => '---').join('|')}|`;
  const lines = rows.map((row) => `| ${columns.map((c) => escapeCell(row[c])).join(' | ')} |`);
  return [header, divider, ...lines].join('\n');
}
