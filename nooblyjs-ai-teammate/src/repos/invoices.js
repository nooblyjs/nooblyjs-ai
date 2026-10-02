// Invoices: data/invoices/<id>.md, one per billed month. Totals in front matter; the line items
// (a snapshot of the approved timesheet entries at month close) as a Markdown table in the body.
import { parseTable, renderTable } from '../store/md-table.js';

export const INVOICE_ID = /^INV-\d{4,}$/;
const LINE_COLUMNS = ['entryId', 'teammateId', 'teammate', 'date', 'task', 'costCentre', 'model', 'hours', 'tokens', 'rate', 'amount', 'apiCost', 'caller', 'callerType'];
const NUMERIC = ['hours', 'tokens', 'rate', 'amount', 'apiCost'];

const fromRow = (row) => {
  const line = { ...row };
  for (const k of NUMERIC) line[k] = Number(row[k]) || 0;
  return line;
};

export class InvoicesRepo {
  constructor(store) {
    this.store = store;
  }

  async ids() {
    return (await this.store.list(['invoices'])).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter((id) => INVOICE_ID.test(id));
  }

  /** Invoice headers (no line items), newest month first. */
  async list() {
    const docs = await Promise.all((await this.ids()).map((id) => this.store.readDoc(['invoices', `${id}.md`])));
    return docs.filter(Boolean).map((d) => d.data).sort((a, b) => b.month.localeCompare(a.month) || b.id.localeCompare(a.id));
  }

  /** One invoice with its line items (`lines` is empty for imported invoices that only have a total). */
  async get(id) {
    if (!INVOICE_ID.test(String(id))) return null;
    const doc = await this.store.readDoc(['invoices', `${id}.md`]);
    return doc ? { ...doc.data, lines: parseTable(doc.body).map(fromRow) } : null;
  }

  async forMonth(month) {
    return (await this.list()).find((i) => i.month === month) ?? null;
  }

  async nextId() {
    const max = Math.max(0, ...(await this.ids()).map((id) => Number(id.slice(4))));
    return `INV-${String(max + 1).padStart(4, '0')}`;
  }

  async save(invoice, lines = null) {
    const { lines: _ignored, ...data } = invoice;
    const body = lines ? renderTable(LINE_COLUMNS, lines) : '';
    await this.store.writeDoc(['invoices', `${data.id}.md`], data, body);
    return lines ? { ...data, lines } : data;
  }

  /** Read-modify-write of the header only; line items are kept. */
  async update(id, fn) {
    if (!INVOICE_ID.test(String(id))) return null;
    let result = null;
    await this.store.updateDoc(['invoices', `${id}.md`], (doc) => {
      if (!doc) return null;
      const patch = fn(doc.data);
      if (!patch) return null;
      result = { ...doc.data, ...patch };
      return { data: result, body: doc.body };
    });
    return result;
  }
}
