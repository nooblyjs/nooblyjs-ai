// Phase 27: the readiness checks by name. A stage's checks are data (lifecycle.yaml, or readiness.yaml for a data folder
// from before); whether one passes is code, here or in the app that knows. Each evaluator has a name (`design.
// requirements-covered`), its words, and a source: the app that works out the facts (Product, Design, the Software
// Factory) or the pull request's own evidence. A check that needs no code is a `when` expression in the Software Factory's
// condition language (never evaluated as code) over the item's facts. An app may register evaluators of its own.
import { compileCondition } from 'nooblyjs-ai-factory/conditions';
import { kindOf } from './stages.js';

/** The evaluators NooblyJS knows, by name: the facts' key, the words, and where the facts come from. */
const BUILT_IN = [
  // Phase 17: before an idea is accepted, from the idea's business case (Product).
  ['product', 'business-case-complete', 'Business case complete', 'Business case not complete'],
  // The spec's checks (Product, product.md §4).
  ['product', 'problem-evidence', 'Problem backed by evidence', 'Problem needs evidence'],
  ['product', 'goals-measurable', 'Goals are measurable', 'Goals need measures'],
  ['product', 'criteria-testable', 'Criteria are testable', 'Criteria need to be testable'],
  ['product', 'dependencies-named', 'Dependencies named', 'Dependencies not named'],
  ['product', 'performance-targets', 'Performance targets set', 'Performance targets missing'],
  ['product', 'privacy-reviewed', 'Privacy reviewed', 'Privacy not reviewed'],
  ['product', 'rollout-plan', 'Rollout plan ready', 'Rollout plan missing'],
  // Phase 16c: before each story's Design handoff, from the item's design (Design).
  ['design', 'requirements-covered', 'Every business requirement is covered by a story', 'A business requirement has no story'],
  ['design', 'decisions-decided', 'No decision is still proposed', 'A decision is still proposed'],
  ['design', 'interfaces-complete', 'Every interface has both sides named', 'An interface has a side missing'],
  // Phase 16d: before each story's Engineering sign-off, from its architecture and test analysis (the Software Factory).
  ['engineering', 'architecture-accepted', 'The application architecture is accepted and current', 'The application architecture is not accepted'],
  ['engineering', 'criteria-ready', 'Every criterion has a ready test case', 'A criterion has no ready test case'],
  ['engineering', 'interfaces-tested', 'Every interface has an integration test', 'An interface has no integration test'],
  // Phase 16e: before a pull request's Test approval, from the evidence the Software Factory recorded for its commit.
  ['pr', 'required-tests', 'Every required test is present and passing', 'A required test is missing or not passing'],
  ['pr', 'gates-passed', 'The checks passed on this commit', 'The checks did not pass on this commit'],
].map(([source, key, passed, failed]) => ({ name: `${source}.${key}`, source, key, passed, failed }));

/** Where a check from readiness.yaml (no evaluator named) gets its facts, by the kind of its stage. */
const SOURCE_OF_KIND = { discover: 'product', product: 'product', design: 'design', engineer: 'engineering' };

/** What a `when` check may read (the decision of 2026-10-26), for the Workflow page and the error messages. */
export const WHEN_FACTS = ['item.<field>', 'spec.sections.<heading>', 'stories.count', 'stories.active', 'pullRequests.count', 'pullRequests.open', 'defects.open'];

/** "Dependencies" → "dependencies", "User stories" → "user-stories": how a spec's heading is named in a `when`. */
export const sectionName = (heading) => String(heading ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * @param {object} o
 * @param {object} o.host   the host (its services: product, design, factory)
 * @param {object} o.repos  the lifecycle's repositories (an item's stories, pull requests and defects)
 * @param {object} o.log
 */
