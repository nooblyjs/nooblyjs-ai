// Read models for the four screens plus teammate mutations. All totals are derived from timesheet entries.
import { defaultInstructions } from './persona.js';
import { normalizeProject } from './retrieval.js';
import { HttpError, badRequest, notFound } from '../util/errors.js';
import { addDays, isoDate, isoWeek, longDate, monthName, periodRange, relativeDay, shortDay, startOfWeek } from '../util/dates.js';
import { round1, round2 } from '../util/ids.js';
import { MEMORY_ID } from '../repos/memory.js';
import { DOC_ID } from '../repos/knowledge.js';
import { ENTRY_HEADER, entryRow, toCsv } from '../util/csv.js';

const MAX_DOC_CHARS = 500000;
const docSummary = ({ content, ...meta }) => ({ ...meta, excerpt: content.replace(/^#{1,6}\s+/gm, '').replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) });

export const STATUSES = ['task', 'available', 'paused', 'off'];
export const MEMORY_MODES = ['session', 'personal', 'team'];
const HAIR = ['bob', 'antenna', 'bun', 'quiff', 'crop'];
const HEX = /^#[0-9a-fA-F]{6}$/;

export const sumEntries = (entries) => ({
  hours: round1(entries.reduce((s, e) => s + e.hours, 0)),
  amount: round2(entries.reduce((s, e) => s + e.amount, 0)),
  tokens: entries.reduce((s, e) => s + e.tokens, 0),
  apiCost: round2(entries.reduce((s, e) => s + (e.apiCost || 0), 0)),
});

export const invoiceSummary = (i) => ({
  ...i,
  monthLabel: `${monthName(`${i.month}-01`)} ${i.month.slice(0, 4)}`,
  dueLabel: i.dueDate ? `due ${shortDay(i.dueDate).split(' ').slice(1).join(' ')}` : '',
});

const modelSummary = (models, id) => {
  const m = models[id] ?? { name: id, tier: '', symbol: '', color: '#8F837C' };
  return { id, name: m.name, tier: m.tier, symbol: m.symbol, color: m.color };
};

export class TeamService {
  constructor(repos, { now = () => isoDate(), events = null, tools = null } = {}) {
    this.repos = repos;
    this.today = now;
    this.events = events;
    this.tools = tools;
  }

  publish(type, data) {
    this.events?.publish(type, data);
  }

  async teammateOr404(id) {
    const t = await this.repos.teammates.get(id);
    if (!t) throw notFound('Teammate');
    return t;
  }

  async activeTeammateOr409(id) {
    const t = await this.teammateOr404(id);
    if (t.retiredAt) throw new HttpError(409, 'teammate_retired', `${t.name} is retired. Reinstate them first.`);
    return t;
  }

  async entriesFor(teammates, start, end) {
    const lists = await Promise.all(teammates.map((t) => this.repos.timesheets.listRange(t.id, start, end)));
    return lists.flat();
  }

  async budgetFor(period, offset = 0) {
    const settings = await this.repos.config.getSettings();
    const range = periodRange(period, offset, this.today());
    const teammates = await this.repos.teammates.list({ includeRetired: true });
    const entries = await this.entriesFor(teammates, range.start, range.end);
    const used = sumEntries(entries).amount;
    // Pending (unapproved) time counts towards the budget; it is reported separately so it can be shown as such.
    const pending = sumEntries(entries.filter((e) => e.status === 'pending')).amount;
    const budget = settings.budgets?.[period] ?? 0;
    return { label: range.label, used, pending, budget, pct: budget ? Math.round((used / budget) * 100) : 0, left: round2(Math.max(0, budget - used)) };
  }

  /** Project tags in use anywhere (knowledge documents and memory), for pickers in the UI. */
  async projects() {
    const teammates = await this.repos.teammates.list({ includeRetired: true });
    const lists = await Promise.all([
      this.repos.memory.listTeam(),
      ...teammates.map((t) => this.repos.knowledge.list(t.id)),
      ...teammates.filter((t) => t.memoryMode === 'personal').map((t) => this.repos.memory.list(t)),
    ]);
    return [...new Set(lists.flat().map((x) => x.project).filter(Boolean))].sort();
  }

  async meta() {
    const [settings, models, skills, budget, projects] = await Promise.all([
      this.repos.config.getSettings(),
      this.repos.config.getModels(),
      this.repos.skills.list(),
      this.budgetFor('month'),
      this.projects(),
    ]);
    return {
      projects,
      owner: settings.owner,
      costCentres: settings.costCentres ?? [],
      budgets: settings.budgets ?? {},
      billing: settings.billing ?? {},
      warnAtPct: settings.alerts?.warnAtPct ?? 80,
      models: Object.entries(models).map(([id, m]) => ({
        id, name: m.name, tier: m.tier, symbol: m.symbol, description: m.description, baseRate: m.baseRate, color: m.color, modelId: m.modelId,
      })),
      skills: skills.map(({ id, name, description, featured }) => ({ id, name, description, featured: Boolean(featured) })),
      sidebarBudget: { ...budget, label: `${monthName(this.today())} budget` },
    };
  }

  // ---------- Roster ----------

  async roster() {
    const today = this.today();
    const [teammates, models, monthBudget] = await Promise.all([
      this.repos.teammates.list(),
      this.repos.config.getModels(),
      this.budgetFor('month'),
    ]);
    const start = addDays(today, -29);
    const cards = await Promise.all(
      teammates.map(async (t) => {
        const [entries, memory] = await Promise.all([
          this.repos.timesheets.listRange(t.id, start, today),
          this.repos.memory.list(t),
        ]);
        const billed = sumEntries(entries);
        return {
          id: t.id, name: t.name, role: t.role, avatar: t.avatar, status: t.status, currentTask: t.currentTask,
          skills: (t.skills ?? []).map((s) => s.name),
          model: modelSummary(models, t.model),
          rate: t.rate,
          billed30d: { hours: billed.hours, amount: billed.amount },
          memoryCount: memory.length,
        };
      }),
    );
    const busy = cards.filter((c) => c.status === 'task');
    const billed = cards.reduce((acc, c) => ({ hours: acc.hours + c.billed30d.hours, amount: acc.amount + c.billed30d.amount }), { hours: 0, amount: 0 });
    return {
      teammates: cards,
      summary: {
        total: cards.length,
        onTask: busy.length,
        busyAvatars: busy.map((c) => ({ id: c.id, name: c.name, avatar: c.avatar })),
        billed30d: { amount: round2(billed.amount), hours: round1(billed.hours), teammates: cards.filter((c) => c.billed30d.hours > 0).length },
        budget: { ...monthBudget, label: `${monthName(today)} budget` },
      },
    };
  }

  // ---------- Profile ----------

  async profile(id) {
    const today = this.today();
    const t = await this.teammateOr404(id);
    const [models, settings, memory, knowledge] = await Promise.all([
      this.repos.config.getModels(),
      this.repos.config.getSettings(),
      this.repos.memory.list(t),
      this.repos.knowledge.list(t.id),
    ]);
    const model = models[t.model] ?? {};
    const weekStart = startOfWeek(today);
    const fourWeeksStart = addDays(weekStart, -21);
    const monthStart = `${today.slice(0, 7)}-01`;
    const earliest = [fourWeeksStart, addDays(today, -29), monthStart].sort()[0];
    const entries = await this.repos.timesheets.listRange(t.id, earliest, addDays(weekStart, 6));

    const weekEntries = entries.filter((e) => e.date >= weekStart).sort((a, b) => a.date.localeCompare(b.date));
    const billed30 = sumEntries(entries.filter((e) => e.date >= addDays(today, -29) && e.date <= today));
    const monthBilled = sumEntries(entries.filter((e) => e.date >= monthStart && e.date <= today)).amount;
    const weekly = [3, 2, 1, 0].map((back) => {
      const start = addDays(weekStart, -7 * back);
      return {
        label: `wk ${isoWeek(start)}`,
        amount: sumEntries(entries.filter((e) => e.date >= start && e.date <= addDays(start, 6))).amount,
        current: back === 0,
      };
    });

    const compute = model.computePerHour ?? 0;
    const tools = model.toolsPerHour ?? 0;
    const byKind = { fact: 0, preference: 0, source: 0 };
    for (const m of memory) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;

    return {
      ...t,
      reportsToName: settings.owner?.id === t.reportsTo ? settings.owner.name : t.reportsTo,
      hiredLabel: t.hiredAt ? longDate(t.hiredAt) : '',
      retiredLabel: t.retiredAt ? longDate(t.retiredAt.slice(0, 10)) : '',
      modelInfo: { ...modelSummary(models, t.model), description: model.description, modelId: model.modelId, baseRate: model.baseRate },
      costBreakdown: { compute, tools, margin: round2(t.rate - compute - tools), rate: t.rate },
      memory: {
        count: memory.length,
        cap: t.memoryCap,
        mode: t.memoryMode,
        byKind,
        pinned: memory.filter((m) => m.pinned).length,
        recent: memory.slice(0, 4).map((m) => ({ ...m, learned: relativeDay(m.learnedAt, today) })),
      },
      knowledge: knowledge.map(docSummary),
      timesheet: {
        entries: weekEntries.map((e) => ({ ...e, day: shortDay(e.date) })),
        totals: sumEntries(weekEntries),
      },
      billed30d: billed30,
      monthBilled,
      weekly,
    };
  }

  async memory(id) {
    const t = await this.teammateOr404(id);
    const today = this.today();
    return (await this.repos.memory.list(t)).map((m) => ({ ...m, learned: relativeDay(m.learnedAt, today) }));
  }

  async deleteMemory(id, memoryId) {
    const t = await this.activeTeammateOr409(id);
    if (!MEMORY_ID.test(memoryId)) throw badRequest('Invalid memory id');
    await this.repos.memory.remove(t, memoryId);
  }

  async pinMemory(id, memoryId, pinned) {
    const t = await this.activeTeammateOr409(id);
    if (!MEMORY_ID.test(memoryId)) throw badRequest('Invalid memory id');
    if (typeof pinned !== 'boolean') throw badRequest('pinned must be true or false');
    const item = await this.repos.memory.setPinned(t, memoryId, pinned);
    if (!item) throw notFound('Memory item');
    return item;
  }

  /** Shared team memory with the name of the teammate who contributed each item. */
  async teamMemory() {
    const today = this.today();
    const [items, teammates] = await Promise.all([this.repos.memory.listTeam(), this.repos.teammates.list({ includeRetired: true })]);
    const byId = new Map(teammates.map((t) => [t.id, t]));
    return {
      items: items.map((m) => ({ ...m, learned: relativeDay(m.learnedAt, today), contributor: byId.get(m.teammateId)?.name ?? m.teammateId, contributorAvatar: byId.get(m.teammateId)?.avatar })),
      members: teammates.filter((t) => t.memoryMode === 'team' && !t.retiredAt).map((t) => ({ id: t.id, name: t.name, avatar: t.avatar })),
    };
  }

  async pinTeamMemory(memoryId, pinned) {
    if (!MEMORY_ID.test(memoryId)) throw badRequest('Invalid memory id');
    if (typeof pinned !== 'boolean') throw badRequest('pinned must be true or false');
    const item = await this.repos.memory.setTeamPinned(memoryId, pinned);
    if (!item) throw notFound('Memory item');
    return item;
  }

  async deleteTeamMemory(memoryId) {
    if (!MEMORY_ID.test(memoryId)) throw badRequest('Invalid memory id');
    await this.repos.memory.removeTeam(memoryId);
  }

  // ---------- Knowledge ----------

  validateDoc(input, { partial = false } = {}) {
    const out = {};
    const errors = {};
    if (input.filename !== undefined && input.filename !== null && input.filename !== '') {
      const name = String(input.filename).split(/[\\/]/).pop();
      if (!/\.(md|markdown|txt)$/i.test(name)) errors.filename = 'Only .md and .txt files can be uploaded';
      else out.filename = name.slice(0, 120);
    }
    if (input.title !== undefined || !partial) {
      const fallback = out.filename?.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ');
      const title = String(input.title ?? '').trim() || (partial ? '' : fallback ?? '');
      if (!title) errors.title = 'Give the document a title';
      else if (title.length > 120) errors.title = 'Keep the title under 120 characters';
      else out.title = title;
    }
    if (input.content !== undefined || !partial) {
      const content = String(input.content ?? '').replace(/\r\n/g, '\n').trim();
      if (!content) errors.content = 'The document is empty';
      else if (content.length > MAX_DOC_CHARS) errors.content = `Documents can be up to ${MAX_DOC_CHARS.toLocaleString('en-US')} characters`;
      else out.content = content;
    }
    if (input.project !== undefined) {
      try {
        out.project = normalizeProject(input.project) ?? '';
      } catch (err) {
        errors.project = err.details?.project ?? err.message;
      }
    }
    if (Object.keys(errors).length) throw new HttpError(422, 'validation_failed', 'Please fix the highlighted fields', errors);
    return out;
  }

  async knowledge(id) {
    await this.teammateOr404(id);
    return (await this.repos.knowledge.list(id)).map(docSummary);
  }

  async knowledgeDoc(id, docId) {
    await this.teammateOr404(id);
    const doc = await this.repos.knowledge.get(id, docId);
    if (!doc) throw notFound('Document');
    return doc;
  }

  async addKnowledge(id, input) {
    await this.activeTeammateOr409(id);
    return this.repos.knowledge.create(id, this.validateDoc(input));
  }

  async updateKnowledge(id, docId, input) {
    await this.activeTeammateOr409(id);
    if (!DOC_ID.test(docId)) throw notFound('Document');
    const doc = await this.repos.knowledge.update(id, docId, this.validateDoc(input, { partial: true }));
    if (!doc) throw notFound('Document');
    return doc;
  }

  async removeKnowledge(id, docId) {
    await this.activeTeammateOr409(id);
    if (!DOC_ID.test(docId)) throw notFound('Document');
    const doc = await this.repos.knowledge.get(id, docId);
    if (!doc) throw notFound('Document');
    await this.repos.knowledge.remove(id, docId);
    return doc;
  }

  async resetMemory(id) {
    const t = await this.activeTeammateOr409(id);
    await this.repos.memory.reset(t);
  }

  // ---------- Billing ----------

  async billing(period = 'month', offset = 0) {
    if (!['week', 'month', 'quarter'].includes(period)) throw badRequest('period must be week, month or quarter');
    const range = periodRange(period, offset, this.today());
    const [teammates, models, settings, invoices] = await Promise.all([
      this.repos.teammates.list({ includeRetired: true }),
      this.repos.config.getModels(),
      this.repos.config.getSettings(),
      this.repos.invoices.list(),
    ]);
    const byId = new Map(teammates.map((t) => [t.id, t]));
    const entries = await this.entriesFor(teammates, range.start, range.end);
    const totals = sumEntries(entries);
    const pending = sumEntries(entries.filter((e) => e.status === 'pending')).amount;
    const budget = settings.budgets?.[period] ?? 0;

    const byModel = Object.keys(models)
      .map((id) => ({ ...modelSummary(models, id), amount: sumEntries(entries.filter((e) => e.model === id)).amount }))
      .sort((a, b) => b.amount - a.amount);

    const byTeammate = teammates
      .map((t) => {
        const s = sumEntries(entries.filter((e) => e.teammateId === t.id));
        return {
          id: t.id, name: t.name, avatar: t.avatar, hours: s.hours, amount: s.amount,
          rate: s.hours ? round2(s.amount / s.hours) : t.rate,
          model: modelSummary(models, t.model),
        };
      })
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const review = entries
      .map((e) => ({ ...e, teammateName: byId.get(e.teammateId)?.name ?? e.teammateId }))
      .sort((a, b) => (a.status === b.status ? b.date.localeCompare(a.date) : a.status === 'pending' ? -1 : 1));

    return {
      range,
      totals: { ...totals, teammates: byTeammate.length },
      budget: { amount: budget, used: totals.amount, pending, warnAtPct: settings.alerts?.warnAtPct ?? 80, pct: budget ? Math.round((totals.amount / budget) * 100) : 0, left: round2(Math.max(0, budget - totals.amount)) },
      byModel,
      byTeammate,
      invoices: invoices.map(invoiceSummary),
      review: { entries: review.slice(0, 50), pendingCount: review.filter((e) => e.status === 'pending').length, total: review.length },
    };
  }

  async exportCsv(period = 'month', offset = 0) {
    const range = periodRange(period, offset, this.today());
    const teammates = await this.repos.teammates.list({ includeRetired: true });
    const names = new Map(teammates.map((t) => [t.id, t.name]));
    const entries = (await this.entriesFor(teammates, range.start, range.end)).sort((a, b) => a.date.localeCompare(b.date));
    const rows = entries.map((e) => entryRow(e, names.get(e.teammateId) ?? e.teammateId));
    return { filename: `timesheets-${range.start}-to-${range.end}.csv`, csv: toCsv([ENTRY_HEADER, ...rows]) };
  }

  async approve(teammateId, entryId) {
    await this.teammateOr404(teammateId);
    if (!/^ts_[\w]+$/.test(entryId)) throw badRequest('Invalid timesheet entry id');
    const entry = await this.repos.timesheets.approve(teammateId, entryId);
    if (!entry) throw notFound('Timesheet entry');
    this.publish('timesheet', { teammateId, entryId, status: 'approved' });
    return entry;
  }

  // ---------- Work timeline ----------

  /**
   * Everything teammates did in the last `days`, newest first: work items with their caller, tools and delegations
   * (linked both ways, with the cost of each side), tasks waiting for approval, and the next scheduled runs.
   */
  async timeline({ teammate = null, days = 14 } = {}) {
    const span = Math.max(1, Math.min(90, Number(days) || 14));
    const from = addDays(this.today(), -(span - 1));
    const all = await this.repos.teammates.list({ includeRetired: true });
    const byId = new Map(all.map((t) => [t.id, t]));
    if (teammate && !byId.has(teammate)) throw notFound('Teammate');
    const who = (id) => ({ id, name: byId.get(id)?.name ?? id, avatar: byId.get(id)?.avatar, role: byId.get(id)?.role });

    const lists = await Promise.all(all.map((t) => this.repos.work.list(t.id, { from })));
    const work = lists.flat();
    const index = new Map(work.map((w) => [w.id, w]));
    // A delegated item stays visible next to its parent even when filtering by teammate.
    const related = (w) => !teammate || w.teammateId === teammate || w.delegatedFrom?.teammateId === teammate || (w.delegations ?? []).some((d) => d.teammateId === teammate);
    const items = work.filter(related).map((w) => {
      const delegations = (w.delegations ?? []).map((d) => ({ ...d, teammate: who(d.teammateId), amount: d.amount ?? index.get(d.workId)?.amount }));
      const delegatedAmount = round2(delegations.reduce((sum, d) => sum + (d.amount ?? 0), 0));
      return {
        workId: w.id, teammate: who(w.teammateId), title: w.title, status: w.status, startedAt: w.startedAt, durationMs: w.durationMs,
        hours: w.hours ?? 0, amount: w.amount ?? 0, tokens: w.tokens ?? 0, apiCost: w.apiCost ?? 0, caller: w.caller, project: w.project,
        schedule: w.schedule, approvedBy: w.approvedBy, error: w.error,
        delegatedFrom: w.delegatedFrom ? { ...w.delegatedFrom, teammate: who(w.delegatedFrom.teammateId), title: index.get(w.delegatedFrom.workId)?.title } : null,
        delegations, totalAmount: round2((w.amount ?? 0) + delegatedAmount),
        tools: (w.toolCalls ?? []).map((c) => ({ name: c.name, label: c.label, status: c.status })),
      };
    });

    const approvals = (await this.repos.approvals.list({ status: 'pending' })).filter((a) => !teammate || a.teammateId === teammate);
    const schedules = (await this.repos.schedules.list()).filter((sc) => sc.enabled !== false && sc.nextRunAt && (!teammate || sc.teammateId === teammate));
    const totals = items.reduce((acc, i) => ({ tasks: acc.tasks + 1, amount: round2(acc.amount + i.amount), hours: round1(acc.hours + i.hours), delegations: acc.delegations + i.delegations.length, toolCalls: acc.toolCalls + i.tools.length }), { tasks: 0, amount: 0, hours: 0, delegations: 0, toolCalls: 0 });
    return {
      from, to: this.today(), days: span, teammate: teammate ? who(teammate) : null,
      teammates: all.filter((t) => !t.retiredAt).map((t) => ({ id: t.id, name: t.name })),
      totals,
      items: items.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      waiting: approvals.map((a) => ({ id: a.id, kind: a.kind ?? 'task', teammate: who(a.teammateId), title: (a.task ?? '').split('\n')[0].slice(0, 120), label: a.label, requestedAt: a.requestedAt, estimate: a.estimate, workId: a.workId })),
      upcoming: schedules.slice(0, 10).map((sc) => ({ id: sc.id, name: sc.name, teammate: who(sc.teammateId), nextRunAt: sc.nextRunAt })),
    };
  }

  // ---------- Hire & configure ----------

  async validateConfig(input, { partial = false, id = null } = {}) {
    const [models, settings] = await Promise.all([this.repos.config.getModels(), this.repos.config.getSettings()]);
    const out = {};
    const errors = {};
    const str = (key, max, required) => {
      if (input[key] === undefined) {
        if (required && !partial) errors[key] = 'Required';
        return;
      }
      const v = String(input[key]).trim();
      if (required && !v) errors[key] = 'Required';
      else if (v.length > max) errors[key] = `Keep it under ${max} characters`;
      else out[key] = v;
    };
    const num = (key, min, max, required) => {
      if (input[key] === undefined || input[key] === '') {
        if (required && !partial) errors[key] = 'Required';
        return;
      }
      const v = Number(input[key]);
      if (!Number.isFinite(v) || v < min || v > max) errors[key] = `Enter a number between ${min} and ${max}`;
      else out[key] = round2(v);
    };

    str('name', 60, true);
    str('role', 80, true);
    str('currentTask', 120);
    str('about', 2000);
    str('instructions', 20000);
    num('rate', 0, 10000, true);
    num('monthlyCap', 0, 1000000, true);
    num('memoryCap', 0, 100000);
    if (input.approvalThreshold === null || input.approvalThreshold === '') out.approvalThreshold = undefined; // clears it
    else num('approvalThreshold', 0, 1000000);
    if (input.model !== undefined) {
      if (!models[input.model]) errors.model = 'Unknown model';
      else out.model = input.model;
    } else if (!partial) errors.model = 'Required';
    if (input.status !== undefined) {
      if (!STATUSES.includes(input.status)) errors.status = 'Unknown status';
      else out.status = input.status;
    }
    if (input.memoryMode !== undefined) {
      if (!MEMORY_MODES.includes(input.memoryMode)) errors.memoryMode = 'Unknown memory mode';
      else out.memoryMode = input.memoryMode;
    }
    if (input.costCentre !== undefined) {
      if (!(settings.costCentres ?? []).includes(input.costCentre)) errors.costCentre = 'Unknown cost centre';
      else out.costCentre = input.costCentre;
    }
    if (input.traits !== undefined) {
      if (!Array.isArray(input.traits) || input.traits.length > 12) errors.traits = 'Up to 12 traits';
      else out.traits = input.traits.map((t) => String(t).trim().slice(0, 80)).filter(Boolean);
    }
    if (input.avatar !== undefined) {
      const a = input.avatar ?? {};
      if (a.type === 'generated' && HEX.test(a.bg) && HEX.test(a.deep) && HAIR.includes(a.hair)) {
        out.avatar = { type: 'generated', bg: a.bg, deep: a.deep, hair: a.hair };
      } else if (a.type === 'upload' && /^\/uploads\/[\w-]+\.(png|jpe?g|webp)$/.test(a.url ?? '')) {
        out.avatar = { type: 'upload', url: a.url, bg: HEX.test(a.bg) ? a.bg : '#F5F1EE' };
      } else errors.avatar = 'Invalid avatar';
    }
    if (input.tools !== undefined) {
      const known = (await this.tools?.knownToolIds()) ?? new Set();
      if (!Array.isArray(input.tools) || input.tools.some((t) => !known.has(t))) errors.tools = 'Unknown tool';
      else out.tools = [...new Set(input.tools)];
    }
    if (input.delegatesTo !== undefined) {
      const active = new Set((await this.repos.teammates.list()).map((t) => t.id));
      if (!Array.isArray(input.delegatesTo) || input.delegatesTo.some((t) => !active.has(t) || t === id)) errors.delegatesTo = 'Choose other active teammates';
      else out.delegatesTo = [...new Set(input.delegatesTo)];
    }
    if (Object.keys(errors).length) throw new HttpError(422, 'validation_failed', 'Please fix the highlighted fields', errors);
    return out;
  }

  async hire(input) {
    const settings = await this.repos.config.getSettings();
    const config = await this.validateConfig({ memoryMode: 'personal', ...input });
    const library = new Map((await this.repos.skills.list()).map((s) => [s.id, s]));
    const skillIds = Array.isArray(input.skills) ? input.skills : [];
    const skills = skillIds.filter((id) => library.has(id)).map((id) => ({ id, name: library.get(id).name, description: library.get(id).description, level: 2 }));
    const teammate = {
      id: await this.repos.teammates.uniqueId(config.name),
      name: config.name,
      role: config.role,
      avatar: config.avatar ?? { type: 'generated', bg: '#CDE7E4', deep: '#1E5E63', hair: 'crop' },
      status: 'available',
      currentTask: 'Ready for work',
      model: config.model,
      rate: config.rate,
      monthlyCap: config.monthlyCap,
      costCentre: config.costCentre ?? settings.costCentres?.[0],
      memoryMode: config.memoryMode,
      memoryCap: config.memoryCap ?? 2000,
      about: config.about ?? `${config.name} is a new ${config.role} on the team.`,
      traits: config.traits ?? [],
      reportsTo: settings.owner?.id,
      hiredAt: this.today(),
      skills,
    };
    return this.repos.teammates.create({ ...teammate, instructions: defaultInstructions(teammate, settings.owner?.name) });
  }

  async update(id, input) {
    await this.activeTeammateOr409(id);
    const patch = await this.validateConfig(input, { partial: true, id });
    if (patch.status === 'available' && input.currentTask === undefined) patch.currentTask = 'Ready for work';
    if (patch.status === 'paused' && input.currentTask === undefined) patch.currentTask = 'Paused';
    if (patch.status === 'off' && input.currentTask === undefined) patch.currentTask = 'Off shift';
    const updated = await this.repos.teammates.update(id, () => patch);
    this.publish('teammate', { id, status: updated.status, currentTask: updated.currentTask });
    return updated;
  }

  /** Replace the persona instructions with the generated default for the teammate's current profile. */
  async resetPersona(id) {
    await this.activeTeammateOr409(id);
    const settings = await this.repos.config.getSettings();
    return this.repos.teammates.update(id, (t) => ({ instructions: defaultInstructions(t, settings.owner?.name) }));
  }

  /** Retiring keeps the folder (and so the billing history) but hides the teammate from the roster. */
  async retire(id) {
    const t = await this.activeTeammateOr409(id);
    const updated = await this.repos.teammates.update(id, () => ({ retiredAt: new Date().toISOString(), status: 'off', currentTask: 'Retired' }));
    this.publish('teammate', { id, status: 'off', currentTask: 'Retired', retired: true, name: t.name });
    return updated;
  }

  async reinstate(id) {
    const t = await this.teammateOr404(id);
    if (!t.retiredAt) return t;
    const updated = await this.repos.teammates.update(id, () => ({ retiredAt: undefined, status: 'available', currentTask: 'Ready for work' }));
    this.publish('teammate', { id, status: 'available', currentTask: 'Ready for work' });
    return updated;
  }

  async setSkillLevel(id, skillId, level) {
    await this.activeTeammateOr409(id);
    const lvl = Number(level);
    if (![1, 2, 3].includes(lvl)) throw badRequest('level must be 1, 2 or 3');
    const t = await this.repos.teammates.get(id);
    if (!(t.skills ?? []).some((s) => s.id === skillId)) throw notFound('Skill on this teammate');
    return this.repos.teammates.update(id, (cur) => ({ skills: cur.skills.map((s) => (s.id === skillId ? { ...s, level: lvl } : s)) }));
  }

  /** A library skill plus the teammates (active ones) who use it. */
  async skill(skillId) {
    const skill = await this.repos.skills.get(skillId);
    if (!skill) throw notFound('Skill');
    const teammates = await this.repos.teammates.list();
    const usedBy = teammates.filter((t) => (t.skills ?? []).some((s) => s.id === skill.id)).map((t) => ({ id: t.id, name: t.name }));
    return { ...skill, usedBy };
  }

  /** Edit a library skill; the description is copied onto every teammate that uses it. */
  async updateSkill(skillId, { description, instructions }) {
    const patch = {};
    if (description !== undefined) patch.description = String(description).trim().slice(0, 160);
    if (instructions !== undefined) patch.instructions = String(instructions).slice(0, 20000);
    const skill = await this.repos.skills.update(skillId, patch);
    if (!skill) throw notFound('Skill');
    if (patch.description !== undefined) {
      const teammates = await this.repos.teammates.list({ includeRetired: true });
      for (const t of teammates.filter((tm) => (tm.skills ?? []).some((s) => s.id === skill.id))) {
        await this.repos.teammates.update(t.id, (cur) => ({ skills: cur.skills.map((s) => (s.id === skill.id ? { ...s, description: skill.description } : s)) }));
      }
    }
    return this.skill(skill.id);
  }

  async addSkill(id, { skillId, name, description, level = 1 }) {
    await this.activeTeammateOr409(id);
    const lvl = Number(level);
    if (![1, 2, 3].includes(lvl)) throw badRequest('level must be 1, 2 or 3');
    let skill = skillId ? await this.repos.skills.get(skillId) : null;
    if (!skill) {
      if (!name?.trim()) throw badRequest('Choose a skill from the library or give a new skill a name');
      skill = await this.repos.skills.create({ name: name.trim().slice(0, 60), description: String(description ?? '').trim().slice(0, 160) });
    }
    return this.repos.teammates.update(id, (t) => {
      const others = (t.skills ?? []).filter((s) => s.id !== skill.id);
      return { skills: [...others, { id: skill.id, name: skill.name, description: skill.description, level: lvl }] };
    });
  }

  async removeSkill(id, skillId) {
    await this.activeTeammateOr409(id);
    return this.repos.teammates.update(id, (t) => ({ skills: (t.skills ?? []).filter((s) => s.id !== skillId) }));
  }

  /** Skill pack upload: a Markdown file with optional front matter (name, description) and instructions body. */
  async createSkill({ name, description, instructions }) {
    if (!name?.trim()) throw badRequest('Skill name is required');
    return this.repos.skills.create({
      name: name.trim().slice(0, 60),
      description: String(description ?? '').trim().slice(0, 160),
      instructions: String(instructions ?? '').slice(0, 20000),
    });
  }
}
