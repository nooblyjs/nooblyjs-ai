// CSV for timesheet exports and invoices. Both use the same columns so an invoice can be checked against the export.

/** Quotes when needed and defuses spreadsheet formulas (cells starting with = + - @). */
export const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

export const ENTRY_HEADER = ['date', 'teammate', 'task', 'cost_centre', 'model', 'hours', 'tokens', 'rate', 'amount_usd', 'api_cost_usd', 'status', 'requested_by', 'requested_via'];

/** One timesheet entry as a CSV row. `name` is the teammate's display name. */
export const entryRow = (e, name) => [e.date, name, e.task, e.costCentre, e.model, e.hours, e.tokens, e.rate, e.amount, e.apiCost, e.status, e.caller ?? '', e.callerType ?? ''];
