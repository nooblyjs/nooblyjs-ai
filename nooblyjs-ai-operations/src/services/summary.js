// The sidebar's status card and badges (releases waiting for approvers, SLOs burning, open incidents, outcome reviews
// due), and the SRE's home (Phase 23), in words.
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function createSummary({ releases, slos = null, incidents = null, outcomes = null }) {
  async function status() {
    const [all, slo, inc, out] = await Promise.all([releases.list(), slos?.list() ?? [], incidents?.list() ?? [], outcomes?.list() ?? []]);
    const waiting = all.filter((r) => r.status === 'waiting-approval');
    const piloting = all.filter((r) => r.status === 'piloting');
    const burning = slo.filter((s) => s.status !== 'ok');
    const open = inc.filter((i) => i.status === 'open');
    const due = out.filter((o) => o.status === 'due');
    const text = open.length ? `${plural(open.length, 'open incident')}` : burning.length ? `${plural(burning.length, 'SLO')} burning its budget`
      : waiting.length ? `${plural(waiting.length, 'release')} waiting for approvers` : piloting.length ? `${plural(piloting.length, 'release')} in a pilot` : all.length ? 'No release waiting' : 'No releases yet';
    return {
      badges: { releases: waiting.length, slos: burning.length, incidents: open.length, outcomes: due.length },
      card: { pill: { text, tone: open.length ? 'danger' : burning.length || waiting.length ? 'warning' : piloting.length ? 'info' : 'neutral' } },
    };
  }

  /** The SRE's home: what needs them in production. */
  async function home() {
    const [slo, inc, out] = await Promise.all([slos?.list() ?? [], incidents?.list() ?? [], outcomes?.list() ?? []]);
    return {
      slos: slo, burning: slo.filter((s) => s.status !== 'ok'),
      open: inc.filter((i) => i.status === 'open'), reviews: inc.filter((i) => i.review?.status === 'draft'),
      due: out.filter((o) => o.status === 'due'),
    };
  }
  return { status, home };
}
