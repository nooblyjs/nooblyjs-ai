// "For you" (product.md §5.8, tech.md §7.1): the home built for a person's work role. One read of the lifecycle
// engine's snapshot, scoped to the profile's teams ("mine") or not ("all": Show everything), shaped into the tiles
// and panels of the role's mockup. The work role only chooses the layout: what a person may decide is still the
// engine's answer (`canDecide`), from their access role.
//
// A tile or panel whose source isn't built yet says so with the phase that brings it, and an honest zero.
import { withTeammate } from './work-roles.js';

const DAY = 86_400_000;
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const words = (n) => WORDS[n] ?? String(n);
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const firstName = (name) => String(name ?? '').split(/\s+/)[0];
const agentName = (id) => String(id ?? '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const later = (phase, text) => ({ phase, text });
const nobody = 'No agent teammate is hired yet';
/** "Delivery squad", or "Delivery & Checkout" for several. */
const teamsText = (list) => (list.length <= 1 ? list[0]?.name ?? '' : list.map((t) => t.name.replace(/ (squad|team)$/i, '')).join(' & '));

export function createForYou({ services, profiles, workRoles, teams, agents = null }) {
  async function build(person, { scope = 'mine' } = {}) {
    const profile = await profiles.get(person.id);
    // The role's teammate is one actually hired here (or none), not the example name the role was written with.
    const roster = (await agents?.roster?.().catch(() => [])) ?? [];
    const listed = (await workRoles.get(profile?.workRole)) ?? null;
    const role = listed ? withTeammate(listed, roster) : null;
    // A name for work an agent is doing: from the roster when it is there.
    const nameFor = (id) => roster.find((a) => a.id === id)?.name ?? agentName(id);
    const allTeams = await teams.list();
    const myTeams = allTeams.filter((t) => (profile?.teams ?? []).includes(t.id));
    const firstWeek = await profiles.firstWeek(person.id);
    const base = {
      scope: scope === 'all' ? 'all' : 'mine',
      role: role ? { key: role.key, name: role.name, layout: role.layout ?? 'none', home: role.home ?? '/' } : null,
      firstName: firstName(person.name),
      eyebrow: ['For you', role?.name, teamsText(myTeams)].filter(Boolean).join(' · '),
      teams: myTeams.map((t) => ({ id: t.id, name: t.name })),
      firstWeek,
      onboarding: { completed: profile?.onboarding.completed === true },
    };
    if (!role || (role.layout ?? 'none') === 'none') return { ...base, layout: 'none' };

    const snapshot = await services.get('workflows')?.snapshot?.(person);
    if (!snapshot) return { ...base, layout: role.layout, engine: false };

    const teamIds = new Set(base.teams.map((t) => t.id));
    const inScope = (x) => base.scope === 'all' || x.owner === person.id || teamIds.has(x.team);
    const items = snapshot.items.filter(inScope);
    const active = items.filter((i) => i.status === 'active');
    const mine = snapshot.approvals.filter((a) => a.mine);
    // A Developer's runs and the questions stuck runs ask come from the Software Factory, when it is running here.
    let factory = null;
    if (role.layout === 'developer') {
      const service = services.get('factory');
      if (typeof service?.runsFor === 'function') {
        try {
          const [runs, questions, waiting] = await Promise.all([service.runsFor(person), service.questionsFor(person), service.waitingWork?.() ?? []]);
          factory = { runs, questions, waiting };
        } catch { /* the Factory is there but can't answer: the panels say it isn't running */ }
      }
    }
    const ctx = { person, role, listed, snapshot, items, active, mine, base, at: snapshot.at, factory, nameFor };
    const shaped = { 'product-manager': productManager, architect, developer }[role.layout](ctx);
    return { ...base, layout: role.layout, engine: true, now: snapshot.at, ...shaped };
  }

  // ---------------------------------------------------------------------------- Product manager

  function productManager({ person, role, listed, snapshot, items, active, mine, at, nameFor }) {
    const specs = mine.filter((a) => a.type === 'spec');
    const work = active.filter((i) => i.type !== 'pr');
    const stages = new Set(work.map((i) => i.stage)).size;
    const month = at.slice(0, 7);
    const shipped = items.filter((i) => i.status === 'completed' && (i.completedAt ?? '').startsWith(month));
    const late = work.filter((i) => i.late && !mine.some((a) => a.itemId === i.id)).sort((a, b) => b.waitingDays - a.waitingDays);
    const drafting = work.filter((i) => typeof i.work?.progress === 'number');

    const waiting = [
      ...mine.map((a) => ({ kind: 'review', tag: a.tag, tone: a.tone, title: a.title, context: a.context ?? a.line, href: a.href, action: 'Review' })),
      ...drafting.map((i) => ({ kind: 'preview', tag: 'Spec', tone: 'info', title: `${i.title} — ${i.ref}`, context: `${nameFor(i.work.by)} is ${Math.round(i.work.progress * 100)}% done`, href: i.specHref ?? i.href, action: 'Preview' })),
      ...late.map((i) => {
        const open = snapshot.approvals.filter((a) => a.itemId === i.id);
        const who = [...new Set(open.flatMap((a) => a.waitingOnNames))];
        return {
          kind: 'nudge', tag: 'Nudge', tone: 'warning', itemId: i.id,
          title: `${i.title} — waiting ${plural(i.waitingDays, `${i.waitingDays} day`, `${i.waitingDays} days`)} in ${i.stageLabel}`,
          context: who.length ? `With ${who.join(', ')}${open[0]?.targetText ? ` · past its ${open[0].targetText} target` : ''}` : `No one has picked it up in ${i.stageLabel}`,
          action: 'Nudge', nudgedAt: i.lastNudgedAt,
        };
      }),
    ];
    const agentItem = work.find((i) => i.work?.by === role.agent && typeof i.work.progress === 'number');
    const need = specs.length
      ? `${words(specs.length)} ${plural(specs.length, 'spec needs', 'specs need')} you today`
      : mine.length ? `${words(mine.length)} ${plural(mine.length, 'decision needs', 'decisions need')} you today` : 'Nothing needs your decision right now';
    const waits = late[0] ? `, and ${late.length === 1 ? 'one of your items has' : `${words(late.length).toLowerCase()} of your items have`} waited ${plural(late[0].waitingDays, 'a day', `${late[0].waitingDays} days`)} in ${late[0].stageLabel}` : '';
    return {
      summary: `${need}${waits}.`,
      filters: { what: 'My items' },
      action: { label: 'New idea', href: '/factory/product/board', icon: 'plus' },
      tiles: [
        { key: 'specs', label: 'Specs waiting on you', value: specs.length, note: specs.length ? `Oldest ${specs.map((a) => a.age)[0]}` : 'Nothing waiting', tone: specs.length ? 'warning' : null },
        { key: 'items', label: 'Your items in flight', value: work.length, note: `across ${stages} ${plural(stages, 'stage')}` },
        { key: 'shipped', label: 'Shipped this month', value: shipped.length, note: 'idea → production arrives with Metrics (Phase 10)' },
        { key: 'signals', label: 'New signals', value: null, note: null, source: 'product' },
      ],
      panels: {
        waiting,
        items: work.map(({ id, ref, title, cells, href, age, late: isLate }) => ({ id, ref, title, cells, href, age, late: isLate })),
        signals: { source: 'product', domain: person.teams?.[0] ?? null },
        agent: role.teammate ? {
          id: role.teammate.id, name: role.teammate.name,
          title: agentItem ? `${role.teammate.name} is working for you` : `${role.teammate.name} is available`,
          text: agentItem ? `${agentItem.work.task ?? `Drafting ${agentItem.ref}`} · ${Math.round(agentItem.work.progress * 100)}%` : 'No draft in progress on your items',
          progress: agentItem?.work.progress ?? null,
          action: { label: `Give ${firstName(role.teammate.name)} a new brief`, href: '/factory/product/specs' },
        } : listed?.agent ? { id: null, name: null, title: nobody, text: 'Hire one in Teammates to draft for you.', progress: null, action: { label: 'Hire a teammate', href: '/teammates/hire' } } : null,
      },
    };
  }

  // ---------------------------------------------------------------------------- Architect

  function architect({ snapshot, active, mine, base, at, role }) {
    const all = snapshot.approvals.filter((a) => a.type === 'adr');
    const decisions = base.scope === 'all' ? all : all.filter((a) => a.mine);
    const yours = mine.filter((a) => a.type === 'adr');
    const past = yours.filter((a) => a.overdue).length;
    // Architecture is the Design stage's work since lifecycle v3 (Phase 16b); its pages are the Factory's Design section.
    const inArch = active.filter((i) => i.stage === 'design');
    const stage = snapshot.stages.find((s) => s.key === 'design');
    const arriving = active.filter((i) => i.stage === 'product' && snapshot.approvals.some((a) => a.itemId === i.id && a.type === 'spec'));
    const queue = [
      ...inArch.map((i) => (typeof i.work?.progress === 'number'
        ? { id: i.id, title: `${i.title} · ${i.ref}`, text: `${i.work.text}${i.work.task ? ` · ${i.work.task}` : ''} · ${Math.round(i.work.progress * 100)}%`, action: { label: 'Watch', href: `/factory/design/architecture/${encodeURIComponent(i.id)}` } }
        : { id: i.id, title: `${i.title} · ${i.ref}`, late: i.late, text: i.waitingSince ? `Waiting ${Math.floor((new Date(at) - new Date(i.waitingSince)) / DAY)} days · no draft requested yet` : `In Design for ${i.waitingDays || 0} d`, action: { label: role.teammate ? `Ask ${firstName(role.teammate.name)} to draft` : 'Ask a teammate to draft', href: `/factory/design/architecture/${encodeURIComponent(i.id)}` } })),
      ...arriving.map((i) => {
        const a = snapshot.approvals.find((x) => x.itemId === i.id && x.type === 'spec');
        return { id: i.id, title: `${i.title} · ${i.ref}`, text: `Arrives when ${a.waitingOnNames.join(' and ')} ${plural(a.waitingOnNames.length, 'approves', 'approve')} the spec${a.due?.text === 'due today' ? ' · expected today' : ''}`, action: { label: 'Preview spec', href: i.specHref ?? i.href } };
      }),
    ];
    const slowest = snapshot.stages.find((s) => s.slowest);
    return {
      summary: `${yours.length ? `${words(yours.length)} ${plural(yours.length, 'decision needs', 'decisions need')} your sign-off.` : 'No decisions are waiting on you.'}${slowest?.key === 'design' ? ` Design is the slowest stage (median ${slowest.medianDays} d).` : ''}`,
      filters: { what: 'Architecture work' },
      action: { label: 'Open Architecture', href: '/factory/design/architecture' },
      tiles: [
        { key: 'decisions', label: 'Decisions awaiting you', value: yours.length, note: past ? `${past} past ${plural(past, 'its', 'their')} target` : yours.length ? 'All within target' : 'Nothing waiting', tone: past ? 'warning' : null },
        { key: 'in-architecture', label: 'In Design', value: inArch.length, note: stage?.medianDays === null || !stage ? 'no moves in 30 days' : `median ${stage.medianDays} d · target 1 d` },
        { key: 'standards', label: 'Standards broken on PRs', value: 0, note: 'Checked on pull requests from Phase 7' },
        { key: 'models', label: 'Models to review', value: 0, note: 'From the Knowledge Repository (Phase 8)' },
      ],
      panels: {
        decisions: decisions.map((a) => ({
          id: a.id, eyebrow: `${a.subject ?? 'ADR'} · ${a.itemRef}`, age: `${a.age}${a.due ? ` · ${a.due.text}` : ''}`, overdue: a.overdue,
          title: a.shortTitle, summary: a.summary, context: a.context, canDecide: a.canDecide, waitingOn: a.waitingOnNames,
          discussHref: `/factory/design/architecture/${encodeURIComponent(a.itemId)}`, approvalHref: a.href,
        })),
        queue,
        standards: { unavailable: later(7, 'Standards are checked on every pull request once the Software Factory joins NooblyJS.') },
        models: { unavailable: later(8, 'Models that are stale, contradicted or heavily cited come from the Knowledge Repository.') },
      },
    };
  }

  // ---------------------------------------------------------------------------- Developer

  function developer({ role, snapshot, items, active, person, factory }) {
    const prs = active.filter((i) => i.type === 'pr').sort((a, b) => b.ageDays - a.ageDays);
    const merged = items.filter((i) => i.type === 'pr' && i.status === 'completed' && (i.completedAt ?? '') >= snapshot.weekStart);
    const rows = prs.map((i) => {
      const a = snapshot.approvals.find((x) => x.itemId === i.id && ['build-approval', 'merge'].includes(x.type));
      return { id: i.id, ref: i.ref, title: i.title, context: a ? `${a.context ?? a.line} · waiting on ${a.waitingOnNames.join(', ')}` : i.now, stage: i.stageLabel, href: i.href, age: i.age };
    });
    const team = person.teams?.[0] ?? null;
    const off = { text: 'The Software Factory is not running here, so there are no runs to show.' };
    const inFlight = (factory?.runs ?? []).filter((r) => ['queued', 'running', 'parked', 'paused'].includes(r.status));
    return {
      summary: prs.length
        ? `${words(prs.length)} ${plural(prs.length, 'pull request is', 'pull requests are')} in flight on your repos.`
        : 'No pull requests are in flight on your repos.',
      filters: { what: 'Repos I own' },
      action: { label: 'Hand a ticket to a teammate', href: '/teammates/team' },
      tiles: [
        { key: 'prs', label: 'PRs to review', value: prs.length, note: prs.length ? `oldest ${prs[0].age} · target 4 h` : 'Nothing waiting' },
        { key: 'runs', label: 'Runs on your repos', value: inFlight.length, note: !factory ? 'The Software Factory is not running here' : inFlight.length ? `${inFlight.filter((r) => r.status === 'running').length} running now` : 'Nothing in flight' },
        { key: 'help', label: 'Needs help', value: factory?.questions.length ?? 0, note: !factory ? 'The Software Factory is not running here' : factory.questions.length ? 'A run is stuck and asking you' : 'No run is stuck' },
        { key: 'merged', label: 'Merged this week', value: merged.length, note: merged.length ? merged.map((i) => i.ref).join(', ') : 'Nothing merged yet' },
      ],
      panels: {
        prs: rows,
        // Until repositories have owners (Platform, Phase 9), "your repos" is every repository the Factory works on.
        runs: factory ? { rows: factory.runs.slice(0, 8), waiting: factory.waiting } : { unavailable: off },
        question: factory ? { rows: factory.questions } : { unavailable: off },
        teammate: role.teammate ? { id: role.teammate.id, name: role.teammate.name, team, text: `${firstName(role.teammate.name)} opens PRs on your repos. You review and merge; ${firstName(role.teammate.name)} never merges to main.`, href: '/teammates/team' } : null,
      },
    };
  }

  return { build };
}
