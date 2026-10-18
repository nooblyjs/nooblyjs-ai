// NooblyJS's built-in apps (structure.md §2a): Home and Platform, described like hosted apps and loaded into the same
// frame. Their UI modules are in public/js/modules/. The nav comes from product.md §5. The Product Factory is a
// hosted app (nooblyjs-ai-product), which owns its screens like Teammates does.
// The dev app (/dev/styleguide) has no rail item and only exists when NOOBLY_DEV_LOGIN=true.

export const HOME = {
  name: 'home',
  label: 'Home',
  title: 'noobly',
  tag: 'Lifecycle',
  icon: 'home',
  mountPath: '/',
  ui: { entry: '/js/modules/home.js', styles: ['/css/home.css'] },
  nav: [
    { key: 'for-you', label: 'For you', path: '/', icon: 'spark' },
    { key: 'overview', label: 'Overview', path: '/home/overview', icon: 'grid' },
    { key: 'lifecycle', label: 'Lifecycle', path: '/home/lifecycle', icon: 'flow' },
    { key: 'approvals', label: 'Approvals', path: '/home/approvals', icon: 'approve', badge: 'approvals' },
    { key: 'activity', label: 'Activity', path: '/home/activity', icon: 'pulse' },
    { key: 'metrics', label: 'Metrics', path: '/home/metrics', icon: 'chart' },
    { key: 'teams', label: 'Teams & roles', path: '/home/teams', icon: 'person' },
  ],
};

export const PLATFORM = {
  name: 'platform',
  label: 'Platform',
  icon: 'layers',
  mountPath: '/platform',
  ui: { entry: '/js/modules/platform.js', styles: ['/css/platform.css'] },
  nav: [
    { key: 'repositories', label: 'Repositories', path: '/repositories', icon: 'repo', group: 'Build' },
    { key: 'containers', label: 'Containers', path: '/containers', icon: 'box', group: 'Build' },
    { key: 'environments', label: 'Environments', path: '/environments', icon: 'globe', group: 'Build' },
    { key: 'settings', label: 'Settings', path: '/settings', icon: 'settings', group: 'Govern' },
    { key: 'secrets', label: 'Secrets', path: '/secrets', icon: 'key', group: 'Govern' },
    { key: 'members', label: 'Members', path: '/members', icon: 'users', group: 'Govern' },
    { key: 'audit', label: 'Audit log', path: '/audit', icon: 'list', group: 'Govern' },
  ],
};

export const DEV = {
  name: 'dev',
  label: 'Development',
  title: 'dev',
  icon: 'settings',
  mountPath: '/dev',
  rail: false,
  ui: { entry: '/js/modules/dev.js', styles: ['/css/styleguide.css', '/css/teams-simulator.css'] },
  nav: [
    { key: 'styleguide', label: 'Styleguide', path: '/styleguide', icon: 'grid' },
    { key: 'clock', label: 'Dev clock', path: '/clock', icon: 'clock' },
    { key: 'teams', label: 'Teams simulator', path: '/teams', icon: 'chat' },
  ],
};

/** How the suite shows its child apps before they are installed (product.md §1, roadmap phases). */
export const SUITE_APPS = {
  'nooblyjs-ai-factory': { name: 'factory', label: 'Factory', icon: 'factory', phase: 7 },
  'nooblyjs-ai-infrastructure': { name: 'infrastructure', label: 'Infra', title: 'infrastructure', icon: 'cube', phase: '9a' },
  'nooblyjs-ai-teammate': { name: 'teammates', label: 'Teammates', icon: 'team', phase: 6 },
  'nooblyjs-ai-knowledge': { name: 'wiki', label: 'Wiki', icon: 'book', phase: 8 },
  'nooblyjs-ai-product': { name: 'product', label: 'Product', title: 'product factory', icon: 'product', phase: 5 },
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The status cards. Home's comes from the lifecycle engine (src/lifecycle/) and today's events, and its Approvals
 * badge is what waits on this person. Without the engine it shows the honest zeros.
 */
export function statusFor(app, { shell, services, activity, profiles }) {
  if (app === 'home') {
    return async (req) => {
      const down = shell.list().filter((a) => a.state === 'unavailable').length;
      const [counts, today] = await Promise.all([
        services?.get('workflows')?.counts?.(req?.person) ?? { inFlight: 0, waitingOnYou: 0, agentsWorking: 0 },
        activity?.today() ?? { spentUsd: 0 },
      ]);
      const badges = { approvals: counts.waitingOnYou };
      // While first-week tasks are open, the sidebar shows Getting started instead of the systems card (§5.1).
      const firstWeek = req?.person ? await profiles?.firstWeek(req.person.id) : null;
      if (firstWeek?.card) {
        return {
          badges,
          card: {
            meter: { label: 'Getting started', value: `${firstWeek.done} of ${firstWeek.total}`, ratio: firstWeek.done / firstWeek.total, tone: 'live' },
            lines: [firstWeek.onboardingOpen ? 'Next: pick your role and teams' : `Next: ${firstWeek.next}`],
          },
        };
      }
      const spent = today.spentUsd && today.spentUsd < 10 ? `$${today.spentUsd.toFixed(2)}` : `$${Math.round(today.spentUsd)}`;
      return {
        badges,
        card: {
          pill: down ? { text: `${down} app${down === 1 ? '' : 's'} unavailable`, tone: 'warning' } : { text: 'All systems healthy', tone: 'info' },
          items: [{ label: 'Agents working now', value: `${plural(counts.agentsWorking, 'agent')} · ${plural(counts.inFlight, 'item')} in flight` }],
          // The daily cap arrives with budgets in Phase 9; until then the words say the spend and the bar stays empty.
          meter: { label: 'Spent today', value: spent, ratio: 0 },
        },
      };
    };
  }
  if (app === 'platform') {
    // The cluster card (mockups): health in words, what runs and waits, and vCPU. The runtime is simulated until a
    // hosting target is chosen (product.md §12 Q3).
    return async () => {
      const usage = await services?.get('platform')?.containers?.usage?.();
      if (!usage) return { badges: {}, card: { pill: { text: 'No container runtime', tone: 'neutral' }, items: [{ label: 'Running now', value: '0 containers' }] } };
      return {
        badges: {},
        card: {
          pill: { text: usage.healthText, tone: usage.health === 'healthy' ? 'info' : 'warning' },
          items: [{ label: 'Running now', value: `${plural(usage.running, 'container')} · ${usage.queued} queued` }],
          meter: { label: 'vCPU', value: `${usage.vcpu.used} of ${usage.vcpu.total}`, ratio: usage.vcpu.total ? usage.vcpu.used / usage.vcpu.total : 0 },
        },
      };
    };
  }
  return undefined;
}
