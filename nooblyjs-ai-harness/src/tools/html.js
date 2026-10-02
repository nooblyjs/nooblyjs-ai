// Phase 18: turn a web page into plain text the model can read.
//
// HTML is mostly markup: <div class="…">, scripts, styles, navigation. Sending
// it raw wastes tokens, so we keep the words and a little structure (headings,
// list items, links, paragraphs). This is a deliberately simple regex-based
// converter, not a real HTML parser: good enough for docs and articles.
//
// Note what it does NOT do: it can't tell visible text from HIDDEN text
// (display:none, white-on-white…). A page can hide instructions meant for an
// AI agent in there. See .claude/docs/18-robustness.md (prompt injection).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', copy: '©' };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** @returns {{ title: string | null, text: string }} */
export function htmlToText(html, baseUrl) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])\b[^>]*>/gi, (_, level) => `\n\n${'#'.repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(pre)\b[^>]*>/gi, '\n```\n')
    .replace(/<\/pre>/gi, '\n```\n')
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      const url = absoluteUrl(href, baseUrl);
      return url && label && !href.startsWith('#') && !href.startsWith('javascript:') ? `${label} (${url})` : label;
    })
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|tr|table|ul|ol|blockquote|main|nav)>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  text = decodeEntities(text)
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: title ? decodeEntities(title).replace(/\s+/g, ' ').trim() : null, text };
}

function absoluteUrl(href, base) {
  try {
    return new URL(decodeEntities(href), base).href;
  } catch {
    return null;
  }
}
