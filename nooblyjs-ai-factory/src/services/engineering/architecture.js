// @ts-check
// Phase 16d: THE APPLICATION ARCHITECTURE of each story, per impacted system, drawn from the code (root product.md
// §3.2b). An agent reads the repository at the head of its main branch (repo-reader.js) and drafts the application flow,
// the objects, the NFRs per component and the changes (code-map.js); a person edits and accepts it; it goes stale when
// the main branch moves past the commit it was read at. Before the Engineering sign-off every system's must be accepted
// and current (facts()).
//
// One file per story, data/factory/engineering/architecture/<storyId>.md, readable as Markdown. The story, its systems,
// criteria, interfaces, technical requirements and NFRs are the Design section's (host.service('design')); the story's
// stage is the lifecycle engine's.
import { createRequire } from 'node:module';
import { createRepoReaders, readSources } from './repo-reader.js';
import { mapModules, draftArchitecture } from './code-map.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

const STORY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const USUAL = { id: 'rhea-voss', name: 'Rhea Voss' };
const WORK_TYPE = 'application-architecture';
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const lines = (list, max = 40) => (Array.isArray(list) ? list : []).map((x) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 600)).filter(Boolean).slice(0, max);

/** The body of the file: what its front matter says, as headings and lists. */
function render(doc) {
  return doc.systems.map((s) => [
    `## ${s.name} (${s.status})`,
    ...(s.flow ?? []).map((f, i) => `${i + 1}. ${f}`),
    ...(s.changes ?? []).map((c) => `- ${c.kind} ${c.path}: ${c.what}`),
  ].join('\n')).join('\n\n');
}

/**
 * @param {{ home: string, env: NodeJS.ProcessEnv, host: any, log?: any }} options
 */
