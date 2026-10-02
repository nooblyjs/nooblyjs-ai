// Timesheets: one Markdown table per teammate per month at data/teammates/<id>/timesheets/YYYY-MM.md.
// Rows are appended as work is logged; approval flips a row's status in place.
import { parseTable, renderTable } from '../store/md-table.js';
import { monthKey } from '../util/dates.js';
import { newId } from '../util/ids.js';

const COLUMNS = ['id', 'date', 'task', 'costCentre', 'hours', 'tokens', 'rate', 'amount', 'apiCost', 'model', 'status', 'workId', 'caller', 'callerType'];
const NUMERIC = ['hours', 'tokens', 'rate', 'amount', 'apiCost'];
const file = (teammateId, month) => ['teammates', teammateId, 'timesheets', `${month}.md`];

const fromRow = (teammateId, row) => {
  const entry = { ...row, teammateId };
  for (const k of NUMERIC) entry[k] = Number(row[k]) || 0;
  entry.workId = row.workId || null;
  entry.caller = row.caller || null; // who asked for the work: owner name or API key name
  entry.callerType = row.callerType || null; // user | key | system
  return entry;
};

export class TimesheetsRepo {
  constructor(store) {
    this.store = store;
  }

  async months(teammateId) {
    return (await this.store.list(['teammates', teammateId, 'timesheets']))
      .filter((f) => /^\d{4}-\d{2}\.md$/.test(f))
      .map((f) => f.slice(0, 7));
  }

  async readMonth(teammateId, month) {
    const doc = await this.store.readDoc(file(teammateId, month));
    return doc ? parseTable(doc.body).map((row) => fromRow(teammateId, row)) : [];
  }

  /** Entries with start <= date <= end (inclusive ISO dates). */
  async listRange(teammateId, start, end) {
    const months = (await this.months(teammateId)).filter((m) => m >= monthKey(start) && m <= monthKey(end));
    const rows = (await Promise.all(months.map((m) => this.readMonth(teammateId, m)))).flat();
    return rows.filter((e) => e.date >= start && e.date <= end);
  }

  async append(teammateId, entry) {
    const row = { id: entry.id ?? newId('ts'), status: 'pending', ...entry };
    const month = monthKey(row.date);
    await this.store.updateDoc(file(teammateId, month), (doc) => {
      const rows = doc ? parseTable(doc.body) : [];
      rows.push(row);
      rows.sort((a, b) => a.date.localeCompare(b.date));
      return {
        data: { teammate: teammateId, month, currency: 'USD', ...(doc?.data ?? {}) },
        body: renderTable(COLUMNS, rows),
      };
    });
    return fromRow(teammateId, row);
  }

  /** Approve one entry. Looks through the teammate's months (newest first) to find it. */
  async approve(teammateId, entryId) {
    for (const month of (await this.months(teammateId)).reverse()) {
      let found = null;
      await this.store.updateDoc(file(teammateId, month), (doc) => {
        if (!doc) return null;
        const rows = parseTable(doc.body);
        const row = rows.find((r) => r.id === entryId);
        if (!row) return null;
        row.status = 'approved';
        found = fromRow(teammateId, row);
        return { data: doc.data, body: renderTable(COLUMNS, rows) };
      });
      if (found) return found;
    }
    return null;
  }
}
