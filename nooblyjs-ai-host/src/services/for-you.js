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
    // The Engineering homes (Phase 16d) read the stories in Engineer from the Software Factory, when it is running here.
    let engineering = null;
    if (role.layout === 'application-architect' || role.layout === 'test-analyst') {
      const service = services.get('factory');
      if (typeof service?.engineeringFor === 'function') {
        try {
          engineering = (await service.engineeringFor()).filter((s) => base.scope === 'all' || items.some((i) => i.id === s.id));
        } catch { /* the Factory is there but can't answer: the panels say it isn't running */ }
      }
    }
    // The Business owner's home (Phase 17): the business cases (the Product section's) and spend against budget (Metrics).
    let business = null;
    if (role.layout === 'business-owner') {
      const [cases, spend] = await Promise.all([
        Promise.resolve(services.get('product')?.businessCases?.()).catch(() => null),
        Promise.resolve(services.get('metrics')?.spendByValueStream?.()).catch(() => null),
      ]);
      business = { cases, spend };
    }
    // The Design homes (Phase 16c) read each item's design from the Factory's Design section, when it is running here.
    let design = null;
    if (role.layout === 'solution-architect' || role.layout === 'functional-analyst') {
      const service = services.get('design');
      if (typeof service?.items === 'function') {
        try {
          const list = (await service.items()).filter((i) => i.stage === 'design');
          design = (await Promise.all(list.map((i) => service.designFor(i.itemId)))).filter(Boolean)
            .filter((d) => base.scope === 'all' || items.some((i) => i.id === d.itemId));
        } catch { /* the Design section is there but can't answer: the panels say it isn't running */ }
      }
    }
    const ctx = { person, role, listed, snapshot, items, active, mine, base, at: snapshot.at, factory, nameFor, design, engineering, business };
    const shaped = { 'product-manager': productManager, architect, developer, 'solution-architect': solutionArchitect, 'functional-analyst': functionalAnalyst, 'application-architect': applicationArchitect, 'test-analyst': testAnalyst, 'business-owner': businessOwner }[role.layout](ctx);
    return { ...base, layout: role.layout, engine: true, now: snapshot.at, ...shaped };
  }

  // ---------------------------------------------------------------------------- Product manager

  function productManager({ person, role, listed, snapshot, items, active, mine, at, nameFor }) {
    const specs = mine.filter((a) => a.type === 'spec');
    // Items, not their stories (Phase 16c): a PM follows the item; its stories are Design's and Engineering's unit.
    const work = active.filter((i) => i.type !== 'pr' && i.type !== 'story');
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

  // ---------------------------------------------------------------------------- Design (Phase 16c)

  const DESIGN_OFF = 'The Factory\'s Design section is not running here, so there is no design to show.';
  const designHref = (part, itemId) => `/factory/design/${part}/${encodeURIComponent(itemId)}`;

  /** Solution Architect: items in Design, decisions awaiting them, and stories ready for their Design handoff. */
  function solutionArchitect({ mine, design, base }) {
    const yours = mine.filter((a) => a.type === 'adr' || a.type === 'design-handoff');
    const open = (design ?? []).flatMap((d) => d.stories.filter((s) => !s.handedOff).map((s) => ({ d, s })));
    const ready = open.filter(({ d }) => d.readiness.total && d.readiness.passed === d.readiness.total);
    const gone = (design ?? []).reduce((n, d) => n + d.stories.filter((s) => s.handedOff).length, 0);
    return {
      summary: design === null ? DESIGN_OFF
        : `${words(design.length)} ${plural(design.length, 'item is', 'items are')} in Design. ${ready.length ? `${words(ready.length)} ${plural(ready.length, 'story is', 'stories are')} ready for your Design handoff.` : 'No story is ready for a Design handoff yet.'}`,
      filters: { what: 'Items in Design' },
      action: { label: 'Open Design', href: '/factory/design/solution' },
      tiles: [
        { key: 'in-design', label: 'Items in Design', value: design?.length ?? null, note: design === null ? 'Design is not running here' : null },
        { key: 'decisions', label: 'Decisions awaiting you', value: yours.length, note: yours.length ? null : 'Nothing waiting' },
        { key: 'ready', label: 'Stories ready for your handoff', value: ready.length, note: open.length ? `${open.length} still in Design` : 'None in Design' },
        { key: 'handed-off', label: 'Stories handed off', value: gone, note: 'to Engineering' },
      ],
      panels: {
        lists: [
          {
            key: 'items', title: 'Items in Design', link: { label: 'Solution architecture', href: '/factory/design/solution' },
            empty: design === null ? DESIGN_OFF : `Nothing is in Design${base.scope === 'all' ? '' : ' for your teams'}.`,
            rows: (design ?? []).map((d) => ({ id: d.itemId, title: `${d.ref} · ${d.title}`, text: `${d.parts.solution} · ${d.parts.handoff}`, action: { label: 'Open', href: designHref('solution', d.itemId) } })),
          },
          {
            key: 'handoffs', title: 'Stories to hand to Engineering', link: { label: 'Handoff to the Factory', href: '/factory/design/handoff' },
            empty: 'No story is waiting for its Design handoff.',
            rows: open.map(({ d, s }) => {
              const ok = d.readiness.total && d.readiness.passed === d.readiness.total;
              return { id: s.id, title: `${s.id} · ${s.title}`, late: !ok, text: ok ? `${d.ref} · ready: every check passes` : `${d.ref} · ${d.readiness.passed} of ${d.readiness.total} checks pass`, action: { label: ok ? 'Hand off' : 'See the checks', href: designHref('handoff', d.itemId) } };
            }),
          },
        ],
        side: [
          { key: 'decisions', title: 'Decisions awaiting you', link: { label: 'Approvals', href: '/home/approvals' }, empty: 'No decision is waiting on you.', rows: yours.map((a) => ({ id: a.id, title: a.title, text: `${a.age}${a.due ? ` · ${a.due.text}` : ''}`, late: a.overdue, action: { label: 'Decide', href: a.href } })) },
        ],
      },
    };
  }

  /** Functional Analyst: interfaces with a side missing, stories to finish, and the items in Design. */
  function functionalAnalyst({ design, base }) {
    const oneSided = (design ?? []).flatMap((d) => d.interfaces.filter((i) => !i.complete).map((i) => ({ d, i })));
    const unfinished = (design ?? []).flatMap((d) => d.stories.filter((s) => !s.handedOff && (!s.criteria?.length || !s.requirements?.length)).map((s) => ({ d, s })));
    return {
      summary: design === null ? DESIGN_OFF
        : oneSided.length ? `${words(oneSided.length)} ${plural(oneSided.length, 'interface has', 'interfaces have')} a side missing, which holds the Design handoff.` : 'Every interface has both sides named.',
      filters: { what: 'Items in Design' },
      action: { label: 'Open the functional analysis', href: '/factory/design/functional' },
      tiles: [
        { key: 'one-sided', label: 'Interfaces with a side missing', value: oneSided.length, note: oneSided.length ? 'They hold the Design handoff' : 'All have both sides', tone: oneSided.length ? 'warning' : null },
        { key: 'unfinished', label: 'Stories to finish', value: unfinished.length, note: 'No criteria, or no business requirement' },
        { key: 'in-design', label: 'Items in Design', value: design?.length ?? null, note: design === null ? 'Design is not running here' : null },
      ],
      panels: {
        lists: [
          {
            key: 'interfaces', title: 'Interfaces with one side missing', link: { label: 'Functional analysis', href: '/factory/design/functional' },
            empty: design === null ? DESIGN_OFF : 'Every interface has both sides named.',
            rows: oneSided.map(({ d, i }) => ({ id: i.id, title: `${d.ref} · ${i.id} ${i.name}`, text: i.sidesText, late: true, action: { label: 'Name the side', href: designHref('functional', d.itemId) } })),
          },
          {
            key: 'stories', title: 'Stories to finish', link: { label: 'Stories', href: '/factory/design/stories' },
            empty: 'Every story in Design has its criteria and a business requirement.',
            rows: unfinished.map(({ d, s }) => ({ id: s.id, title: `${s.id} · ${s.title}`, text: `${d.ref} · ${!s.criteria?.length ? 'no acceptance criteria' : 'no business requirement'}`, action: { label: 'Finish', href: designHref('stories', d.itemId) } })),
          },
        ],
        side: [
          { key: 'items', title: 'Items in Design', link: { label: 'Design', href: '/factory/design/requirements' }, empty: design === null ? DESIGN_OFF : `Nothing is in Design${base.scope === 'all' ? '' : ' for your teams'}.`, rows: (design ?? []).map((d) => ({ id: d.itemId, title: `${d.ref} · ${d.title}`, text: d.parts.functional, action: { label: 'Open', href: designHref('functional', d.itemId) } })) },
        ],
      },
    };
  }

  // ---------------------------------------------------------------------------- Engineering (Phase 16d)

  const ENGINEERING_OFF = 'The Software Factory is not running here, so there are no stories in Engineer to show.';
  const signOffsFor = (mine) => mine.filter((a) => a.type === 'engineering-signoff');
  const signOffList = (mine) => ({
    key: 'sign-offs', title: 'Sign-offs waiting on you', link: { label: 'Engineering sign-off', href: '/factory/engineering/sign-off' }, empty: 'No Engineering sign-off is waiting on you.',
    rows: signOffsFor(mine).map((a) => ({ id: a.id, title: a.title, text: `${a.age}${a.due ? ` · ${a.due.text}` : ''}`, late: a.overdue, action: { label: 'Sign off', href: '/factory/engineering/sign-off' } })),
  });

  /** Application Architect: architectures to draft, accept or draw again, and the sign-offs waiting on them. */
  function applicationArchitect({ mine, engineering }) {
    const open = (engineering ?? []).flatMap((s) => (s.architecture.systemsList ?? []).filter((x) => x.status !== 'accepted' || /^Stale/.test(x.statusText)).map((x) => ({ s, x })));
    const stale = open.filter(({ x }) => /^Stale/.test(x.statusText));
    const yours = signOffsFor(mine);
    return {
      summary: engineering === null ? ENGINEERING_OFF
        : open.length ? `${words(open.length)} ${plural(open.length, 'application architecture needs', 'application architectures need')} you before ${plural((engineering ?? []).length, 'its story', 'their stories')} can be signed off.` : 'Every application architecture in Engineer is accepted and current.',
      filters: { what: 'Stories in Engineer' },
      action: { label: 'Open Application architecture', href: '/factory/engineering/architecture' },
      tiles: [
        { key: 'in-engineer', label: 'Stories in Engineer', value: engineering?.length ?? null, note: engineering === null ? 'The Factory is not running here' : null },
        { key: 'to-accept', label: 'Architectures to draft or accept', value: open.length - stale.length, note: 'per impacted system' },
        { key: 'stale', label: 'Stale architectures', value: stale.length, note: stale.length ? 'main moved since they were read' : 'All current', tone: stale.length ? 'warning' : null },
        { key: 'sign-offs', label: 'Sign-offs waiting on you', value: yours.length, note: yours.length ? null : 'Nothing waiting' },
      ],
      panels: {
        lists: [
          {
            key: 'architectures', title: 'Architectures to draft, accept or draw again', link: { label: 'Application architecture', href: '/factory/engineering/architecture' },
            empty: engineering === null ? ENGINEERING_OFF : 'Nothing to do: every system\'s architecture is accepted and current.',
            rows: open.map(({ s, x }) => ({ id: `${s.id}:${x.name}`, title: `${s.ref} · ${x.name}`, text: `${s.title} · ${x.statusText}`, late: /^Stale/.test(x.statusText), action: { label: x.status === 'none' ? 'Draft' : /^Stale/.test(x.statusText) ? 'Draw again' : 'Review', href: `/factory/engineering/architecture/${encodeURIComponent(s.id)}` } })),
          },
          {
            key: 'stories', title: 'Stories in Engineer', link: { label: 'Engineering sign-off', href: '/factory/engineering/sign-off' }, empty: engineering === null ? ENGINEERING_OFF : 'Nothing is in Engineer.',
            rows: (engineering ?? []).map((s) => ({ id: s.id, title: `${s.ref} · ${s.title}`, text: `${s.architecture.text} · ${s.signOff.text}`, action: { label: 'Open', href: `/factory/engineering/architecture/${encodeURIComponent(s.id)}` } })),
          },
        ],
        side: [signOffList(mine)],
      },
    };
  }

  /**
   * Test analyst: criteria without a ready test case, interfaces without a test, the sign-offs waiting on them, and
   * (Phase 16e) the pull requests waiting on a Test approval.
   */
  function testAnalyst({ mine, engineering, snapshot, items }) {
    const stories = engineering ?? [];
    const inScope = new Set(items.map((i) => i.id));
    const testing = snapshot.approvals.filter((a) => a.type === 'test-approval' && (a.mine || inScope.has(a.itemId))).sort((a, b) => b.ageHours - a.ageHours);
    const missing = stories.reduce((n, s) => n + Math.max(0, (s.testAnalysis.criteria ?? 0) - (s.testAnalysis.ready ?? 0)), 0);
    const untouched = stories.filter((s) => !s.testAnalysis.cases);
    const untested = stories.flatMap((s) => (s.testAnalysis.untestedInterfaces ?? []).map((id) => ({ s, id })));
    const yours = signOffsFor(mine);
    return {
      summary: engineering === null ? ENGINEERING_OFF
        : missing ? `${words(missing)} ${plural(missing, 'criterion has', 'criteria have')} no ready test case yet, which holds the Engineering sign-off.` : 'Every criterion in Engineer has a ready test case.',
      filters: { what: 'Stories in Engineer' },
      action: { label: 'Open Test analysis', href: '/factory/quality/test-analysis' },
      tiles: [
        { key: 'criteria', label: 'Criteria without a ready test case', value: missing, note: missing ? 'They hold the sign-off' : 'All ready', tone: missing ? 'warning' : null },
        { key: 'untouched', label: 'Stories with no test analysis', value: untouched.length, note: untouched.length ? 'Ask for a draft' : 'None' },
        { key: 'interfaces', label: 'Interfaces without a ready test', value: untested.length, note: 'contract or integration' },
        { key: 'sign-offs', label: 'Sign-offs waiting on you', value: yours.length, note: yours.length ? null : 'Nothing waiting' },
        { key: 'test-approvals', label: 'Pull requests waiting on a Test approval', value: testing.length, note: testing.length ? `oldest ${testing[0].age}` : 'Nothing waiting' },
      ],
      panels: {
        lists: [
          {
            key: 'test-approvals', title: 'Pull requests waiting on a Test approval', link: { label: 'Test approvals', href: '/factory/test/approvals' },
            empty: 'No pull request is waiting on a Test approval.',
            rows: testing.map((a) => ({ id: a.itemId, title: a.title, text: `${a.summary ?? a.line} · waiting on ${a.waitingOnNames.join(', ')} · ${a.age}`, late: Boolean(a.overdue), action: { label: 'Verify', href: `/factory/pull-requests/${encodeURIComponent(a.itemId)}` } })),
          },
          {
            key: 'analyses', title: 'Test analyses to finish', link: { label: 'Test analysis', href: '/factory/quality/test-analysis' },
            empty: engineering === null ? ENGINEERING_OFF : 'Every story in Engineer has a ready test case for each criterion.',
            rows: stories.filter((s) => !s.testAnalysis.cases || s.testAnalysis.ready < s.testAnalysis.criteria).map((s) => ({ id: s.id, title: `${s.ref} · ${s.title}`, text: s.testAnalysis.cases ? s.testAnalysis.text : 'No test analysis yet', late: !s.testAnalysis.cases, action: { label: s.testAnalysis.cases ? 'Finish' : 'Draft', href: `/factory/quality/test-analysis/${encodeURIComponent(s.id)}` } })),
          },
          {
            key: 'interfaces', title: 'Interfaces without a ready test', link: { label: 'Test analysis', href: '/factory/quality/test-analysis' }, empty: 'Every interface has a ready contract or integration test.',
            rows: untested.map(({ s, id }) => ({ id: `${s.id}:${id}`, title: `${s.ref} · ${id}`, text: s.title, action: { label: 'Open', href: `/factory/quality/test-analysis/${encodeURIComponent(s.id)}` } })),
          },
        ],
        side: [signOffList(mine)],
      },
    };
  }

  // ---------------------------------------------------------------------------- Business owner (Phase 17)

  /**
   * Business owner: the business cases waiting (ideas whose case isn't complete, ideas waiting to be accepted, epics
   * with none), and spend against budget per portfolio, this month.
   */
  function businessOwner({ business, snapshot }) {
    const cases = business?.cases ?? null;
    const spend = business?.spend ?? null;
    const acceptance = snapshot.approvals.filter((a) => a.type === 'idea');
    const open = (cases ?? []).filter((c) => !c.complete);
    const ready = (cases ?? []).filter((c) => c.complete && c.ownerKind === 'idea');
    const epicsWithout = open.filter((c) => c.ownerKind === 'epic' && !c.exists);
    const portfolios = spend?.portfolios ?? [];
    const over = portfolios.filter((p) => p.budgetUsd && p.totalUsd > p.budgetUsd);
    const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    const caseHref = (c) => `/factory/product/business-cases/${encodeURIComponent(c.ownerId)}`;
    return {
      summary: cases === null ? 'The Product section is not running here, so there are no business cases to show.'
        : `${words(open.length)} ${plural(open.length, 'business case needs', 'business cases need')} you${over.length ? `, and ${words(over.length)} ${plural(over.length, 'portfolio is', 'portfolios are')} over budget` : ''}.`,
      filters: { what: 'Portfolios' },
      action: { label: 'Open the Product board', href: '/factory/product' },
      tiles: [
        { key: 'cases', label: 'Business cases waiting', value: cases ? open.length : null, note: cases === null ? 'The Product section is not running here' : open.length ? 'Not complete yet' : 'All complete' },
        { key: 'accept', label: 'Ideas ready to accept', value: ready.length + acceptance.length, note: 'Their business case is complete' },
        { key: 'epics', label: 'Epics without a business case', value: epicsWithout.length, note: epicsWithout.length ? 'Ask an agent to draft one' : 'None' },
        ...portfolios.slice(0, 1).map((p) => ({ key: 'spend', label: `${p.name} this month`, value: money(p.totalUsd), note: p.budgetUsd ? `of ${money(p.budgetUsd)} · agent ${money(p.agentUsd)}, cloud ${money(p.cloudUsd)}` : 'No budget set', tone: p.budgetUsd && p.totalUsd > p.budgetUsd ? 'warning' : null })),
      ],
      panels: {
        lists: [
          {
            key: 'cases', title: 'Business cases waiting', link: { label: 'Product board', href: '/factory/product' },
            empty: cases === null ? 'The Product section is not running here.' : 'Every business case is complete.',
            rows: open.map((c) => ({ id: c.ownerId, title: `${c.ownerId} · ${c.title}`, text: c.text, late: !c.exists, action: { label: c.exists ? 'Finish' : 'Draft', href: caseHref(c) } })),
          },
          {
            key: 'spend', title: 'Spend against budget, this month', link: { label: 'Metrics', href: '/home/metrics' },
            empty: spend === null ? 'Metrics could not be read.' : 'No portfolio has spend or a budget yet.',
            rows: portfolios.map((p) => ({ id: p.name, title: p.name, text: `${p.text} · agent ${money(p.agentUsd)}, cloud ${money(p.cloudUsd)}`, late: Boolean(p.budgetUsd && p.totalUsd > p.budgetUsd), action: { label: 'Budgets', href: '/platform/settings' } })),
          },
        ],
        side: [{
          key: 'value-streams', title: 'By value stream', empty: 'Nothing placed in a value stream yet.',
          rows: (spend?.rows ?? []).map((r) => ({ id: `${r.portfolio}:${r.valueStream}`, title: `${r.portfolio} › ${r.valueStream ?? 'no value stream'}`, text: `${money(r.totalUsd)} · agent ${money(r.agentUsd)}, cloud ${money(r.cloudUsd)}` })),
        }],
      },
    };
  }

  // ---------------------------------------------------------------------------- Developer

  function developer({ role, snapshot, items, active, person, factory }) {
    const prs = active.filter((i) => i.type === 'pr').sort((a, b) => b.ageDays - a.ageDays);
    const merged = items.filter((i) => i.type === 'pr' && i.status === 'completed' && (i.completedAt ?? '') >= snapshot.weekStart);
    const rows = prs.map((i) => {
      const a = snapshot.approvals.find((x) => x.itemId === i.id && ['build-approval', 'merge'].includes(x.type));
      return { id: i.id, ref: i.ref, title: i.title, context: a ? `${i.prHref && a.summary ? a.summary : a.context ?? a.line} · waiting on ${a.waitingOnNames.join(', ')}` : i.now, stage: i.stageLabel, href: i.prHref ?? i.href, age: i.age };
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
