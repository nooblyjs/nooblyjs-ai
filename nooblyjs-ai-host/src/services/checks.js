// One shape for checks (Phase 16f, root design.md §5). Readiness checks, approvals, gates, quality attributes, the
// standards check, required tests and policy checks were five things in four places; each app now maps its own to one
// shape in a `checksFor` service, and this gathers an item's (its stories' and pull requests' too) into one list:
//
//   { id, key, kind: readiness | approval | standard | gate | test | policy, subject: { item, ref }, definedBy: { system,
//     ref }, verifiedBy, severity: blocking | warning, result: passed | failed | warning | not-run, text, evidence:
//     { system, ref, summary }, override, overridable, at }
//
// The id is NooblyJS's: the same check always has the same one. When a check is new, or its result changed since it was
// last gathered, `check.recorded` is emitted (the last results are kept in data/checks/<item>.yaml). Overriding one check
// is a person's, on a readiness check: the lifecycle engine records it. A check never passes on a model's word: its
// `verifiedBy` is a tool, a gate or a person.
import crypto from 'node:crypto';

const ORDER = ['readiness', 'standard', 'gate', 'test', 'policy', 'approval'];
const KIND_WORDS = { readiness: 'Readiness', standard: 'Standards', gate: 'Gate', test: 'Tests', policy: 'Policy', approval: 'Approval' };
const SYSTEM_WORDS = { workflows: 'Lifecycle', product: 'Product section', design: 'Design section', factory: 'Software Factory', quality: 'Test section', infrastructure: 'Infrastructure' };
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const idOf = (c) => `chk_${crypto.createHash('sha1').update([c.definedBy?.system, c.kind, c.subject?.item, c.subject?.ref, c.key].join('|')).digest('hex').slice(0, 12)}`;

export function createChecks({ store, services, events, log = console }) {
  const svc = (name) => services.get(name) ?? null;

  /** Each app's checks for the item (one failing app is said, not fatal). */
  async function sources(itemId, family) {
    const asks = [
      ['workflows', () => svc('workflows')?.checksFor?.({ itemId })],
      ['product', () => svc('product')?.checksFor?.(itemId)],
      ['factory', () => svc('factory')?.checksFor?.({ itemId, itemIds: family })],
      ['infrastructure', () => svc('infrastructure')?.checksFor?.(itemId)],
    ];
    const missing = [];
    const lists = await Promise.all(asks.map(async ([name, ask]) => {
      try {
        const out = await ask();
        if (out === undefined) missing.push(name);
        return Array.isArray(out) ? out : [];
      } catch (err) {
        log.warn?.(`checks: ${name}.checksFor(${itemId}) failed: ${err.message}`);
        missing.push(name);
        return [];
      }
    }));
    return { list: lists.flat(), missing };
  }

  /** NooblyJS keeps each check's last result, and says so when one is new or changed (check.recorded). */
  async function record(itemId, checks) {
    if (!SAFE.test(itemId)) return;
    const path = ['checks', `${itemId}.yaml`];
    const before = (await store.readYaml(path).catch(() => null))?.results ?? {};
    const changed = checks.filter((c) => before[c.id] !== c.result);
    if (!changed.length) return;
    await store.writeYaml(path, { itemId, results: Object.fromEntries(checks.map((c) => [c.id, c.result])) });
    for (const c of changed) {
      await events.emit('check.recorded', {
        itemId: c.subject.item, checkId: c.id, kind: c.kind, key: c.key, result: c.result, system: c.definedBy?.system ?? null,
        summary: `${KIND_WORDS[c.kind] ?? c.kind} check on ${c.subject.ref ?? c.subject.item}: ${c.text} (${c.result})`,
      }, { actor: 'system' }).catch((err) => log.warn?.(`checks: check.recorded: ${err.message}`));
    }
  }

  /** An item's checks, its stories' and its pull requests', in one list with how many pass, said in words. */
  async function checksFor(itemId) {
    const workflows = svc('workflows');
    const family = (await workflows?.familyOf?.({ itemId }).catch(() => null)) ?? [itemId];
    const { list, missing } = await sources(itemId, family);
    const checks = list.map((c) => ({ ...c, id: idOf(c), source: SYSTEM_WORDS[c.definedBy?.system] ?? c.definedBy?.system ?? 'Unknown', kindText: KIND_WORDS[c.kind] ?? c.kind }))
      .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || String(a.subject.item).localeCompare(String(b.subject.item), 'en', { numeric: true }));
    await record(itemId, checks).catch((err) => log.warn?.(`checks: recording ${itemId}: ${err.message}`));
    const failing = checks.filter((c) => c.result === 'failed');
    const passed = checks.filter((c) => c.result === 'passed').length;
    return {
      itemId, checks, passed, failing: failing.length, total: checks.length,
      text: !checks.length ? 'No checks yet' : `${passed} of ${checks.length} pass${failing.length ? ` · ${failing.length} failing` : ''}`,
      kinds: ORDER.filter((k) => checks.some((c) => c.kind === k)).map((k) => ({ kind: k, text: KIND_WORDS[k], count: checks.filter((c) => c.kind === k).length })),
      unavailable: missing.filter((m) => m !== 'workflows').map((m) => SYSTEM_WORDS[m] ?? m),
    };
  }

  /**
   * A person overrides one failing check, with a reason. Only a readiness check can be overridden here (the lifecycle
   * engine records it, refuses an agent and audits it); any other kind is its own app's to decide, and says so.
   */
  async function override({ itemId, checkId, reason, actor } = {}) {
    const { checks } = await checksFor(itemId);
    const check = checks.find((c) => c.id === checkId);
    if (!check) throw Object.assign(new Error(`${itemId} has no check ${checkId}.`), { status: 404, code: 'not_found' });
    if (check.kind !== 'readiness' || check.definedBy?.system !== 'workflows') {
      throw Object.assign(new Error(`This is a ${check.kindText.toLowerCase()} check of the ${check.source}: it is decided there, not overridden here.`), { status: 422, code: 'not_overridable' });
    }
    const workflows = svc('workflows');
    if (typeof workflows?.overrideCheck !== 'function') throw Object.assign(new Error('The lifecycle engine is not running here.'), { status: 409, code: 'unavailable' });
    return workflows.overrideCheck({ itemId: check.subject.item, key: check.key, reason, actor });
  }

  return { checksFor, override, idOf };
}
