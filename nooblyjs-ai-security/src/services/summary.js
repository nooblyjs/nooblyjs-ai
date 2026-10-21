// What Security says about itself elsewhere: the sidebar's status card and badge, and the Security engineer's home
// (findings past or near their fix-by date, threat models waiting, risks ending soon, items in Design or later with no
// threat model). Words first; the numbers repeat them.
const DAY_MS = 86_400_000;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function createSummary({ host, findings, threatModels, now }) {
  async function status() {
    const all = await findings.list();
    const open = all.filter((f) => f.state === 'open' || f.state === 'fixing');
    const late = open.filter((f) => f.late);
    const waiting = (await threatModels.list()).filter((tm) => tm.status === 'waiting');
    return {
      badges: { findings: open.length },
      card: {
        pill: late.length ? { text: `${plural(late.length, 'finding', 'findings')} past fix-by`, tone: 'danger' } : open.length ? { text: `${plural(open.length, 'open finding', 'open findings')}`, tone: 'warning' } : { text: 'No open findings', tone: 'success' },
        items: [{ label: 'Threat models waiting', value: String(waiting.length) }, { label: 'Scanner', value: 'mock (not a real scan)' }],
      },
    };
  }

  /** The Security engineer's home (NooblyJS For you). */
  async function home() {
    const at = now();
    const all = await findings.list();
    const open = all.filter((f) => f.state === 'open' || f.state === 'fixing');
    const soon = open.filter((f) => !f.late && new Date(f.fixBy).getTime() - at < 7 * DAY_MS);
    const late = open.filter((f) => f.late);
    const tms = await threatModels.list();
    const waiting = tms.filter((tm) => tm.status === 'waiting');
    const risks = (await findings.risks()).filter((r) => r.current && new Date(r.expiresAt).getTime() - at < 14 * DAY_MS);
    const w = host.service('workflows');
    const later = new Set(['design', 'engineer', 'build', 'test', 'release', 'operate']);
    const items = ((await Promise.resolve(w?.items?.({})).catch(() => [])) ?? []).filter((i) => i.status === 'active' && later.has(i.stage) && !['story', 'pr', 'idea'].includes(i.type));
    const covered = new Set(tms.map((tm) => tm.itemId));
    const without = items.filter((i) => !covered.has(i.id));
    return { open, late, soon, waiting, risks, without: without.map((i) => ({ id: i.id, title: i.title, stage: i.stage })) };
  }

  return { status, home };
}
