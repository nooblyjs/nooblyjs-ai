// Writes the seed workspace (settings, models, skills, teammates, memory, timesheets, invoices) on first run.
import { SETTINGS, SETTINGS_BODY, MODELS, MODELS_BODY, SKILLS, TEAMMATES, PAST_INVOICES, AUTOMATION, SCHEDULES } from './seed-data.js';
import { defaultInstructions } from '../services/persona.js';
import { addDays, addMonths, isoDate, monthKey, startOfWeek } from '../util/dates.js';
import { round2, slugify } from '../util/ids.js';

function prng(seedText) {
  let a = [...seedText].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const apiCost = (tokens, pricing) => round2((tokens * (0.85 * pricing.input + 0.15 * pricing.output)) / 1e6);

export async function ensureSeeded(store, repos, { today = isoDate(), force = false } = {}) {
  if (!force && (await store.exists(['config', 'settings.md']))) return false;

  await store.writeDoc(['config', 'settings.md'], SETTINGS, SETTINGS_BODY);
  await store.writeDoc(['config', 'models.md'], MODELS, MODELS_BODY);

  const library = new Map();
  for (const s of SKILLS) {
    const id = slugify(s.name);
    library.set(s.name, { id, name: s.name, description: s.description });
    await store.writeDoc(['skills', `${id}.md`], { id, name: s.name, description: s.description, featured: s.featured }, s.instructions);
  }

  const entriesByMonth = new Map();
  for (const seed of TEAMMATES) {
    const id = slugify(seed.name);
    const model = MODELS.models[seed.model];
    const skills = seed.skills.map((s) => ({ ...library.get(s.name), ...(s.description ? { description: s.description } : {}), level: s.level }));
    const teammate = {
      id,
      name: seed.name,
      role: seed.role,
      avatar: seed.avatar,
      status: seed.status,
      currentTask: seed.currentTask,
      model: seed.model,
      rate: seed.rate,
      monthlyCap: seed.monthlyCap,
      costCentre: seed.costCentre,
      memoryMode: 'personal',
      memoryCap: 2000,
      about: seed.about,
      traits: seed.traits,
      approvalThreshold: seed.approvalThreshold,
      reportsTo: SETTINGS.owner.id,
      hiredAt: seed.hiredAt,
      skills,
    };
    await repos.teammates.create({ ...teammate, instructions: defaultInstructions(teammate, SETTINGS.owner.name) });

    for (const m of seed.memory) {
      await repos.memory.add(teammate, { kind: m.kind, text: m.text, learnedAt: `${addDays(today, -m.daysAgo)}T10:00:00Z`, source: 'seed' });
    }

    // Timesheet entries: pinned ones first, then filler tasks spread across the earlier 30 days.
    const rand = prng(seed.name);
    const entries = seed.explicit.map((e) => {
      let date = e.weekday != null ? addDays(startOfWeek(today), e.weekday) : addDays(today, -e.daysAgo);
      if (date > today) date = addDays(date, -7);
      return { date, task: e.task, hours: e.hours, tokens: e.tokens, status: e.status ?? 'approved' };
    });
    let remaining = round2(seed.hours30d - entries.reduce((s, e) => s + e.hours, 0));
    const chunks = [2, 2.5, 3, 3.5, 4, 5, 6];
    const spread = [8, 15, 22, 11, 18, 25, 9, 16, 23, 12, 19, 26, 10, 17, 24, 13, 20, 27, 14, 21, 28, 29];
    for (let i = 0; remaining > 0; i++) {
      const hours = Math.min(remaining, chunks[Math.floor(rand() * chunks.length)]);
      remaining = round2(remaining - hours);
      entries.push({
        date: addDays(today, -spread[i % spread.length]),
        task: seed.tasks[Math.floor(rand() * seed.tasks.length)],
        hours,
        tokens: Math.round((hours * SETTINGS.billing.tokensPerHour * (0.85 + rand() * 0.3)) / 10000) * 10000,
        status: 'approved',
      });
    }
    for (const e of entries.sort((a, b) => a.date.localeCompare(b.date))) {
      const entry = await repos.timesheets.append(id, {
        ...e,
        costCentre: seed.costCentre,
        rate: seed.rate,
        amount: round2(e.hours * seed.rate),
        apiCost: apiCost(e.tokens, model.pricing),
        model: seed.model,
        workId: '',
      });
      const month = monthKey(entry.date);
      entriesByMonth.set(month, round2((entriesByMonth.get(month) ?? 0) + entry.amount));
    }
  }

  for (const [id, patch] of Object.entries(AUTOMATION)) await repos.teammates.update(id, () => patch);
  for (const [i, sc] of SCHEDULES.entries()) {
    await repos.schedules.save({ id: `sch_seed${i + 1}`, teammateId: sc.teammate, name: sc.name, task: sc.task, cadence: sc.cadence, enabled: sc.enabled, nextRunAt: null, createdAt: `${today}T00:00:00Z`, createdBy: SETTINGS.owner.name });
  }

  // Invoices: last month is computed from the seeded timesheets; earlier months are historical.
  const lastMonth = addMonths(today, -1);
  const invoices = [
    { month: monthKey(lastMonth), amount: entriesByMonth.get(monthKey(lastMonth)) ?? 0, status: 'open', dueDate: `${today.slice(0, 7)}-${String(SETTINGS.billing.invoiceDueDay).padStart(2, '0')}` },
    ...PAST_INVOICES.map((p) => ({ month: monthKey(addMonths(today, -p.monthsAgo)), amount: p.amount, status: 'paid' })),
  ];
  let number = 9;
  for (const inv of invoices) {
    await repos.invoices.save({ id: `INV-${String(number--).padStart(4, '0')}`, ...inv });
  }
  return true;
}
