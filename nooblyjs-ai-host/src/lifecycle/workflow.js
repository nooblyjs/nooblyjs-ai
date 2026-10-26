// Phase 27: the workflow as configuration (root design.md §13). Three files in data/workflows/ say how work moves:
//
//   lifecycle.yaml        the stages in order: each one's key, label, area, kind, how it is left (`exit`) and its checks
//   approval-rules.yaml   who approves what (product.md §4)
//   readiness.yaml        how long is "waiting too long"; and, for a data folder from before, each stage's checks
//
// They are read on every use, so an edit applies without a restart, and checked whenever they change. A file that fails
// its check is refused: the last good version keeps running (this process's, else the copy in applied/, else the
// built-in one), and the reasons are logged and shown on Platform · Settings · Workflow. A change that applies is
// recorded as `workflow.changed`, saying what changed in words. What stays code: the KINDS of stage (stages.js), the
// evaluators behind checks (evaluators.js), and the rules the engine enforces whatever the files say (agents never
// decide; a Viewer never approves; a rule that needs two people needs two different givers).
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { BUILT_IN_STAGES, KINDS, LEGACY, useStages, stageLabel } from './stages.js';
import { parseRules, BUILT_IN_READINESS, READINESS_BEFORE } from './config.js';

export const FILES = { lifecycle: 'lifecycle.yaml', rules: 'approval-rules.yaml', readiness: 'readiness.yaml' };
const APPLIED = 'applied';
const DONE = 'done';

/** How each built-in stage is left. */
const BUILT_IN_EXITS = {
  discover: 'idea', product: 'spec', design: 'design-handoff', engineer: 'engineering-signoff', build: 'build-approval',
  test: 'test-approval', release: 'deploy', operate: 'outcome-review',
};
/**
 * The gates the code acts on, by the kind of the stage they leave: the Engineering sign-off sends the work to the
 * Software Factory, the Build and Test approvals are a pull request's, the deploy and the outcome review are Operations'.
 * A stage of one of these kinds keeps its gate, and no other stage may use it.
 */
const BOUND_EXITS = { engineer: 'engineering-signoff', build: 'build-approval', test: 'test-approval', release: 'deploy', operate: 'outcome-review' };
const BOUND_RULES = new Set(Object.values(BOUND_EXITS));

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STAGE_KEY = /^[a-z][a-z0-9-]{0,30}$/;

/** The built-in lifecycle as the file would say it (no checks: readiness.yaml says them). */
export function builtInLifecycleDoc() {
  return {
    stages: BUILT_IN_STAGES.map((s) => ({
      key: s.key, label: s.label, ...(s.area !== s.label ? { area: s.area } : {}), kind: s.kind,
      exit: s.kind === 'operate' ? { rule: BUILT_IN_EXITS[s.kind], to: DONE } : BUILT_IN_EXITS[s.kind],
    })),
  };
}

/**
 * @param {object} o
 * @param {object} o.repos        the lifecycle's repositories (readText, writeText, items)
 * @param {object} o.host         for host.permissions() / host.roleNames(), when the host offers them
 * @param {object} o.log
 * @param {object} o.evaluators   evaluators.js
 * @param {() => string} o.now
 * @param {Function} o.emit       (type, payload, actorId)
 * @param {Function} o.audit      (entry)
 */
