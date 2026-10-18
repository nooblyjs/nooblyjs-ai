// utils/pdf.js: the PDF writer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfDocument, fit, textWidth } from '../../src/utils/pdf.js';

test('the PDF writer produces a valid cross-reference table and escapes text', () => {
  const pdf = new PdfDocument();
  pdf.text(48, 700, 'Invoice (INV-0010) · total \\ $1,234.50 — “paid”');
  pdf.addPage().line(48, 700, 500, 700);
  const buf = pdf.toBuffer();
  const s = buf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /\/Count 2/);
  assert.ok(s.includes('Invoice \\(INV-0010\\) \xB7 total \\\\ $1,234.50 \x97 \x93paid\x94'));
  const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.ok(s.slice(xref).startsWith('xref'));
  const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
});

test('text fitting uses Helvetica widths', () => {
  assert.equal(textWidth('1000', 10), 22.24);
  const long = 'Quarterly competitor scan for twelve enterprise accounts';
  const short = fit(long, 80, 9);
  assert.ok(short.endsWith('…') && textWidth(short, 9) <= 80);
  assert.equal(fit('Short', 80, 9), 'Short');
});