export function createEvaluators({ host, repos, log }) {
  const byName = new Map(BUILT_IN.map((e) => [e.name, e]));
  // Sources registered by other apps: name → async (item) => ({ facts }) | null.
  const registered = new Map();
  let version = 0;

  /** An app's evaluators: { source, checks: [{ key, passed, failed }], facts: async (item) => ({ facts }) | null }. */
  function register({ source, checks = [], facts } = {}) {
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(String(source ?? '')) || ['product', 'design', 'engineering', 'pr', 'when'].includes(source)) {
      throw new Error(`An evaluator source needs a name of its own, not ${JSON.stringify(source)}.`);
    }
    if (typeof facts !== 'function') throw new Error(`The ${source} evaluators need a facts function.`);
    for (const c of checks) {
      if (!c?.key || !c.passed || !c.failed) throw new Error(`Each ${source} evaluator needs a key and its words.`);
      byName.set(`${source}.${c.key}`, { name: `${source}.${c.key}`, source, key: c.key, passed: c.passed, failed: c.failed });
    }
    registered.set(source, facts);
    version += 1;
  }

  /** Every evaluator, for the Workflow page. */
  const list = () => [...byName.values()].map(({ name, passed, failed, source }) => ({ name, passed, failed, source }));

  /**
   * A check as written (an evaluator's name, { key, evaluator }, or { key, passed, failed, when }) made ready to run:
   * { key, passed, failed, evaluator?, source, when? }. Throws with the reason when it can't be.
   * `kind` is the kind of the stage it belongs to: a readiness.yaml check that names no evaluator takes its stage's.
   */
  function resolve(entry, { kind = null, legacy = false } = {}) {
    if (typeof entry === 'string') {
      const found = byName.get(entry);
      if (!found) throw new Error(`there is no evaluator "${entry}" (${[...byName.keys()].join(', ')})`);
      return { key: found.key, passed: found.passed, failed: found.failed, evaluator: found.name, source: found.source };
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('a check is an evaluator\'s name or { key, … }');
    const key = String(entry.key ?? '');
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(key)) throw new Error(`a check needs a key in lower case with dashes, not ${JSON.stringify(entry.key)}`);
    if (entry.when !== undefined) {
      if (entry.evaluator) throw new Error(`check ${key} has both a "when" and an evaluator: it needs one or the other`);
      if (!entry.passed || !entry.failed) throw new Error(`check ${key} needs its words: "passed" and "failed"`);
      let test;
      try {
        test = compileCondition(String(entry.when));
      } catch (err) {
        throw new Error(`check ${key}: ${err.message}`);
      }
      return { key, passed: String(entry.passed), failed: String(entry.failed), when: String(entry.when), test, source: 'when' };
    }
    const name = entry.evaluator ?? (legacy ? legacyName(key, kind) : null);
    if (!name && !legacy) throw new Error(`check ${key} names no evaluator and no "when"`);
    const found = name ? byName.get(name) : null;
    if (!found && !legacy) throw new Error(`check ${key}: there is no evaluator "${name}"`);
    // A readiness.yaml check from before that no evaluator knows keeps what was recorded on the item.
    const source = found?.source ?? 'recorded';
    return {
      key, passed: String(entry.passed ?? found?.passed ?? key), failed: String(entry.failed ?? found?.failed ?? key),
      ...(found ? { evaluator: found.name } : {}), source,
    };
  }

  function legacyName(key, kind) {
    const source = kind === 'pull-request' ? 'pr' : SOURCE_OF_KIND[kind];
    return source && byName.has(`${source}.${key}`) ? `${source}.${key}` : null;
  }

  // ---------------------------------------------------------------------------- facts

  const toFacts = (facts) => ({
    results: Object.fromEntries(Object.entries(facts ?? {}).map(([key, fact]) => [key, fact?.value ?? null])),
    details: Object.fromEntries(Object.entries(facts ?? {}).filter(([, fact]) => fact?.detail).map(([key, fact]) => [key, fact.detail])),
    raw: facts ?? {},
  });
  const recorded = (item) => ({ results: item.readiness?.results ?? {}, details: {}, raw: {} });

  /**
   * The facts of one source for an item: { results, details, raw }, or null when the source has no work for it (no
   * design for the item, Design not running here): its checks then don't apply. Each source is asked once per call.
   */
  async function factsOf(source, item) {
    const kind = kindOf(item.stage);
    if (source === 'recorded') return recorded(item);
    if (source === 'product') {
      // Product's facts are the spec's (or the idea's business case): an item that isn't Product's keeps what was recorded.
      const product = item.system === 'product' ? host.service?.('product') : null;
      if (typeof product?.readinessFacts !== 'function') return kind === 'discover' ? null : recorded(item);
      try {
        const facts = (await product.readinessFacts(item.id))?.facts;
        if (facts) return toFacts(facts);
        return kind === 'discover' ? null : recorded(item); // Phase 17: only an idea has a business case to check
      } catch (err) {
        log.warn(`readinessFacts(${item.id}) failed, using the recorded result: ${err.message}`);
        return recorded(item);
      }
    }
    if (source === 'design' || source === 'engineering') {
      const app = host.service?.(source === 'design' ? 'design' : 'factory');
      const ask = source === 'design' ? app?.readinessFacts : app?.engineeringReadiness;
      if (typeof ask !== 'function') return null;
      try {
        const facts = (await ask(source === 'design' ? item.parentId ?? item.id : item.id))?.facts;
        return facts ? toFacts(facts) : null;
      } catch (err) {
        log.warn(`${source} readiness(${item.id}) failed: ${err.message}`);
        return null;
      }
    }
    if (source === 'pr') return toFacts(pullRequestFacts(item));
    const own = registered.get(source);
    if (!own) return null;
    try {
      const facts = (await own(item))?.facts;
      return facts ? toFacts(facts) : null;
    } catch (err) {
      log.warn(`${source} readiness(${item.id}) failed: ${err.message}`);
      return null;
    }
  }

  /** A pull request's facts (Phase 16e): every required test present and passing, and the gates passed on its commit. */
  function pullRequestFacts(item) {
    const ev = item.pr?.evidence ?? null;
    const sha = String(item.pr?.sha ?? '').slice(0, 7);
    return {
      'required-tests': ev && !ev.missing?.length && !ev.failing?.length && !ev.unproven?.length
        ? { value: true }
        : { value: false, detail: ev ? ev.text : 'no evidence was recorded for this commit' },
      'gates-passed': item.pr?.gates === 'passed' ? { value: true } : { value: false, detail: item.pr?.checking ? `the Factory is still checking ${sha}` : item.pr?.gates === 'failed' ? `they failed on ${sha}` : `none ran on ${sha}` },
    };
  }

  /** What a `when` check reads (WHEN_FACTS): the item, its spec's sections, and counts of its stories, pull requests, defects. */
  async function whenContext(item) {
    const { body, history, ...fields } = item;
    let sections = {};
    const product = item.system === 'product' ? host.service?.('product') : null;
    if (typeof product?.specSections === 'function') {
      try {
        sections = (await product.specSections(item.id)) ?? {};
      } catch (err) {
        log.warn(`specSections(${item.id}) failed: ${err.message}`);
      }
    }
    const all = await repos.items.list();
    const children = (type) => all.filter((i) => i.type === type && i.parentId === item.id && i.status !== 'withdrawn');
    const stories = children('story');
    const prs = children('pr');
    return {
      item: fields,
      spec: { sections },
      stories: { count: stories.length, active: stories.filter((s) => s.status === 'active').length },
      pullRequests: { count: prs.length, open: prs.filter((p) => p.status === 'active').length },
      defects: { open: children('defect').filter((d) => d.status === 'active').length },
    };
  }

  /**
   * The checks (resolved, as resolve() returns them) worked out for an item: { passed, total, checks, failing, source }.
   * A source with no work for the item drops its checks. Product's facts that carry their own words (Phase 18: a spec's
   * open questions) are checks of that item only, added after the listed ones.
   */
  async function evaluate(item, checks) {
    const sources = [...new Set(checks.map((c) => c.source))].filter((s) => s !== 'when');
    const facts = Object.fromEntries(await Promise.all(sources.map(async (s) => [s, await factsOf(s, item)])));
    const context = checks.some((c) => c.source === 'when') ? await whenContext(item) : null;
    const view = [];
    for (const c of checks) {
      if (c.source === 'when') {
        let ok = false;
        try {
          ok = Boolean(c.test(context));
        } catch (err) {
          log.warn(`check ${c.key} on ${item.id}: ${err.message}`);
        }
        view.push({ key: c.key, passed: ok, text: ok ? c.passed : c.failed });
        continue;
      }
      const f = facts[c.source];
      if (!f) continue;
      const result = f.results[c.key];
      const failed = f.details[c.key] ? `${c.failed}: ${f.details[c.key]}` : c.failed;
      view.push({ key: c.key, passed: result === true, text: result === true ? c.passed : result === false ? failed : `${c.passed}: not checked yet` });
    }
    if (facts.product) {
      for (const [key, fact] of Object.entries(facts.product.raw)) {
        if (!fact?.check?.passed || !fact?.check?.failed || view.some((c) => c.key === key) || checks.some((c) => c.key === key)) continue;
        const result = fact.value;
        const failed = fact.detail ? `${fact.check.failed}: ${fact.detail}` : fact.check.failed;
        view.push({ key, passed: result === true, text: result === true ? fact.check.passed : result === false ? failed : `${fact.check.passed}: not checked yet` });
      }
    }
    const failing = view.filter((c) => !c.passed);
    const used = sources.filter((s) => facts[s]);
    return { passed: view.length - failing.length, total: view.length, checks: view, failing, source: used.length === 1 ? (used[0] === 'pr' || used[0] === 'engineering' ? 'factory' : used[0]) : used.length ? 'mixed' : view.length ? 'when' : 'none' };
  }

  return { register, list, resolve, evaluate, get version() { return version; } };
}
