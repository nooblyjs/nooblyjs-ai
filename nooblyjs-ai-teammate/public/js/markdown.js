// Small, safe Markdown renderer for teammate output. All text is HTML-escaped first; only a fixed set of
// constructs is turned into markup: headings, paragraphs, lists, blockquotes, fenced code, tables, rules,
// and inline code, bold, italic and links (http, https, mailto and relative URLs only).

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function safeUrl(url) {
  const decoded = url.replace(/&amp;/g, '&').trim();
  if (/^(https?:|mailto:)/i.test(decoded) || /^[/#.]/.test(decoded)) return url;
  return null;
}

function inline(text) {
  const codes = [];
  let out = escape(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const href = safeUrl(url);
      return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    })
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

export function renderMarkdown(source = '') {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;

  const isBlockStart = (l) => /^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+[.)])\s+|\s*(-{3,}|\*{3,}|_{3,})\s*$)/.test(l) || (l.includes('|') && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1] ?? ''));

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    const fence = /^```\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      html.push(`<pre><code${fence[1] ? ` data-lang="${escape(fence[1])}"` : ''}>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6); // keep below the page's own h1/h2
      html.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }

    // Table: header row followed by a |---| separator row
    if (line.includes('|') && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      html.push(
        `<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, ci) => `<td>${inline(r[ci] ?? '')}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }

    const listMatch = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m && /\d/.test(m[1]) === ordered) {
          items.push(m[2]);
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1] += ` ${lines[i++].trim()}`; // continuation line
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered ? Number.parseInt(listMatch[1], 10) : 1;
      html.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${items
        .map((it) => {
          const task = /^\[([ xX])\]\s+(.*)$/.exec(it);
          return task ? `<li>${task[1] === ' ' ? '☐' : '☑'} ${inline(task[2])}</li>` : `<li>${inline(it)}</li>`;
        })
        .join('')}</${tag}>`);
      continue;
    }

    // Paragraph: gather until a blank line or another block starts
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
    html.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return html.join('\n');
}
