// A tiny PDF writer for invoices: A4 pages of Helvetica text and rules, no dependencies.
// Text is encoded as WinAnsi, so common punctuation (· — ’ “ ” …) works; other characters become '?'.

const PAGE_W = 595.28;
const PAGE_H = 841.89;

// Characters outside Latin-1 that WinAnsi places in 0x80–0x9F.
const WIN_ANSI = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

// Helvetica advance widths (1/1000 em) for ASCII 32–126; anything else is treated as 556.
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// Helvetica-Bold, same range.
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

export function textWidth(text, size, bold = false) {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    w += c >= 32 && c <= 126 ? table[c - 32] : 556;
  }
  return (w * size) / 1000;
}

/** Shortens text with an ellipsis so it fits in `width` points. */
export function fit(text, width, size, bold = false) {
  let s = String(text ?? '');
  if (textWidth(s, size, bold) <= width) return s;
  while (s.length && textWidth(`${s}…`, size, bold) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function encode(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    let b = WIN_ANSI[ch] ?? (c < 256 && (c >= 32 || c === 9) && !(c >= 0x80 && c <= 0x9f) ? c : 63);
    if (b === 40 || b === 41 || b === 92) bytes.push(92); // escape ( ) \
    bytes.push(b);
  }
  return Buffer.from(bytes).toString('latin1');
}

const n = (v) => (Math.round(v * 100) / 100).toString();
const rgb = (hex) => [1, 3, 5].map((i) => n(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');

export class PdfDocument {
  constructor({ margin = 48 } = {}) {
    this.margin = margin;
    this.width = PAGE_W;
    this.height = PAGE_H;
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_H - this.margin;
    return this;
  }

  /** Starts a new page when fewer than `needed` points remain above the bottom margin. */
  ensure(needed) {
    if (this.y - needed < this.margin) this.addPage();
    return this;
  }

  text(x, y, text, { size = 10, bold = false, color = '#241C1A', align = 'left' } = {}) {
    const w = align === 'left' ? 0 : textWidth(text, size, bold);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.ops.push(`BT ${rgb(color)} rg /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${n(left)} ${n(y)} Td (${encode(text)}) Tj ET`);
    return this;
  }

  line(x1, y1, x2, y2, { color = '#E6DED8', width = 0.75 } = {}) {
    this.ops.push(`${rgb(color)} RG ${n(width)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
    return this;
  }

  rect(x, y, w, h, { fill = '#F5F1EE' } = {}) {
    this.ops.push(`${rgb(fill)} rg ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
    return this;
  }

  /** Serializes to a PDF 1.4 Buffer. */
  toBuffer() {
    const objects = [];
    const add = (body) => objects.push(body) && objects.length;
    const catalog = add(null);
    const pagesId = add(null);
    const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const ops of this.pages) {
      const content = ops.join('\n');
      const stream = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${stream} 0 R >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}
