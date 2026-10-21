// A release's EVIDENCE PACK (root product.md §3.7): what says this feature is safe to put in front of customers, read
// from the apps that own each part. The merged pull requests of its stories with the Build and Test approvals each had
// (the lifecycle engine), the tests (the Test section: coverage, the latest Build-level runs, the environment runs),
// the open and accepted findings and the SBOM (Security). Nothing here is decided: it is shown to the two approvers.
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const LABEL = { 'build-approval': 'Build approval', 'test-approval': 'Test approval' };

export function createEvidence({ host }) {
  const svc = (name) => host.service?.(name) ?? null;
  const safe = async (fn, fallback) => { try { return (await fn()) ?? fallback; } catch { return fallback; } };
  const nameOf = async (id) => (id ? (await host.people.get(id).catch(() => null))?.name ?? id : null);

  /** The merged pull requests of the stories, each with who gave its Build and Test approvals. */
  async function pullRequests(storyIds) {
    const w = svc('workflows');
    const out = [];
    for (const storyId of storyIds) {
      for (const pr of await safe(() => w?.pullRequests?.({ storyId }), [])) {
        if (!pr.pr) continue;
        const view = await safe(() => w.pullRequest({ prId: pr.id }), null);
        const given = await Promise.all((view?.given ?? []).map(async (g) => ({ type: g.type, label: LABEL[g.type] ?? g.type, by: await nameOf(g.by), for: g.for && g.for !== g.by ? await nameOf(g.for) : null })));
        out.push({
          id: pr.id, ref: pr.ref ?? pr.id, title: pr.title, storyId, repo: pr.pr.repo, sha: pr.mergedSha ?? pr.pr.sha ?? null, merged: pr.status === 'completed',
          mergedBy: pr.mergedBy?.name ?? null, mergedAt: pr.mergedAt ?? null, evidence: pr.pr.evidence?.text ?? null, approvals: given,
        });
      }
    }
    return out;
  }

  /** The tests: each story's coverage and latest Build-level run, and the newest environment runs of these stories. */
  async function tests(storyIds) {
    const q = svc('quality');
    const stories = [];
    for (const storyId of storyIds) {
      const coverage = await safe(() => q?.coverageOf?.(storyId), null);
      const [latest] = (await safe(() => q?.testRuns?.({ storyId }), [])).filter((r) => (r.level ?? 'build') === 'build');
      stories.push({ storyId, coverage: coverage?.stories?.[0]?.text ?? coverage?.text ?? null, latestRun: latest ? { id: latest.id, status: latest.status, text: latest.text } : null });
    }
    const envRuns = (await safe(() => q?.environmentRuns?.({}), [])).filter((r) => (r.storyIds ?? []).some((id) => storyIds.includes(id)));
    const environments = [];
    for (const r of envRuns) if (!environments.some((e) => e.environment === r.environment)) environments.push({ environment: r.environment, level: r.level, id: r.id, status: r.status, text: r.text });
    return { stories, environments };
  }

  /** Findings of the item and its stories (Security), open and accepted, and the SBOM of the stories' runs. */
  async function security(itemId, storyIds) {
    const s = svc('security');
    const open = new Map();
    const accepted = new Map();
    for (const id of [itemId, ...storyIds]) {
      const risk = await safe(() => s?.riskFor?.({ itemId: id }), { open: [], accepted: [] });
      for (const f of risk.open ?? []) open.set(f.id, f);
      for (const f of risk.accepted ?? []) accepted.set(f.id, f);
    }
    const row = (f) => ({ id: f.id, title: f.title, severity: f.severity, severityLabel: f.severityLabel ?? f.severity, state: f.state, owner: f.ownerName ?? f.owner ?? null, href: f.href ?? null, ...(f.acceptance ? { acceptedUntil: f.acceptance.expiresAt, acceptedBy: f.acceptance.byName ?? f.acceptance.by } : {}) });
    const sbom = await safe(() => s?.sbomFor?.({ itemIds: storyIds }), null);
    return { running: Boolean(s), open: [...open.values()].map(row), accepted: [...accepted.values()].map(row), sbom };
  }

  /** The whole pack, with a line that says what is in it. */
  async function assemble({ itemId, storyIds }) {
    const [prs, t, sec] = await Promise.all([pullRequests(storyIds), tests(storyIds), security(itemId, storyIds)]);
    const merged = prs.filter((p) => p.merged);
    const approvals = merged.flatMap((p) => p.approvals.map((a) => ({ ...a, pullRequest: p.ref })));
    const components = (sec.sbom?.repos ?? []).reduce((n, r) => n + r.components.length, 0);
    return {
      pullRequests: prs, approvals, tests: t, findings: { open: sec.open, accepted: sec.accepted }, sbom: sec.sbom,
      text: `${plural(merged.length, 'merged pull request')} with ${plural(approvals.length, 'approval')} · ${t.stories.filter((s) => s.latestRun?.status === 'passed').length} of ${plural(t.stories.length, 'story', 'stories')} passing at Build${t.environments.length ? ` · ${t.environments.map((e) => `${e.environment} ${e.status}`).join(', ')}` : ''} · ${plural(sec.open.length, 'open finding')}${sec.accepted.length ? `, ${sec.accepted.length} accepted` : ''} · SBOM of ${plural(components, 'component')}`,
      at: new Date(Number(host.clock?.now?.() ?? Date.now())).toISOString(),
    };
  }

  return { assemble };
}