export function createWorkflow({ repos, host, log, evaluators, now, emit, audit }) {
  // Each file's state: { file, status: 'built-in' | 'applied' | 'refused', errors, warnings, since, appliedAt, hash }.
  const state = Object.fromEntries(Object.values(FILES).map((f) => [f, { file: f, status: 'built-in', errors: [], warnings: [], since: null, appliedAt: null }]));
  const lastGood = {};
  let cached = null;
  let inflight = null;

  /** What exists to name: { permissions, roles }, or null when the host can't say (then nothing is checked against it). */
  async function known() {
    const permissions = typeof host.permissions === 'function' ? await host.permissions() : null;
    const roles = typeof host.roleNames === 'function' ? await host.roleNames() : null;
    return permissions || roles ? { permissions, roles } : null;
  }

  /** The workflow in use: { stages, rules, thresholds, exitOf, moveFor, checksOf, pullRequestChecks, status }. */
  async function current() {
    const texts = await Promise.all(Object.values(FILES).map((f) => repos.readText([f])));
    const names = await known();
    const signature = hash([...texts.map((t) => t ?? '\u0000'), JSON.stringify(names), String(evaluators.version)].join('\u0001'));
    if (cached?.signature === signature) {
      useStages(cached.value.stages);
      return cached.value;
    }
    if (inflight?.signature !== signature) {
      const promise = build(texts, names).then((value) => {
        cached = { signature, value };
        return value;
      }).finally(() => {
        if (inflight?.promise === promise) inflight = null;
      });
      inflight = { signature, promise };
    }
    const value = await inflight.promise;
    useStages(value.stages);
    return value;
  }

  async function build([lifecycleText, rulesText, readinessText], names) {
    const rules = await processFile(FILES.rules, rulesText, async (doc) => {
      const parsed = parseRules(doc, names);
      return { value: { rules: parsed.rules, disabled: parsed.disabled }, errors: parsed.errors, warnings: parsed.warnings };
    }, () => {
      const parsed = parseRules(null, names);
      return { rules: parsed.rules, disabled: parsed.disabled };
    }, diffRules);
    const readiness = await processFile(FILES.readiness, readinessText, async (doc) => checkReadiness(doc), () => ({ waitingTooLongDays: 3, stages: {} }), diffReadiness);
    const lifecycle = await processFile(FILES.lifecycle, lifecycleText, async (doc) => checkLifecycle(doc, rules), async () => {
      // No lifecycle.yaml (a data folder from before Phase 27): the built-in stages, each left as it always was.
      const checked = await checkLifecycle(builtInLifecycleDoc(), rules, { builtIn: true });
      return checked.value;
    }, diffLifecycle);
    return compose(lifecycle, rules, readiness);
  }

  /**
   * One file: parsed, checked, then applied (the applied copy written, a change recorded) or refused (the last good used).
   * `check(doc)` resolves with { value, errors, warnings }; `fallback()` is the value when there is no file, or nothing
   * good to fall back on; `diff(before, after)` says what changed, in words.
   */
  async function processFile(file, text, check, fallback, diff) {
    const s = state[file];
    if (text === null || text === undefined) {
      const value = await fallback();
      Object.assign(s, { status: 'built-in', errors: [], warnings: [], since: null, hash: null });
      lastGood[file] = value;
      return value;
    }
    const h = hash(text);
    let doc;
    try {
      doc = yaml.load(text, { schema: yaml.CORE_SCHEMA }) ?? null;
    } catch (err) {
      return refuse(file, h, [{ where: `line ${(err.mark?.line ?? 0) + 1}`, message: `the YAML doesn't read: ${err.reason ?? err.message}` }], fallback, check);
    }
    let checked;
    try {
      checked = await check(doc);
    } catch (err) {
      checked = { errors: [{ where: 'the file', message: err.message }] };
    }
    if (checked.errors?.length) return refuse(file, h, checked.errors, fallback, check);
    for (const w of checked.warnings ?? []) if (!s.warnings.some((x) => x.where === w.where && x.message === w.message)) log.warn(`${file}: ${w.where}: ${w.message}`);
    await applied(file, text, h, checked.value, check, diff);
    Object.assign(s, { status: 'applied', errors: [], warnings: checked.warnings ?? [], since: null, hash: h });
    lastGood[file] = checked.value;
    return checked.value;
  }

  async function refuse(file, h, errors, fallback, check) {
    const s = state[file];
    // The same file refused for the same reasons is said once (the reasons can change with the other files).
    const same = s.status === 'refused' && s.hash === h && JSON.stringify(s.errors) === JSON.stringify(errors);
    if (!same) {
      for (const e of errors) log.error(`${file} is refused, the last good version keeps running: ${e.where}: ${e.message}`);
      Object.assign(s, { status: 'refused', errors, warnings: [], since: now(), hash: h });
      await audit({ actor: 'system', action: 'workflow.refused', target: file, errors: errors.map((e) => `${e.where}: ${e.message}`) });
    }
    if (lastGood[file] !== undefined) return lastGood[file];
    // A fresh start with a broken file: the copy that applied last time, if it still passes, else the built-in.
    const copy = await repos.readText([APPLIED, file]);
    if (copy) {
      try {
        const checked = await check(yaml.load(copy, { schema: yaml.CORE_SCHEMA }) ?? null);
        if (!checked.errors?.length) {
          lastGood[file] = checked.value;
          return checked.value;
        }
      } catch { /* fall through to the built-in */ }
    }
    lastGood[file] = await fallback();
    return lastGood[file];
  }

  /** Keeps applied/<file> as the version in use, and records a change from the one before. */
  async function applied(file, text, h, value, check, diff) {
    const before = await repos.readText([APPLIED, file]);
    if (before === text) return;
    await repos.writeText([APPLIED, file], text);
    state[file].appliedAt = now();
    if (before === null) return; // the first time this folder's file is seen: nothing changed
    let old = null;
    try {
      old = (await check(yaml.load(before, { schema: yaml.CORE_SCHEMA }) ?? null)).value ?? null;
    } catch { /* the old copy no longer reads: say only that the file changed */ }
    const changes = old ? diff(old, value) : [];
    const summary = `changed the workflow (${file})${changes.length ? `: ${changes.join('; ')}` : ''}`;
    log.info(summary);
    await audit({ actor: 'system', action: 'workflow.changed', target: file, changes, hash: h });
    await emit('workflow.changed', { file, changes, actorName: 'Workflow', summary }, 'system');
  }

  // ---------------------------------------------------------------------------- the checks of each file

  function checkReadiness(doc) {
    const errors = [];
    if (doc !== null && (typeof doc !== 'object' || Array.isArray(doc))) return { errors: [{ where: 'the file', message: 'it should be a map with waitingTooLongDays and stages' }] };
    const days = doc?.waitingTooLongDays;
    if (days !== undefined && !(Number(days) > 0)) errors.push({ where: 'waitingTooLongDays', message: 'it should be a number of days above 0' });
    const stages = doc?.stages ?? {};
    if (typeof stages !== 'object' || Array.isArray(stages)) errors.push({ where: 'stages', message: 'it should map each stage to its checks' });
    const resolved = {};
    for (const [stage, list] of Object.entries(typeof stages === 'object' && !Array.isArray(stages) ? stages : {})) {
      if (!Array.isArray(list)) { errors.push({ where: `stages.${stage}`, message: 'it should be a list of checks' }); continue; }
      const kind = stage === 'pull-request' ? 'pull-request' : KINDS.includes(stage) ? stage : LEGACY[stage] ?? null;
      resolved[stage] = resolveList(list, { kind, legacy: true }, `stages.${stage}`, errors);
    }
    return { value: { waitingTooLongDays: Number(days) || 3, stages: resolved }, errors };
  }

  function resolveList(list, options, where, errors) {
    const out = [];
    for (const [i, entry] of list.entries()) {
      try {
        const check = evaluators.resolve(entry, options);
        if (out.some((c) => c.key === check.key)) errors.push({ where: `${where}[${i + 1}]`, message: `the check ${check.key} is listed twice` });
        else out.push(check);
      } catch (err) {
        errors.push({ where: `${where}[${i + 1}]`, message: err.message });
      }
    }
    return out;
  }

  async function checkLifecycle(doc, rulesValue, { builtIn = false } = {}) {
    const errors = [];
    const warnings = [];
    const { rules, disabled } = rulesValue;
    const list = doc?.stages;
    if (!Array.isArray(list) || !list.length) return { errors: [{ where: 'stages', message: 'it should be the list of stages, in order' }] };
    const seen = new Set();
    const kinds = new Set();
    const stages = [];
    const gone = [];
    for (const [i, s] of list.entries()) {
      const where = `stage ${s?.key ?? `number ${i + 1}`}`;
      if (!s || typeof s !== 'object') { errors.push({ where, message: 'a stage needs a key and a label' }); continue; }
      if (!STAGE_KEY.test(String(s.key ?? ''))) { errors.push({ where, message: 'it needs a key in lower case with dashes' }); continue; }
      if (LEGACY[s.key] || s.key === DONE) { errors.push({ where, message: `"${s.key}" is a stage key from before (or "done"): pick another` }); continue; }
      if (seen.has(s.key)) { errors.push({ where, message: 'the key is listed twice' }); continue; }
      seen.add(s.key);
      if (s.enabled === false) {
        if (s.kind) errors.push({ where, message: `a stage of the kind ${s.kind} can't be switched off: the code needs it (rename it, or change its checks and gate)` });
        gone.push(s.key);
        continue;
      }
      if (typeof s.label !== 'string' || !s.label.trim() || s.label.length > 40) errors.push({ where, message: 'it needs a label of up to 40 characters' });
      if (s.area !== undefined && (typeof s.area !== 'string' || !s.area.trim())) errors.push({ where, message: 'its area should be words, like "Engineering"' });
      if (s.kind !== undefined && s.kind !== null) {
        if (!KINDS.includes(s.kind)) errors.push({ where, message: `there is no kind "${s.kind}": the kinds are ${KINDS.join(', ')}` });
        else if (kinds.has(s.kind)) errors.push({ where, message: `there is already a stage of the kind ${s.kind}` });
        else kinds.add(s.kind);
      }
      stages.push({ key: s.key, label: String(s.label ?? s.key).trim(), area: String(s.area ?? s.label ?? s.key).trim(), kind: KINDS.includes(s.kind) ? s.kind : null, raw: s, where });
    }
    // Every kind once, in the order the code needs them.
    const order = stages.filter((s) => s.kind).map((s) => s.kind);
    for (const k of KINDS) if (!order.includes(k)) errors.push({ where: 'stages', message: `there is no stage of the kind ${k}: the code needs one (a stage named "kind: ${k}")` });
    if (order.join() !== KINDS.filter((k) => order.includes(k)).join()) errors.push({ where: 'stages', message: `the kinds must come in this order: ${KINDS.join(' → ')}` });

    // How each stage is left.
    const usedRules = new Map();
    for (const [i, s] of stages.entries()) {
      const raw = s.raw.exit;
      let rule = typeof raw === 'string' ? raw : raw?.rule ?? 'stage';
      let to = typeof raw === 'object' && raw ? raw.to ?? null : null;
      if (raw !== undefined && typeof raw !== 'string' && (typeof raw !== 'object' || Array.isArray(raw) || raw === null)) {
        errors.push({ where: `${s.where}, exit`, message: 'exit is a rule key, or { rule, to }' });
      }
      const bound = BOUND_EXITS[s.kind];
      if (bound && disabled.has(bound)) errors.push({ where: `${s.where}, exit`, message: `${bound} can't be switched off in approval-rules.yaml: the code acts on it` });
      if (bound && rule !== bound) errors.push({ where: `${s.where}, exit`, message: `a stage of the kind ${s.kind} is left by ${bound}: the code acts on it` });
      if (!bound && BOUND_RULES.has(rule)) errors.push({ where: `${s.where}, exit`, message: `${rule} leaves the stage of the kind ${Object.keys(BOUND_EXITS).find((k) => BOUND_EXITS[k] === rule)}: pick another rule` });
      if (rule !== 'stage') {
        if (disabled.has(rule)) {
          warnings.push({ where: `${s.where}, exit`, message: `${rule} is switched off in approval-rules.yaml, so ${s.label} is left with the plain stage approval` });
          rule = 'stage';
        } else if (!rules.has(rule)) {
          errors.push({ where: `${s.where}, exit`, message: `there is no rule "${rule}" in approval-rules.yaml` });
        } else if (rules.get(rule).retired) {
          errors.push({ where: `${s.where}, exit`, message: `${rule} is retired: pick another rule` });
        }
      }
      if (rule !== 'stage') {
        if (usedRules.has(rule)) errors.push({ where: `${s.where}, exit`, message: `${rule} already leaves ${usedRules.get(rule)}: a rule leaves one stage` });
        usedRules.set(rule, s.key);
      }
      const next = stages[i + 1]?.key ?? DONE;
      if (to === null) to = next;
      else if (to !== DONE && !stages.slice(i + 1).some((x) => x.key === to)) {
        errors.push({ where: `${s.where}, exit`, message: `it goes to "${to}", which is not a later stage (or "done")` });
      }
      if (rule === 'stage' && to !== next) errors.push({ where: `${s.where}, exit`, message: 'the plain stage approval goes to the next stage: name a rule to go elsewhere' });
      s.exit = { rule, to };
    }
    if (stages.length && stages.at(-1).exit.to !== DONE) errors.push({ where: `stage ${stages.at(-1).key}`, message: 'the last stage has no way out: its exit goes to "done"' });

    // Checks.
    for (const s of stages) {
      if (s.raw.checks !== undefined) {
        if (!Array.isArray(s.raw.checks)) errors.push({ where: `${s.where}, checks`, message: 'it should be a list' });
        else s.checks = resolveList(s.raw.checks, { kind: s.kind }, `${s.where}, checks`, errors);
      }
      if (s.raw.pullRequestChecks !== undefined) {
        if (s.kind !== 'test') errors.push({ where: `${s.where}, pullRequestChecks`, message: 'only the stage of the kind test has pull request checks' });
        else if (!Array.isArray(s.raw.pullRequestChecks)) errors.push({ where: `${s.where}, pullRequestChecks`, message: 'it should be a list' });
        else s.pullRequestChecks = resolveList(s.raw.pullRequestChecks, { kind: 'pull-request' }, `${s.where}, pullRequestChecks`, errors);
      }
    }

    // A stage that goes away while an item is in it: move the items first (the default of 2026-10-26).
    if (!builtIn && !errors.length) {
      const keys = new Set(stages.map((s) => s.key));
      const stranded = (await repos.items.list()).filter((i) => i.status === 'active' && !keys.has(i.stage) && !LEGACY[i.stage]);
      if (stranded.length) {
        const byStage = new Map();
        for (const i of stranded) byStage.set(i.stage, [...(byStage.get(i.stage) ?? []), i.ref ?? i.id]);
        for (const [stage, ids] of byStage) {
          errors.push({ where: `stage ${stage}`, message: `it is gone while ${plural(ids.length, 'item is', 'items are')} in it (${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ', …' : ''}): move them first` });
        }
      }
    }
    return {
      value: { stages: stages.map(({ key, label, area, kind, exit, checks, pullRequestChecks }) => ({ key, label, area, kind, exit, checks: checks ?? null, pullRequestChecks: pullRequestChecks ?? null })), gone },
      errors, warnings,
    };
  }

  // ---------------------------------------------------------------------------- the workflow in use

  function compose(lifecycle, rulesValue, readiness) {
    const stages = lifecycle.stages;
    const byKey = new Map(stages.map((s) => [s.key, s]));
    const byKind = new Map(stages.filter((s) => s.kind).map((s) => [s.kind, s]));
    // A built-in stage with no checks of its own in lifecycle.yaml: readiness.yaml's (under its key, or the one from
    // before lifecycle v3), else the built-in ones.
    const fromReadiness = (s) => {
      const listed = readiness.stages[s.key] ?? (s.kind ? readiness.stages[READINESS_BEFORE[s.kind]] : undefined);
      if (listed) return listed;
      return s.kind && BUILT_IN_READINESS[s.kind] ? BUILT_IN_READINESS[s.kind].map((c) => evaluators.resolve(c, { kind: s.kind, legacy: true })) : [];
    };
    const checks = new Map(stages.map((s) => [s.key, s.checks ?? fromReadiness(s)]));
    const testStage = byKind.get('test');
    const pullRequestChecks = testStage?.pullRequestChecks ?? readiness.stages['pull-request'] ?? BUILT_IN_READINESS['pull-request'].map((c) => evaluators.resolve(c, { kind: 'pull-request', legacy: true }));
    const moves = new Map();
    for (const s of stages) if (s.exit.rule !== 'stage') moves.set(s.exit.rule, s.exit.to === DONE ? 'complete' : s.exit.to);
    // The Build approval's key from before (merge) still moves an older open one.
    if (byKind.get('build')) moves.set('merge', moves.get('build-approval'));
    return {
      stages,
      rules: rulesValue.rules,
      disabledRules: rulesValue.disabled,
      thresholds: { waitingTooLongDays: readiness.waitingTooLongDays },
      stage: (key) => byKey.get(key) ?? null,
      stageOfKind: (kind) => byKind.get(kind)?.key ?? null,
      /** How a stage is left: { rule, to }, `to` being a stage key or 'complete'. */
      exitOf: (key) => {
        const s = byKey.get(key);
        if (!s) return { rule: 'stage', to: null };
        return { rule: s.exit.rule, to: s.exit.to === DONE ? 'complete' : s.exit.to };
      },
      /** Where an approved rule moves its item: a stage key, 'complete', or undefined when it moves nothing. */
      moveFor: (rule) => moves.get(rule),
      checksOf: (key) => checks.get(key) ?? [],
      pullRequestChecks,
    };
  }

  // ---------------------------------------------------------------------------- what changed, in words

  function diffLifecycle(a, b) {
    const out = [];
    const before = new Map(a.stages.map((s) => [s.key, s]));
    const after = new Map(b.stages.map((s) => [s.key, s]));
    for (const s of b.stages) if (!before.has(s.key)) out.push(`added the stage ${s.label}${s.kind ? '' : ` after ${b.stages[b.stages.indexOf(s) - 1]?.label ?? 'the start'}`}`);
    for (const s of a.stages) if (!after.has(s.key)) out.push(`removed the stage ${s.label}`);
    for (const s of b.stages) {
      const o = before.get(s.key);
      if (!o) continue;
      if (o.label !== s.label) out.push(`renamed ${o.label} to ${s.label}`);
      if (o.exit.rule !== s.exit.rule || o.exit.to !== s.exit.to) out.push(`${s.label} is left by ${s.exit.rule} to ${s.exit.to === DONE ? 'done' : stageLabel(s.exit.to)} (was ${o.exit.rule} to ${o.exit.to === DONE ? 'done' : stageLabel(o.exit.to)})`);
      const was = new Set((o.checks ?? []).map((c) => c.key));
      const is = new Set((s.checks ?? []).map((c) => c.key));
      const added = [...is].filter((k) => !was.has(k));
      const removed = [...was].filter((k) => !is.has(k));
      if (added.length) out.push(`${s.label} checks ${added.map((k) => `"${(s.checks.find((c) => c.key === k)).passed}"`).join(', ')}`);
      if (removed.length) out.push(`${s.label} no longer checks ${removed.join(', ')}`);
    }
    const order = (list) => list.map((s) => s.key).filter((k) => before.has(k) && after.has(k)).join();
    if (order(a.stages) !== order(b.stages)) out.push('changed the order of the stages');
    return out;
  }

  function diffRules(a, b) {
    const out = [];
    for (const [key, r] of b.rules) {
      const o = a.rules.get(key);
      if (!o) { out.push(`added the rule ${r.label ?? key}`); continue; }
      const fields = ['permission', 'quorum', 'approver', 'needsReadiness', 'remind'].filter((f) => JSON.stringify(o[f]) !== JSON.stringify(r[f]));
      if (JSON.stringify(o.target) !== JSON.stringify(r.target)) fields.push('target');
      if (JSON.stringify(o.slots ?? null) !== JSON.stringify(r.slots ?? null)) fields.push('slots');
      if (fields.length) out.push(`${r.label ?? key}: ${fields.map((f) => (f === 'target' ? `target ${r.targetText ?? JSON.stringify(r.target)}` : f === 'permission' ? `waits on "${r.permission}"` : `${f} ${JSON.stringify(r[f])}`)).join(', ')}`);
    }
    for (const [key, r] of a.rules) if (!b.rules.has(key)) out.push(`${b.disabled?.has(key) ? 'switched off' : 'removed'} the rule ${r.label ?? key}`);
    return out;
  }

  function diffReadiness(a, b) {
    const out = [];
    if (a.waitingTooLongDays !== b.waitingTooLongDays) out.push(`"waiting too long" is ${plural(b.waitingTooLongDays, 'day')} (was ${a.waitingTooLongDays})`);
    for (const stage of new Set([...Object.keys(a.stages), ...Object.keys(b.stages)])) {
      const was = (a.stages[stage] ?? []).map((c) => c.key).join();
      const is = (b.stages[stage] ?? []).map((c) => c.key).join();
      if (was !== is) out.push(`the checks of ${stageLabel(stage)} are ${is || 'none'}`);
    }
    return out;
  }

  /** Each file's state, for Platform · Settings · Workflow. */
  const status = () => Object.values(state).map((s) => ({ ...s, errors: [...s.errors], warnings: [...s.warnings] }));

  return { current, status };
}
