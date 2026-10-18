// Month-end and billing administration: closing a month into an invoice, invoice downloads (CSV, PDF),
// the settings and model price screens, and the token view of billing (usage and API cost against billed amounts).
import { availableModels } from 'nooblyjs-ai-common/discovery';
import { HttpError, badRequest, notFound } from '../utils/errors.js';
import { addMonths, isoDate, longDate, monthName, periodRange } from '../utils/dates.js';
import { round1, round2 } from '../utils/ids.js';
import { ENTRY_HEADER, entryRow, toCsv } from '../utils/csv.js';
import { PdfDocument, fit } from '../utils/pdf.js';
import { invoiceSummary, sumEntries } from './team.js';
import { BOARD_DEFAULTS } from '../config/board.js';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MODEL_ID = /^[\w.:/@-]{1,100}$/;
const TIERS = ['LIGHT', 'BALANCED', 'PREMIUM'];
// A tier's rate card when no offered model has it yet (the seed's Haiku, Sonnet and Opus).
const TIER_DEFAULTS = {
  LIGHT: { symbol: '$', baseRate: 4, computePerHour: 2.5, toolsPerHour: 0.5, color: '#F2A27E', maxTokens: 16000 },
  BALANCED: { symbol: '$$', baseRate: 16, computePerHour: 10, toolsPerHour: 2, color: '#C2471F', maxTokens: 32000, effort: 'medium' },
  PREMIUM: { symbol: '$$$', baseRate: 50, computePerHour: 31, toolsPerHour: 5, color: '#241C1A', maxTokens: 64000, effort: 'high' },
};
/** "gpt-6.1-sol" → "gpt-6-1-sol": a models.md key. */
const keyOf = (modelId) => String(modelId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'model';
const usd = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (month) => `${monthName(`${month}-01`)} ${month.slice(0, 4)}`;
const invalid = (errors) => new HttpError(422, 'validation_failed', 'Please fix the highlighted fields', errors);

export class BillingService {
  /** `discover` lists the models the providers offer (nooblyjs-ai-common's discovery; tests pass a fake). */
  constructor(repos, team, { now = () => isoDate(), store, discover = ({ refresh } = {}) => availableModels({ refresh }) } = {}) {
    this.repos = repos;
    this.discover = discover;
    this.team = team;
    this.today = now;
    this.store = store;
  }

  // ---------- Month close & invoices ----------

  checkMonth(month) {
    if (!MONTH.test(String(month ?? ''))) throw badRequest('month must look like 2026-09');
    if (month >= this.today().slice(0, 7)) throw new HttpError(422, 'month_not_ended', `${monthLabel(month)} hasn't ended yet. You can close a month once it is over.`);
  }

  /** The month's timesheet entries across every teammate (retired ones too), with display names. */
  async monthEntries(month) {
    const teammates = await this.repos.teammates.list({ includeRetired: true });
    const names = new Map(teammates.map((t) => [t.id, t.name]));
    const end = isoDate(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
    const entries = await this.team.entriesFor(teammates, `${month}-01`, end);
    return entries
      .map((e) => ({ ...e, teammateName: names.get(e.teammateId) ?? e.teammateId }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.teammateName.localeCompare(b.teammateName) || a.id.localeCompare(b.id));
  }

  /** What closing `month` would do: the approved total, anything still pending, and any existing invoice. */
  async closePreview(month) {
    this.checkMonth(month);
    const entries = await this.monthEntries(month);
    const approved = entries.filter((e) => e.status === 'approved');
    const pending = entries.filter((e) => e.status === 'pending');
    const existing = await this.repos.invoices.forMonth(month);
    return {
      month,
      monthLabel: monthLabel(month),
      approved: { count: approved.length, ...sumEntries(approved) },
      pending: { count: pending.length, amount: sumEntries(pending).amount, entries: pending.slice(0, 20).map(({ id, teammateId, teammateName, date, task, amount }) => ({ id, teammateId, teammateName, date, task, amount })) },
      existing: existing ? invoiceSummary(existing) : null,
    };
  }

  /**
   * Generate the month's invoice from its approved entries. An open invoice for the month is regenerated
   * under the same number; a paid one is final. Pending entries block the close unless `excludePending`.
   */
  async closeMonth(month, { excludePending = false } = {}) {
    this.checkMonth(month);
    return this.store.withLock(['invoices', 'close.lock'], async () => {
      const existing = await this.repos.invoices.forMonth(month);
      if (existing?.status === 'paid') throw new HttpError(409, 'invoice_paid', `${existing.id} for ${monthLabel(month)} is already paid. Mark it unpaid to regenerate it.`);
      const entries = await this.monthEntries(month);
      const pending = entries.filter((e) => e.status === 'pending');
      if (pending.length && !excludePending) {
        const amount = sumEntries(pending).amount;
        throw new HttpError(409, 'pending_entries', `${pending.length} ${pending.length === 1 ? 'entry is' : 'entries are'} still waiting for approval (${usd(amount)}). Approve them first, or close the month without them.`, { count: pending.length, amount });
      }
      const approved = entries.filter((e) => e.status === 'approved');
      if (!approved.length) throw new HttpError(422, 'nothing_to_invoice', `There is no approved time in ${monthLabel(month)} to invoice.`);

      const settings = await this.repos.config.getSettings();
      const totals = sumEntries(approved);
      const dueDay = String(settings.billing?.invoiceDueDay ?? 15).padStart(2, '0');
      const invoice = {
        id: existing?.id ?? (await this.repos.invoices.nextId()),
        month,
        amount: totals.amount,
        hours: totals.hours,
        tokens: totals.tokens,
        apiCost: totals.apiCost,
        entries: approved.length,
        currency: settings.billing?.currency ?? 'USD',
        status: 'open',
        issuedAt: this.today(),
        dueDate: `${addMonths(`${month}-01`, 1).slice(0, 7)}-${dueDay}`,
        billTo: settings.owner?.name,
        excludedPending: pending.length ? { count: pending.length, amount: sumEntries(pending).amount } : undefined,
      };
      const lines = approved.map((e) => ({
        entryId: e.id, teammateId: e.teammateId, teammate: e.teammateName, date: e.date, task: e.task, costCentre: e.costCentre, model: e.model,
        hours: e.hours, tokens: e.tokens, rate: e.rate, amount: e.amount, apiCost: e.apiCost, caller: e.caller ?? '', callerType: e.callerType ?? '',
      }));
      const saved = await this.repos.invoices.save(invoice, lines);
      return { invoice: this.withBreakdown(saved), regenerated: Boolean(existing) };
    });
  }

  withBreakdown(inv) {
    const group = (key, label = key) => {
      const map = new Map();
      for (const l of inv.lines ?? []) {
        const k = l[key];
        const row = map.get(k) ?? { id: k, name: l[label], hours: 0, amount: 0, entries: 0 };
        row.hours = round1(row.hours + l.hours);
        row.amount = round2(row.amount + l.amount);
        row.entries += 1;
        map.set(k, row);
      }
      return [...map.values()].sort((a, b) => b.amount - a.amount);
    };
    return { ...invoiceSummary(inv), byTeammate: group('teammateId', 'teammate'), byCostCentre: group('costCentre') };
  }

  async invoiceOr404(id) {
    const inv = await this.repos.invoices.get(id);
    if (!inv) throw notFound('Invoice');
    return inv;
  }

  async invoice(id) {
    return this.withBreakdown(await this.invoiceOr404(id));
  }

  async setInvoiceStatus(id, status) {
    if (!['open', 'paid'].includes(status)) throw badRequest('status must be open or paid');
    await this.invoiceOr404(id);
    const updated = await this.repos.invoices.update(id, () => ({ status, paidAt: status === 'paid' ? this.today() : undefined }));
    return invoiceSummary(updated);
  }

  /** The invoice's line items in the same columns as the billing export, so the two can be compared row for row. */
  async invoiceCsv(id) {
    const inv = await this.invoiceOr404(id);
    const rows = inv.lines.map((l) => entryRow({ ...l, status: 'approved' }, l.teammate));
    return { filename: `${inv.id}-${inv.month}.csv`, csv: toCsv([ENTRY_HEADER, ...rows]) };
  }

  async invoicePdf(id) {
    const inv = this.withBreakdown(await this.invoiceOr404(id));
    const settings = await this.repos.config.getSettings();
    const pdf = new PdfDocument();
    const L = pdf.margin;
    const R = pdf.width - pdf.margin;
    const muted = '#6B605A';

    pdf.text(L, pdf.y - 14, 'Teammates', { size: 12, bold: true, color: '#C2471F' });
    pdf.text(R, pdf.y - 14, inv.status === 'paid' ? 'PAID' : 'OPEN', { size: 11, bold: true, align: 'right', color: inv.status === 'paid' ? '#1C5A5F' : '#8A3415' });
    pdf.y -= 52;
    pdf.text(L, pdf.y, `Invoice ${inv.id}`, { size: 24, bold: true });
    pdf.y -= 22;
    pdf.text(L, pdf.y, `Digital teammate time for ${inv.monthLabel}`, { size: 11, color: muted });
    pdf.y -= 34;

    const facts = [
      ['Bill to', `${inv.billTo ?? settings.owner?.name ?? ''}${settings.owner?.title ? ` · ${settings.owner.title}` : ''}`],
      ['Issued', inv.issuedAt ? longDate(inv.issuedAt) : 'Imported'],
      ['Due', inv.dueDate ? longDate(inv.dueDate) : '—'],
      ...(inv.paidAt ? [['Paid', longDate(inv.paidAt)]] : []),
    ];
    for (const [k, v] of facts) {
      pdf.text(L, pdf.y, k, { size: 9, color: muted });
      pdf.text(L + 70, pdf.y, v, { size: 10 });
      pdf.y -= 16;
    }
    pdf.y -= 10;
    pdf.rect(L, pdf.y - 34, R - L, 46, { fill: '#241C1A' });
    pdf.text(L + 14, pdf.y - 8, 'Amount due', { size: 10, color: '#CDBFB7' });
    pdf.text(L + 14, pdf.y - 26, `${inv.hours ?? 0} hours · ${inv.entries ?? inv.lines.length} timesheet entries`, { size: 9, color: '#CDBFB7' });
    pdf.text(R - 14, pdf.y - 22, usd(inv.amount), { size: 20, bold: true, align: 'right', color: '#FFF8F2' });
    pdf.y -= 66;

    const table = (title, cols, rows, total) => {
      pdf.ensure(60);
      pdf.text(L, pdf.y, title, { size: 12, bold: true });
      pdf.y -= 18;
      const header = () => {
        cols.forEach((c) => pdf.text(c.align === 'right' ? c.x + c.w : c.x, pdf.y, c.label, { size: 8, bold: true, color: muted, align: c.align }));
        pdf.y -= 6;
        pdf.line(L, pdf.y, R, pdf.y, { color: '#DCD2CB' });
        pdf.y -= 12;
      };
      header();
      for (const row of rows) {
        if (pdf.y - 14 < pdf.margin) {
          pdf.addPage();
          header();
        }
        cols.forEach((c, i) => pdf.text(c.align === 'right' ? c.x + c.w : c.x, pdf.y, fit(row[i], c.w, 9), { size: 9, align: c.align }));
        pdf.y -= 5;
        pdf.line(L, pdf.y, R, pdf.y, { color: '#F0E9E4', width: 0.5 });
        pdf.y -= 11;
      }
      if (total) {
        cols.forEach((c, i) => total[i] != null && pdf.text(c.align === 'right' ? c.x + c.w : c.x, pdf.y, String(total[i]), { size: 9, bold: true, align: c.align }));
        pdf.y -= 16;
      }
      pdf.y -= 16;
    };

    if (!inv.lines.length) {
      pdf.text(L, pdf.y, 'This invoice was imported with a total only, so it has no line items.', { size: 10, color: muted });
    } else {
      const w = R - L;
      table('By teammate', [
        { label: 'TEAMMATE', x: L, w: w * 0.55 },
        { label: 'ENTRIES', x: L + w * 0.55, w: w * 0.12, align: 'right' },
        { label: 'HOURS', x: L + w * 0.67, w: w * 0.13, align: 'right' },
        { label: 'AMOUNT', x: L + w * 0.8, w: w * 0.2, align: 'right' },
      ], inv.byTeammate.map((r) => [r.name, String(r.entries), String(r.hours), usd(r.amount)]), ['Total', String(inv.lines.length), String(inv.hours), usd(inv.amount)]);
      table('By cost centre', [
        { label: 'COST CENTRE', x: L, w: w * 0.67 },
        { label: 'HOURS', x: L + w * 0.67, w: w * 0.13, align: 'right' },
        { label: 'AMOUNT', x: L + w * 0.8, w: w * 0.2, align: 'right' },
      ], inv.byCostCentre.map((r) => [r.name, String(r.hours), usd(r.amount)]));
      table('Timesheet entries', [
        { label: 'DATE', x: L, w: w * 0.13 },
        { label: 'TEAMMATE', x: L + w * 0.13, w: w * 0.18 },
        { label: 'TASK', x: L + w * 0.31, w: w * 0.32 },
        { label: 'COST CENTRE', x: L + w * 0.64, w: w * 0.14 },
        { label: 'HOURS', x: L + w * 0.78, w: w * 0.07, align: 'right' },
        { label: 'AMOUNT', x: L + w * 0.85, w: w * 0.15, align: 'right' },
      ], inv.lines.map((l) => [l.date, l.teammate, l.task, l.costCentre, String(l.hours), usd(l.amount)]), [null, null, null, 'Total', String(inv.hours), usd(inv.amount)]);
    }
    pdf.ensure(30);
    pdf.text(L, pdf.margin - 18, `Hours are tokens processed ÷ ${(settings.billing?.tokensPerHour ?? 300000).toLocaleString('en-US')} per hour, rounded up to ${settings.billing?.billingIncrementHours ?? 0.1} h, × each teammate's rate.`, { size: 8, color: muted });
    return { filename: `${inv.id}-${inv.month}.pdf`, pdf: pdf.toBuffer() };
  }

  // ---------- Settings (budgets, cost centres, owner, billing conversion, alerts) ----------

  async settings() {
    const s = await this.repos.config.getSettings();
    return {
      owner: s.owner ?? {},
      budgets: s.budgets ?? {},
      costCentres: s.costCentres ?? [],
      timezone: s.timezone ?? 'UTC',
      billing: { estimateOutputTokens: 4000, ...(s.billing ?? {}) },
      alerts: { warnAtPct: 80, ...(s.alerts ?? {}) },
      board: { ...BOARD_DEFAULTS, ...(s.board ?? {}) },
    };
  }

  async updateSettings(input = {}) {
    const current = await this.repos.config.getSettings();
    const errors = {};
    const patch = {};
    const num = (group, key, min, max, { integer = false } = {}) => {
      const v = input[group]?.[key];
      if (v === undefined) return;
      const x = Number(v);
      if (v === '' || v === null || !Number.isFinite(x) || x < min || x > max || (integer && !Number.isInteger(x))) {
        errors[`${group}.${key}`] = `Enter a ${integer ? 'whole ' : ''}number between ${min.toLocaleString('en-US')} and ${max.toLocaleString('en-US')}`;
        return;
      }
      (patch[group] ??= { ...(current[group] ?? {}) })[key] = integer ? x : round2(x);
    };

    if (input.owner !== undefined) {
      for (const [key, max] of [['name', 60], ['title', 60]]) {
        const v = input.owner?.[key];
        if (v === undefined) continue;
        const s = String(v).trim();
        if (key === 'name' && !s) errors['owner.name'] = 'Required';
        else if (s.length > max) errors[`owner.${key}`] = `Keep it under ${max} characters`;
        else (patch.owner ??= { ...(current.owner ?? {}) })[key] = s;
      }
    }
    for (const p of ['week', 'month', 'quarter']) num('budgets', p, 0, 100000000);
    num('billing', 'tokensPerHour', 1000, 100000000, { integer: true });
    num('billing', 'billingIncrementHours', 0.01, 1);
    num('billing', 'invoiceDueDay', 1, 28, { integer: true });
    num('billing', 'estimateHoursPerMonth', 1, 744);
    num('billing', 'estimateOutputTokens', 100, 1000000, { integer: true });
    num('alerts', 'warnAtPct', 1, 100, { integer: true });
    // The Team board (.claude/specs/team-board/design.md §8).
    num('board', 'briefingTokens', 200, 8000, { integer: true });
    num('board', 'agentPostsPerDay', 0, 500, { integer: true });
    num('board', 'agentRepliesPerDay', 0, 1000, { integer: true });
    num('board', 'restAfterAgentReplies', 1, 20, { integer: true });
    num('board', 'staleClaimHours', 1, 720, { integer: true });
    if (input.board?.standupTime !== undefined) {
      const time = String(input.board.standupTime ?? '').trim();
      if (time && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) errors['board.standupTime'] = 'Use a 24-hour time like 09:00, or leave it empty for no stand-ups';
      else (patch.board ??= { ...(current.board ?? {}) }).standupTime = time;
    }
    if (input.board?.digestTeammate !== undefined) {
      const slug = String(input.board.digestTeammate ?? '').trim();
      const t = slug ? await this.repos.teammates.get(slug) : null;
      if (slug && (!t || t.retiredAt)) errors['board.digestTeammate'] = 'Choose an active teammate, or nobody';
      else (patch.board ??= { ...(current.board ?? {}) }).digestTeammate = slug || null;
    }

    if (input.timezone !== undefined) {
      const tz = String(input.timezone ?? '').trim();
      let ok = false;
      try {
        ok = Boolean(tz) && Boolean(new Intl.DateTimeFormat('en-US', { timeZone: tz }));
      } catch { /* unknown zone */ }
      if (!ok) errors.timezone = 'Use an IANA time zone such as Africa/Johannesburg or UTC';
      else patch.timezone = tz;
    }

    if (input.costCentres !== undefined) {
      const list = Array.isArray(input.costCentres) ? input.costCentres.map((c) => String(c ?? '').trim()) : null;
      if (!list || !list.length) errors.costCentres = 'Keep at least one cost centre';
      else if (list.some((c) => !c || c.length > 40)) errors.costCentres = 'Names must be 1 to 40 characters';
      else if (new Set(list.map((c) => c.toLowerCase())).size !== list.length) errors.costCentres = 'Each cost centre needs a different name';
      else if (list.length > 50) errors.costCentres = 'Up to 50 cost centres';
      else {
        const teammates = await this.repos.teammates.list();
        const inUse = teammates.filter((t) => t.costCentre && !list.includes(t.costCentre));
        if (inUse.length) {
          const names = inUse.map((t) => `${t.name} (${t.costCentre})`).join(', ');
          errors.costCentres = `Still billed to by ${names}. Move ${inUse.length === 1 ? 'them' : 'those teammates'} to another cost centre first.`;
        } else patch.costCentres = list;
      }
    }

    if (Object.keys(errors).length) throw invalid(errors);
    await this.repos.config.updateSettings(patch);
    return { settings: await this.settings(), changed: Object.keys(patch) };
  }

  // ---------- Models & pricing ----------

  async models() {
    const models = await this.repos.config.getModels();
    const today = this.today();
    return Object.entries(models).map(([id, m]) => {
      const age = m.pricingReviewedAt ? Math.floor((Date.parse(today) - Date.parse(m.pricingReviewedAt)) / 86400000) : null;
      return {
        id, name: m.name, tier: m.tier, symbol: m.symbol, color: m.color, description: m.description, provider: m.provider, modelId: m.modelId,
        priceSource: m.priceSource ?? (m.provider === 'anthropic' ? 'catalogue' : null),
        baseRate: m.baseRate, computePerHour: m.computePerHour ?? 0, toolsPerHour: m.toolsPerHour ?? 0,
        pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...(m.pricing ?? {}) },
        pricingReviewedAt: m.pricingReviewedAt ?? null,
        reviewStale: age == null || age > 90,
      };
    });
  }

  /**
   * Every model the configured providers offer right now (nooblyjs-ai-common's discovery: each provider's own list, priced
   * from the catalogue, the provider, or OpenRouter as a labelled reference), each marked when it is already offered
   * here. Cached for a day; `refresh` asks the providers again.
   */
  async availableModels({ refresh = false } = {}) {
    const [found, models] = await Promise.all([this.discover({ refresh }), this.repos.config.getModels()]);
    const offered = new Map(Object.entries(models).map(([id, m]) => [`${m.provider}:${m.modelId}`, id]));
    return {
      ...found,
      providers: found.providers.map((p) => ({ ...p, models: p.models.map((m) => ({ ...m, offeredAs: offered.get(`${m.provider}:${m.id}`) ?? null })) })),
      tiers: TIERS,
    };
  }

  /**
   * Offers a discovered model to teammates under a tier: a new models.md entry with that tier's rate card (from a
   * model already in the tier, else the defaults) and the model's list price with where it came from. An OpenRouter
   * or unknown price is marked unreviewed, so the screen asks a person to check it. Returns the new model.
   */
  async addModel({ provider, modelId, tier } = {}) {
    const errors = {};
    if (!TIERS.includes(tier)) errors.tier = `Choose one of ${TIERS.join(', ')}`;
    if (!MODEL_ID.test(String(modelId ?? ''))) errors.modelId = 'Letters, digits and . : / @ - _ only';
    if (Object.keys(errors).length) throw invalid(errors);
    const found = (await this.discover()).providers.find((p) => p.id === provider)?.models.find((m) => m.id === modelId);
    if (!found) throw invalid({ modelId: `${provider ?? 'That provider'} does not list "${modelId}" right now. Refresh the list.` });
    const models = await this.repos.config.getModels();
    const existing = Object.entries(models).find(([, m]) => m.provider === provider && m.modelId === modelId);
    if (existing) throw new HttpError(409, 'model_offered', `${found.label} is already offered as "${existing[1].name}".`);
    const template = Object.values(models).find((m) => m.tier === tier) ?? {};
    const defaults = TIER_DEFAULTS[tier];
    let id = keyOf(modelId);
    for (let n = 2; models[id]; n++) id = `${keyOf(modelId)}-${n}`;
    const reviewed = found.priceSource === 'catalogue' || found.priceSource === 'local';
    const entry = {
      name: String(found.label).slice(0, 40),
      tier,
      symbol: template.symbol ?? defaults.symbol,
      description: `${found.providerLabel}. ${found.priceNote}.`.slice(0, 160),
      provider,
      modelId,
      baseRate: template.baseRate ?? defaults.baseRate,
      computePerHour: template.computePerHour ?? defaults.computePerHour,
      toolsPerHour: template.toolsPerHour ?? defaults.toolsPerHour,
      color: template.color ?? defaults.color,
      ...(template.effort ?? defaults.effort ? { effort: template.effort ?? defaults.effort } : {}),
      maxTokens: Math.min(template.maxTokens ?? defaults.maxTokens, found.maxOutput ?? Infinity),
      pricing: { input: 0, output: 0, cacheRead: 0, ...(found.pricing ?? {}) },
      priceSource: found.priceSource ?? 'unknown',
      ...(reviewed ? { pricingReviewedAt: this.today() } : {}),
    };
    await this.repos.config.addModel(id, entry);
    return (await this.models()).find((m) => m.id === id);
  }

  /** Stops offering a model. One a teammate runs on, or that writes memories, stays. */
  async removeModel(id) {
    const models = await this.repos.config.getModels();
    if (!models[id]) throw notFound('Model');
    const using = (await this.repos.teammates.list({ includeRetired: true })).filter((t) => t.model === id);
    if (using.length) throw new HttpError(409, 'model_in_use', `${models[id].name} is what ${using.map((t) => t.name).join(', ')} run${using.length === 1 ? 's' : ''} on. Move ${using.length === 1 ? 'them' : 'them'} to another model first.`);
    if ((await this.repos.config.getReflectionModelId()) === id) throw new HttpError(409, 'model_in_use', `${models[id].name} writes teammates' memories. Choose another model for that first.`);
    await this.repos.config.removeModel(id);
    return { removed: id };
  }

  async updateModel(id, input = {}) {
    const models = await this.repos.config.getModels();
    if (!models[id]) throw notFound('Model');
    const errors = {};
    const patch = {};
    const money = (key, value, max = 100000) => {
      const x = Number(value);
      if (value === '' || value === null || !Number.isFinite(x) || x < 0 || x > max) errors[key] = `Enter a number between 0 and ${max.toLocaleString('en-US')}`;
      return Math.round(x * 10000) / 10000;
    };
    for (const key of ['baseRate', 'computePerHour', 'toolsPerHour']) if (input[key] !== undefined) patch[key] = money(key, input[key]);
    let priceChanged = false;
    if (input.pricing !== undefined) {
      const before = models[id].pricing ?? {};
      patch.pricing = { ...before };
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
        if (input.pricing?.[key] === undefined) continue;
        const x = money(`pricing.${key}`, input.pricing[key], 10000);
        patch.pricing[key] = x;
        if (x !== (before[key] ?? 0)) priceChanged = true;
      }
    }
    if (input.name !== undefined) {
      const s = String(input.name).trim();
      if (!s || s.length > 40) errors.name = 'Use 1 to 40 characters';
      else patch.name = s;
    }
    if (input.description !== undefined) {
      const s = String(input.description).trim();
      if (s.length > 160) errors.description = 'Keep it under 160 characters';
      else patch.description = s;
    }
    if (input.modelId !== undefined) {
      const s = String(input.modelId).trim();
      if (!MODEL_ID.test(s)) errors.modelId = 'Letters, digits and . : / @ - _ only';
      else patch.modelId = s;
    }
    if (Object.keys(errors).length) throw invalid(errors);

    const next = { ...models[id], ...patch };
    const costs = round2((next.computePerHour ?? 0) + (next.toolsPerHour ?? 0));
    if (costs > next.baseRate) throw invalid({ computePerHour: `Compute and tools (${usd(costs)}/hr) can't be more than the base rate (${usd(next.baseRate)}/hr)` });
    // Changing a price, or pressing "Mark reviewed", records today's date as the last review.
    if (priceChanged || input.reviewed === true) patch.pricingReviewedAt = this.today();
    await this.repos.config.updateModel(id, () => patch);
    return (await this.models()).find((m) => m.id === id);
  }

  // ---------- Token view of billing ----------

  async tokens(period = 'month', offset = 0) {
    if (!['week', 'month', 'quarter'].includes(period)) throw badRequest('period must be week, month or quarter');
    const range = periodRange(period, offset, this.today());
    const [teammates, models] = await Promise.all([this.repos.teammates.list({ includeRetired: true }), this.repos.config.getModels()]);
    const entries = await this.team.entriesFor(teammates, range.start, range.end);
    const row = (list) => {
      const s = sumEntries(list);
      const margin = round2(s.amount - s.apiCost);
      return {
        tokens: s.tokens, hours: s.hours, amount: s.amount, apiCost: s.apiCost, margin,
        marginPct: s.amount ? Math.round((margin / s.amount) * 100) : 0,
        apiCostPerMTok: s.tokens ? round2((s.apiCost / s.tokens) * 1e6) : 0,
        billedPerMTok: s.tokens ? round2((s.amount / s.tokens) * 1e6) : 0,
        entries: list.length,
      };
    };
    const byTeammate = teammates
      .map((t) => ({ id: t.id, name: t.name, avatar: t.avatar, model: t.model, modelName: models[t.model]?.name ?? t.model, ...row(entries.filter((e) => e.teammateId === t.id)) }))
      .filter((r) => r.entries)
      .sort((a, b) => b.tokens - a.tokens);
    const byModel = Object.entries(models)
      .map(([id, m]) => ({ id, name: m.name, color: m.color, ...row(entries.filter((e) => e.model === id)) }))
      .filter((r) => r.entries)
      .sort((a, b) => b.tokens - a.tokens);
    const byCostCentre = [...new Set(entries.map((e) => e.costCentre))]
      .map((c) => ({ id: c, name: c, ...row(entries.filter((e) => e.costCentre === c)) }))
      .sort((a, b) => b.tokens - a.tokens);
    const settings = await this.repos.config.getSettings();
    return { range, totals: row(entries), byTeammate, byModel, byCostCentre, tokensPerHour: settings.billing?.tokensPerHour ?? 300000 };
  }
}