export function createArchitecture({ home, env, host, log }) {
  const store = new FsStore(home);
  const file = (id) => ['engineering', 'architecture', `${id}.md`];
  const readers = createRepoReaders({ env, host });
  const now = () => new Date(Number(host.clock?.now?.() ?? Date.now())).toISOString();
  const emit = (type, payload, actor) => host.events?.emit?.(type, { system: 'factory', ...payload }, { actor: actor?.id ?? null });
  const by = (actor) => ({ id: actor.id, name: actor.name ?? actor.id, kind: actor.kind === 'agent' ? 'agent' : 'person' });

  async function get(storyId) {
    if (!STORY.test(storyId ?? '')) return null;
    const doc = await store.readDoc(file(storyId)).catch(() => null);
    return doc?.data?.storyId ? { ...doc.data, systems: doc.data.systems ?? [] } : null;
  }
  async function save(doc) {
    await store.writeDoc(file(doc.storyId), doc, `\n${render(doc)}\n`);
    return doc;
  }

  /** The story as Design wrote it, and where the lifecycle has it: what the architecture is drawn for. */
  async function storyOf(storyId) {
    const item = await host.service?.('workflows')?.item?.({ itemId: storyId });
    if (!item) throw fail(404, 'not_found', `There is no story ${storyId}.`);
    const design = item.parentId ? await host.service?.('design')?.designFor?.(item.parentId) : null;
    const story = design?.stories?.find((s) => s.id === storyId) ?? null;
    const pick = (list, ids) => (list ?? []).filter((x) => (ids ?? []).includes(x.id));
    return {
      item, design, story,
      title: story?.title ?? item.title,
      systems: (story?.systems ?? []).map((name) => ({ name, repo: design.systems.find((s) => s.name === name)?.repo ?? name, change: design.systems.find((s) => s.name === name)?.change ?? 'changed' })),
      criteria: story?.criteria ?? [],
      interfaces: pick(design?.interfaces, story?.interfaces),
      technical: pick(design?.technical, story?.technical),
      nfrs: pick(design?.nfrs, story?.nfrs),
    };
  }

  /** Whether a system's architecture still matches its repository: stale, current, or unknown (with why). */
  async function currency(entry) {
    if (!entry?.readAt?.commit) return { stale: null, text: entry?.readAt?.source === 'design' ? 'Drawn from the design, not from the code' : 'Not read from the code' };
    const reader = await readers(entry.repo ?? entry.name).catch(() => null);
    if (!reader) return { stale: null, text: `${entry.name} can't be read here, so it can't be checked against the code` };
    if (!(await reader.hasCommit(entry.readAt.commit))) return { stale: null, text: `Read at ${entry.readAt.commit.slice(0, 7)}, which isn't in this repository: a sample, or another copy of it` };
    const head = await reader.head();
    if (head && !head.startsWith(entry.readAt.commit)) return { stale: true, head, text: `Stale: ${reader.branch} is at ${head.slice(0, 7)}, and this was read at ${entry.readAt.commit.slice(0, 7)}` };
    return { stale: false, head, text: `Current with ${reader.branch} at ${entry.readAt.commit.slice(0, 7)}` };
  }

  /** One story's architecture, every impacted system in it (drafted or not), each with its currency. */
  async function view(storyId) {
    const ctx = await storyOf(storyId);
    const doc = (await get(storyId)) ?? { storyId, itemId: ctx.item.parentId ?? null, title: ctx.title, systems: [] };
    const names = [...new Set([...ctx.systems.map((s) => s.name), ...doc.systems.map((s) => s.name)])];
    const systems = [];
    for (const name of names) {
      const entry = doc.systems.find((s) => s.name === name);
      const sys = ctx.systems.find((s) => s.name === name);
      if (!entry) { systems.push({ name, repo: sys?.repo ?? name, status: 'none', statusText: 'Not drafted yet', currency: { stale: null, text: 'Not drafted yet' } }); continue; }
      const c = await currency(entry);
      systems.push({ ...entry, currency: c, statusText: c.stale ? 'Stale: draft it again' : entry.status === 'accepted' ? `Accepted by ${entry.acceptedBy?.name ?? 'a person'}` : 'Proposed: an Application Architect accepts it' });
    }
    const accepted = systems.filter((s) => s.status === 'accepted' && !s.currency.stale).length;
    return {
      storyId, itemId: doc.itemId ?? ctx.item.parentId ?? null, title: ctx.title, stage: ctx.item.stage, status: ctx.item.status,
      writable: ctx.item.status === 'active' && ctx.item.stage === 'engineer',
      systems, summary: { systems: systems.length, accepted, text: `${accepted} of ${systems.length} system${systems.length === 1 ? '' : 's'} accepted${systems.some((s) => s.currency.stale) ? ` · ${systems.filter((s) => s.currency.stale).length} stale` : ''}` },
      sample: doc.sampleData === true,
      href: `/home/lifecycle/${encodeURIComponent(storyId)}`,
      designHref: ctx.item.parentId ? `/design/stories/${encodeURIComponent(ctx.item.parentId)}` : null,
    };
  }

  async function writableStory(storyId) {
    const ctx = await storyOf(storyId);
    if (ctx.item.status !== 'active' || ctx.item.stage !== 'engineer') throw fail(409, 'wrong_stage', `${storyId} is ${ctx.item.status !== 'active' ? ctx.item.status : `in ${ctx.item.stage}`}: its application architecture is worked out in Engineer.`);
    return ctx;
  }
  async function peopleOnly(actor, what) {
    if (actor?.kind !== 'agent') return;
    await host.audit?.record?.({ actor: actor.id, action: 'access.refused', target: what, reason: `agents propose, people decide: an agent can't ${what}` });
    throw fail(403, 'people_only', `Agents propose and people decide: ${actor.name ?? actor.id} can't ${what}.`);
  }

  /** The teammate who drafts: Rhea Voss when hired, else the only hired one; the usual name when Teammates isn't here. */
  async function drafter() {
    const t = host.service?.('teammates');
    if (typeof t?.roster !== 'function') return { teammate: { ...USUAL, kind: 'agent' }, standalone: true };
    const roster = (await t.roster().catch(() => [])) ?? [];
    const pick = roster.find((a) => a.id === USUAL.id) ?? (roster.length === 1 ? roster[0] : null);
    if (!pick) throw fail(409, 'no_teammate', `${USUAL.name} drafts application architecture and isn't hired here. Hire them in Teammates, or write it yourself.`);
    return { teammate: { id: pick.id, name: pick.name ?? pick.id, kind: 'agent' }, standalone: false };
  }

  /**
   * An agent drafts one system's architecture from its repository at the head of main (or from the design alone when
   * the repository can't be read here). Platform checks the agent may read the repository; a draft replaces a proposed
   * or stale one and is proposed again.
   */
  async function draft(storyId, name, actor) {
    const ctx = await writableStory(storyId);
    const sys = ctx.systems.find((s) => s.name === name);
    if (!sys) throw fail(404, 'not_found', `${name} is not one of ${storyId}'s impacted systems (${ctx.systems.map((s) => s.name).join(', ') || 'none'}).`);
    const reader = sys.change === 'new' ? null : await readers(sys.repo).catch(() => null);
    let modules = null;
    let files = [];
    let readAt = { branch: null, commit: null, source: 'design' };
    if (reader) {
      const platform = host.service?.('platform');
      if (typeof host.service?.('teammates')?.runTask !== 'function' && platform?.checkAgentWork) {
        const check = await platform.checkAgentWork({ system: 'factory', workType: WORK_TYPE, repo: sys.repo, needs: 'read', teammateId: USUAL.id, itemId: storyId });
        if (!check.ok) throw fail(403, check.code ?? 'repository_refused', check.message);
      }
      const read = await readSources(reader);
      modules = mapModules(read.sources);
      files = read.files;
      readAt = { branch: reader.branch, commit: await reader.head(), source: reader.source };
    }
    const unread = sys.change === 'new' ? `${name} is a new system, so there is no code to read yet` : `${name} can't be read here (no folder in repos.yaml, and the devtools service doesn't see it)`;
    const scripted = draftArchitecture({ story: { id: storyId, title: ctx.title, criteria: ctx.criteria }, system: sys, interfaces: ctx.interfaces, technical: ctx.technical, nfrs: ctx.nfrs, modules, files, unread });
    const { teammate, standalone } = await drafter();
    let output = scripted;
    let costUsd = 0;
    let modelRoute = 'mock';
    if (!standalone) {
      const task = await host.service('teammates').runTask({
        slug: teammate.id, workType: WORK_TYPE, itemId: storyId, system: 'factory', ...(reader ? { repo: sys.repo } : {}),
        caller: actor?.id ? { type: 'user', id: actor.id, name: actor.name ?? actor.id } : null,
        input: { task: `Draft the application architecture of ${name} for ${storyId} (${ctx.title}) from its code: the application flow, the objects it touches, the NFRs per component and the changes. Answer as JSON { "flow", "objects", "nfrs", "changes" }.`, context: JSON.stringify({ story: ctx.story, modules, interfaces: ctx.interfaces, nfrs: ctx.nfrs }).slice(0, 20_000) },
        scripted: async () => ({ output: scripted, costUsd: 0 }),
      });
      if (!task.scripted) {
        try {
          const parsed = typeof task.output === 'object' ? task.output : JSON.parse(String(task.output).replace(/^[\s\S]*?```(?:json)?\s*|```[\s\S]*$/g, ''));
          if (Array.isArray(parsed?.flow)) output = { ...scripted, ...parsed, modules: scripted.modules };
        } catch { log?.warn?.(`engineering: ${teammate.name}'s draft for ${storyId}/${name} wasn't JSON; the scripted draft is used`); }
      }
      costUsd = Number(task.costUsd) || 0;
      modelRoute = task.modelRoute ?? WORK_TYPE;
    } else if (process.env.NODE_ENV === 'production') {
      throw fail(503, 'teammates_unavailable', 'Digital Teammates is not running here, so no agent can draft.');
    }
    const doc = (await get(storyId)) ?? { storyId, itemId: ctx.item.parentId ?? null, title: ctx.title, systems: [] };
    const entry = {
      name, repo: sys.repo, status: 'proposed', readAt,
      flow: lines(output.flow), objects: output.objects ?? [], nfrs: output.nfrs ?? [], changes: output.changes ?? [], modules: output.modules ?? [],
      draftedBy: teammate, draftedAt: now(), costUsd, modelRoute, askedBy: actor?.id ?? null,
    };
    doc.systems = [...doc.systems.filter((s) => s.name !== name), entry];
    doc.title = ctx.title;
    delete doc.sampleData;
    await save(doc);
    await emit('engineering.architecture_drafted', { itemId: storyId, storyId, systemName: name, source: readAt.source, commit: readAt.commit, teammateId: teammate.id, summary: `${teammate.name} drafted ${name}'s application architecture for ${storyId}${readAt.commit ? ` from ${readAt.branch} at ${readAt.commit.slice(0, 7)}` : ' from the design'}` }, teammate);
    await emit('agent.action', { actor: teammate.id, teammateId: teammate.id, itemId: storyId, system: 'factory', modelRoute, costUsd, at: now(), action: 'engineering.architecture' }, teammate);
    return view(storyId);
  }

  /** A person edits a system's flow, objects, NFRs or changes; an accepted one is proposed again. */
  async function edit(storyId, name, body, actor) {
    await writableStory(storyId);
    const doc = await get(storyId);
    const entry = doc?.systems.find((s) => s.name === name);
    if (!entry) throw fail(404, 'not_found', `${name}'s architecture for ${storyId} isn't drafted yet.`);
    if ('flow' in (body ?? {})) entry.flow = lines(body.flow);
    if (Array.isArray(body?.objects)) entry.objects = body.objects.slice(0, 40).map((o) => ({ name: String(o?.name ?? '').slice(0, 80), kind: String(o?.kind ?? 'value').slice(0, 20), fields: lines(o?.fields, 30), note: String(o?.note ?? '').slice(0, 300) })).filter((o) => o.name);
    if (Array.isArray(body?.changes)) entry.changes = body.changes.slice(0, 40).map((c) => ({ kind: ['new', 'changed', 'uses'].includes(c?.kind) ? c.kind : 'changed', path: String(c?.path ?? '').slice(0, 200), what: String(c?.what ?? '').slice(0, 300) })).filter((c) => c.path);
    if (Array.isArray(body?.nfrs)) entry.nfrs = body.nfrs.slice(0, 40).map((n) => ({ component: String(n?.component ?? '').slice(0, 200), requirement: String(n?.requirement ?? '').slice(0, 300), target: String(n?.target ?? '').slice(0, 120), from: n?.from ? String(n.from).slice(0, 40) : null })).filter((n) => n.requirement);
    Object.assign(entry, { status: 'proposed', editedBy: by(actor), editedAt: now() });
    delete entry.acceptedBy;
    delete entry.acceptedAt;
    await save(doc);
    await emit('engineering.architecture_changed', { itemId: storyId, storyId, systemName: name, summary: `edited ${name}'s application architecture for ${storyId}` }, actor);
    return view(storyId);
  }

  /** A person (accept-decisions, checked by the route) accepts a system's architecture: drafted, and current. */
  async function accept(storyId, name, actor) {
    await peopleOnly(actor, 'accept an application architecture');
    await writableStory(storyId);
    const doc = await get(storyId);
    const entry = doc?.systems.find((s) => s.name === name);
    if (!entry) throw fail(404, 'not_found', `${name}'s architecture for ${storyId} isn't drafted yet: ask for a draft first.`);
    const c = await currency(entry);
    if (c.stale) throw fail(409, 'stale', `${c.text}. Draft it again before accepting it.`);
    Object.assign(entry, { status: 'accepted', acceptedBy: { id: actor.id, name: actor.name ?? actor.id }, acceptedAt: now() });
    await save(doc);
    await emit('engineering.architecture_accepted', { itemId: storyId, storyId, systemName: name, summary: `accepted ${name}'s application architecture for ${storyId}` }, actor);
    return view(storyId);
  }

  /** The sign-off's architecture check: every impacted system's accepted and current. Null with no story or design. */
  async function facts(storyId) {
    const v = await view(storyId).catch(() => null);
    if (!v) return null;
    const missing = [];
    for (const s of v.systems) {
      if (s.status === 'none') missing.push(`${s.name} has no architecture yet`);
      else if (s.currency.stale) missing.push(`${s.name}'s architecture is stale`);
      else if (s.status !== 'accepted') missing.push(`${s.name}'s architecture is proposed`);
    }
    if (!v.systems.length) missing.push('the story names no impacted system');
    return { value: !missing.length, ...(missing.length ? { detail: missing.join('; ') } : {}) };
  }

  /** What a work item on one repository carries: its system's architecture, as Markdown lines (none: []). */
  async function contextFor(storyId, repo) {
    const doc = await get(storyId).catch(() => null);
    const short = String(repo ?? '').split('/').pop();
    const entry = doc?.systems.find((s) => s.name === short || String(s.repo).split('/').pop() === short);
    if (!entry) return [];
    return [
      `## Application architecture of ${entry.name} (${entry.status}${entry.readAt?.commit ? `, read at ${entry.readAt.commit.slice(0, 7)}` : ''})`,
      '', 'Flow:', ...(entry.flow ?? []).map((f, i) => `${i + 1}. ${f}`),
      ...(entry.objects?.length ? ['', 'Objects:', ...entry.objects.map((o) => `- ${o.name} (${o.kind})${o.fields?.length ? `: ${o.fields.join(', ')}` : ''}`)] : []),
      ...(entry.nfrs?.length ? ['', 'NFRs per component:', ...entry.nfrs.map((n) => `- ${n.component}: ${n.requirement} · ${n.target}${n.from ? ` (${n.from})` : ''}`)] : []),
      ...(entry.changes?.length ? ['', 'Changes:', ...entry.changes.map((c) => `- ${c.kind} ${c.path}: ${c.what}`)] : []),
    ];
  }

  return { get, view, draft, edit, accept, facts, contextFor, currency };
}
