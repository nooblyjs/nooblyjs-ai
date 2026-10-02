// Audit trail of sign-ins, key changes and configuration changes: data/system/audit/YYYY-MM.md (Markdown table).
import { parseTable, renderTable } from '../store/md-table.js';

const COLUMNS = ['ts', 'actor', 'action', 'target', 'detail'];
const file = (month) => ['system', 'audit', `${month}.md`];

export class AuditService {
  constructor(store, { log = console } = {}) {
    this.store = store;
    this.log = log;
  }

  /** Never throws: a failed audit write is logged but does not fail the request. */
  async record(actor, action, target = '', detail = '') {
    const ts = new Date().toISOString();
    const row = {
      ts,
      actor: actor ? (actor.type === 'key' ? `key:${actor.name}` : actor.type === 'anonymous' ? `anonymous ${actor.ip ?? ''}`.trim() : actor.name) : 'system',
      action,
      target,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
    };
    try {
      await this.store.updateDoc(file(ts.slice(0, 7)), (doc) => {
        const rows = doc ? parseTable(doc.body) : [];
        rows.push(row);
        return { data: { month: ts.slice(0, 7) }, body: renderTable(COLUMNS, rows) };
      });
    } catch (err) {
      this.log.error?.(`[audit] could not record ${action}: ${err.message}`);
    }
  }

  async list({ limit = 100 } = {}) {
    const months = (await this.store.list(['system', 'audit'])).filter((f) => /^\d{4}-\d{2}\.md$/.test(f)).reverse();
    const out = [];
    for (const m of months) {
      const doc = await this.store.readDoc(['system', 'audit', m]);
      out.push(...(doc ? parseTable(doc.body).reverse() : []));
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  }
}
