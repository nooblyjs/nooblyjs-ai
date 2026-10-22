// Closing the loop (NooblyJS Phase 25a): everyone who asked for an item hears when it ships and whether it worked.
// "Who asked" is feedback.peopleToTell(): the people who voted for, follow, or whose notes are linked to the item, its
// idea and its feature. Form senders and colleagues with no NooblyJS record are never told. NooblyJS's notify service
// (host.service('notify').tell) puts a notice on their For you page and messages them in Teams when they have the app;
// the same key reaches a person once, so a rollout's later steps tell nobody again.

export function createLoop({ repos, host, log, feedback }) {
  const now = () => new Date(Number(host.clock?.now?.() ?? Date.now())).toISOString();

  async function tell({ itemId, featureId = null, key, title, text, link, kind }) {
    const notify = host.service?.('notify');
    if (typeof notify?.tell !== 'function') {
      log?.warn?.(`product: nobody was told about ${itemId} (${kind}): NooblyJS's notify service is not here`);
      return { told: [] };
    }
    const { people, ids } = await feedback.peopleToTell(itemId, { featureId });
    if (!people.length) return { told: [] };
    const results = await notify.tell({ to: people, title, text, link, key, system: 'product', itemId });
    const told = results.filter((r) => r.told).map((r) => r.person);
    await host.audit?.record?.({ actor: 'product', action: 'feedback.loop_closed', target: itemId, system: 'product', kind, told: told.length, asked: people.length, ids });
    if (told.length) await host.events.emit('feedback.loop_closed', { itemId, kind, people: told, summary: `told ${told.length} ${told.length === 1 ? 'person who asked' : 'people who asked'} that ${itemId} ${kind === 'shipped' ? 'shipped' : 'had its outcome review'}` }, { actor: null });
    return { told };
  }

  /**
   * Operations' release.deployed: the first step into production (a release only ever deploys there, I10) tells
   * everyone who asked, with the release notes. The rollout's later steps tell nobody again (notify's key).
   */
  async function onReleaseDeployed(event) {
    const p = event?.payload ?? {};
    if (!p.itemId || (p.environmentKind && p.environmentKind !== 'production')) return null;
    const release = await Promise.resolve(host.service?.('operations')?.releaseFor?.(p.releaseId)).catch(() => null);
    const spec = await repos.specs.get(p.itemId).catch(() => null);
    const what = spec?.title ?? release?.name ?? p.itemId;
    const at = now();
    if (spec && !spec.shippedAt) await repos.specs.update(p.itemId, (s) => (s && !s.shippedAt ? { ...s, shippedAt: at, shippedIn: p.releaseId ?? null } : null));
    if (spec?.idea) await repos.ideas.update(spec.idea, (i) => (i && !i.shippedAt ? { ...i, shippedAt: at } : null)).catch(() => null);
    const name = release?.name ? `${release.name}${release.version ? ` (${release.version})` : ''}` : p.releaseId;
    return tell({
      itemId: p.itemId, featureId: p.featureId ?? release?.featureId ?? null, kind: 'shipped',
      key: `product:shipped:${p.releaseId ?? p.itemId}`,
      title: `${what} shipped`,
      text: [`${name} is in production. You asked for this, voted for it or follow it.`, release?.notes ? `Release notes:\n${String(release.notes).slice(0, 1500)}` : null].filter(Boolean).join('\n\n'),
      link: release?.href ?? null,
    });
  }

  /** Operations' outcome_review.closed: whether it worked, with a link to the review. */
  async function onOutcomeReviewed(event) {
    const p = event?.payload ?? {};
    if (!p.itemId) return null;
    const spec = await repos.specs.get(p.itemId).catch(() => null);
    const result = p.text ?? (Number.isInteger(p.goals) ? `${p.met ?? 0} of ${p.goals} goals met` : 'Its outcome review is done');
    return tell({
      itemId: p.itemId, kind: 'reviewed', key: `product:reviewed:${p.outcomeId ?? p.itemId}`,
      title: `${spec?.title ?? p.itemId}: ${result}`,
      text: `The outcome review of ${p.itemId} is closed: ${result}.`,
      link: p.href ?? null,
    });
  }

  return { onReleaseDeployed, onOutcomeReviewed };
}
