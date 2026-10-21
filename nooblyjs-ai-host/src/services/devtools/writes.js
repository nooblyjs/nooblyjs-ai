// The write gate (Phase 13): the one door every write to Jira or Bitbucket goes through. Jira and Bitbucket are
// production systems, so a write is sent only when every one of these is true, checked here and nowhere else:
//
//   1. the kind is one NooblyJS has (writer.js KINDS); there is none for merging, deleting or changing settings
//   2. it comes from NooblyJS itself (the lifecycle, the sync, the Software Factory's control plane), never an agent
//   3. the kind's own facts hold (an approved handoff; an issue NooblyJS linked; a factory branch on a repository where
//      Platform lets agents open pull requests)
//   4. the kind's rule allows it: automatic, off, or "needs approval" (an Approver decides it on Home · Approvals)
//   5. all three locks are open: the deployment (DEVTOOLS_WRITES=true), the system's mode (an Owner switched it from
//      Record only to Send), and a write credential for that system
//
// With a lock closed the write is RECORDED: NooblyJS keeps what it would have sent in the outbox and sends nothing.
// Every attempt, sent or not, is an outbox entry (data/devtools/outbox/<id>.yaml) and an audit record.
import { HttpError } from '../../util/errors.js';
import { newId } from '../../util/ids.js';
import { KINDS, SYSTEMS } from './writer.js';

export const MODES = Object.freeze(['record', 'send']);
export const RULES = Object.freeze(['automatic', 'approval', 'off']);
/** Which part of NooblyJS may ask for each kind. Nothing else may, whatever it says it is. */
const ASKERS = Object.freeze({
  'jira.create-issue': ['lifecycle'],
  'jira.transition': ['devtools-sync'],
  'jira.comment': ['devtools-sync'],
  'bitbucket.push-branch': ['factory'],
  'bitbucket.open-pr': ['factory'],
  'bitbucket.update-pr': ['factory'],
  // Phase 22: Operations, for a release a person has approved.
  'jira.fix-version': ['operations'],
  'bitbucket.tag': ['operations'],
});
const OUTBOX = ['devtools', 'outbox'];
const STATES = new Set(['recorded', 'waiting-approval', 'sent', 'failed', 'refused', 'discarded']);
const KEY = /^[A-Za-z0-9][A-Za-z0-9:._\/#-]{0,199}$/;
const STATE_WORDS = { recorded: 'Recorded, not sent', 'waiting-approval': 'Waiting for approval', sent: 'Sent', failed: 'Failed', refused: 'Refused', discarded: 'Discarded' };

const clip = (value, max = 300) => (value == null ? null : String(value).slice(0, max));

/**
 * @param {object} deps
 * @param {import('nooblyjs-core/src/store/fs-store.js').FsStore} deps.store
 * @param {boolean} deps.enabled                 the deployment's lock (DEVTOOLS_WRITES=true)
 * @param {() => Promise<{ modes: object, rules: object }>} deps.settings   from data/config/devtools.yaml
 * @param {(patch: object, actor: object) => Promise<void>} deps.saveSettings
 * @param {Record<string, (payload: object) => Promise<object>>} deps.performers  how each kind is sent, by kind
 * @param {Record<string, (request: object) => Promise<{ ok: boolean, message?: string }>>} deps.facts  what must hold, by kind
 * @param {(system: string) => boolean} deps.credential   is there a write credential for the system
 */
export function createWrites({ store, enabled = false, settings, saveSettings, performers, facts, credential, services = null, auditLog = null, events = null, clock = Date, log = null }) {
  const sentHooks = new Map(); // kind → [fn(entry)]
  const now = () => new Date(clock.now()).toISOString();
  const file = (id) => [...OUTBOX, `${id}.yaml`];
  let index = null; // key → id, loaded on first use

  async function all() {
    const names = (await store.list(OUTBOX).catch(() => [])).filter((n) => n.endsWith('.yaml'));
    const entries = (await Promise.all(names.map((n) => store.readYaml([...OUTBOX, n]).catch(() => null)))).filter(Boolean);
    return entries.sort((a, b) => (a.at < b.at ? 1 : -1));
  }
  async function byKey(key) {
    if (!index) index = new Map((await all()).filter((e) => e.key).map((e) => [e.key, e.id]));
    const id = index.get(key);
    return id ? store.readYaml(file(id)) : null;
  }
  async function save(entry) {
    const next = { ...entry, updatedAt: now() };
    await store.writeYaml(file(next.id), next);
    if (next.key) (index ??= new Map()).set(next.key, next.id);
    return next;
  }
  const audit = (action, entry, extra = {}) => auditLog?.record?.({
    actor: entry.actor?.id ?? 'system', action, target: `${entry.kind}:${entry.target ?? ''}`, itemId: entry.itemId ?? null, system: 'devtools',
    writeId: entry.id, kind: entry.kind, summary: entry.summary, ...extra,
  }).catch((err) => log?.warn?.(`devtools: audit of a write failed: ${err.message}`));
  const tell = (type, entry, extra = {}) => events?.emit?.(type, {
    writeId: entry.id, kind: entry.kind, system: 'platform', tool: KINDS[entry.kind]?.system ?? null, itemId: entry.itemId ?? null, target: entry.target ?? null,
    summary: extra.summary ?? entry.summary, actorName: 'NooblyJS', ...extra,
  }, { actor: 'system' }).catch((err) => log?.warn?.(`devtools: event for a write failed: ${err.message}`));

  /** The three locks for one system, and which one is closed (in words, for people). */
  async function locks(system) {
    const { modes } = await settings();
    const mode = modes[system] === 'send' ? 'send' : 'record';
    const hasCredential = Boolean(credential(system));
    const open = enabled && mode === 'send' && hasCredential;
    const why = !enabled ? 'This NooblyJS is not allowed to write (DEVTOOLS_WRITES is not set).'
      : mode !== 'send' ? `${system === 'jira' ? 'Jira' : 'Bitbucket'} is set to Record only.`
        : !hasCredential ? `No write credential is set for ${system === 'jira' ? 'Jira (JIRA_WRITE_API_TOKEN)' : 'Bitbucket (BITBUCKET_WRITE_API_TOKEN)'}.` : null;
    return { open, enabled, mode, hasCredential, why };
  }

  async function refuse(entry, reason, code = 'write_refused') {
    const saved = await save({ ...entry, state: 'refused', reason });
    await audit('devtools.write_refused', saved, { status: 'refused', reason });
    await tell('devtools.write_refused', saved, { reason, summary: `was refused: ${saved.summary} (${reason})` });
    return { ok: false, sent: false, state: 'refused', code, message: reason, entry: saved };
  }

  /** Carries a write out: sends it when the locks are open, records it when they are not. */
  async function carryOut(entry) {
    const system = KINDS[entry.kind].system;
    const lock = await locks(system);
    if (!lock.open) {
      const saved = await save({ ...entry, state: 'recorded', reason: lock.why });
      await audit('devtools.write_recorded', saved, { status: 'recorded', reason: lock.why });
      await tell('devtools.write_recorded', saved, { reason: lock.why, summary: `recorded, did not send: ${saved.summary}` });
      return { ok: true, sent: false, state: 'recorded', message: lock.why, entry: saved };
    }
    let result;
    try {
      result = await performers[entry.kind](entry.payload);
    } catch (err) {
      result = { ok: false, reason: 'failed', message: err.message };
    }
    if (!result?.ok) {
      const saved = await save({ ...entry, state: 'failed', reason: clip(result?.message ?? 'It failed.'), failure: result?.reason ?? 'failed', attempts: (entry.attempts ?? 0) + 1 });
      await audit('devtools.write_failed', saved, { status: 'failed', reason: saved.reason });
      await tell('devtools.write_failed', saved, { reason: saved.reason, summary: `could not send: ${saved.summary} (${saved.reason})` });
      return { ok: false, sent: false, state: 'failed', code: 'write_failed', message: saved.reason, entry: saved };
    }
    const saved = await save({ ...entry, state: 'sent', reason: null, sentAt: now(), attempts: (entry.attempts ?? 0) + 1, result: result.result ?? null });
    await audit('devtools.write_sent', saved, { status: 'sent', result: saved.result });
    await tell('devtools.write_sent', saved, { result: saved.result, summary: saved.summary });
    for (const fn of sentHooks.get(saved.kind) ?? []) {
      await Promise.resolve(fn(saved)).catch((err) => log?.warn?.(`devtools: after ${saved.kind}: ${err.message}`));
    }
    return { ok: true, sent: true, state: 'sent', result: saved.result, entry: saved };
  }

  /**
   * Ask for a write. Resolves with { ok, sent, state, entry, result?, message? }; it does not throw for a refusal.
   * @param {object} request
   * @param {string} request.kind      a kind from KINDS
   * @param {string} request.key       the same key twice is one write: a sent one is returned, never sent again
   * @param {{ type: 'system' | 'agent' | 'person', id: string }} request.actor  who asks; only NooblyJS's own parts may
   * @param {string} [request.itemId]  the lifecycle item it is for
   * @param {string} request.target    what it changes, for people ("DTE", "DTE-412", "acme/web-storefront")
   * @param {string} request.summary   one line: what will happen
   * @param {object} request.payload   what the performer needs; kept in the outbox, so no secrets
   * @param {object} [request.cause]   { handoffId, workItemId, runId, pr } the fact that makes it right
   */
  async function send(request = {}) {
    const { kind, key, actor, itemId = null, target = null, summary = '', payload = {}, cause = {} } = request;
    const base = {
      id: newId('wr'), key: KEY.test(String(key ?? '')) ? String(key) : null, kind: String(kind), itemId, target: clip(target, 200), summary: clip(summary, 300) ?? String(kind),
      payload, cause, actor: { type: actor?.type ?? 'unknown', id: clip(actor?.id, 80) ?? 'unknown' }, at: now(), attempts: 0,
    };
    if (!KINDS[kind]) return refuse({ ...base, kind: clip(kind, 60) }, `NooblyJS has no write called "${clip(kind, 60)}".`, 'unknown_kind');
    if (!base.key) return refuse(base, 'A write needs a key, so the same one is never sent twice.', 'no_key');
    // Agents propose, people decide: an agent never writes to Jira or Bitbucket, and nothing may pose as NooblyJS.
    if (base.actor.type !== 'system' || !ASKERS[kind].includes(base.actor.id)) {
      return refuse(base, base.actor.type === 'agent' ? 'An agent may not write to Jira or Bitbucket.' : `"${base.actor.id}" may not ask for ${KINDS[kind].label.toLowerCase()}.`, 'not_allowed');
    }
    const before = await byKey(base.key);
    if (before?.state === 'sent') return { ok: true, sent: true, state: 'sent', result: before.result, entry: before, existing: true };
    if (before?.state === 'waiting-approval') return { ok: true, sent: false, state: 'waiting-approval', entry: before, existing: true };
    if (before?.state === 'discarded') return { ok: false, sent: false, state: 'discarded', code: 'discarded', message: 'A person discarded this write.', entry: before, existing: true };
    const entry = before ? { ...before, payload, summary: base.summary, cause, target: base.target } : base;

    const fact = await facts[kind](request).catch((err) => ({ ok: false, message: err.message }));
    if (!fact.ok) return refuse(entry, fact.message, 'facts');

    const rule = (await settings()).rules[kind] ?? 'automatic';
    if (rule === 'off') return refuse(entry, `${KINDS[kind].label} is switched off in Platform · Settings · Integrations.`, 'rule_off');
    if (rule === 'approval') {
      if (!itemId) return refuse(entry, `${KINDS[kind].label} needs a person's approval, and this one belongs to no item to ask on.`, 'no_item');
      const workflows = services?.get?.('workflows');
      if (typeof workflows?.requestAppApproval !== 'function') return refuse(entry, 'Approvals are not available, so this write cannot be approved.', 'no_approvals');
      const saved = await save({ ...entry, state: 'waiting-approval', reason: null });
      try {
        const asked = await workflows.requestAppApproval({
          type: 'devtools-write', itemId, title: saved.summary, subject: `${KINDS[kind].label}: ${saved.target ?? ''}`.trim(),
          ref: { app: 'devtools', designId: saved.id, kind, kindLabel: KINDS[kind].system === 'jira' ? 'Jira' : 'Bitbucket' },
          link: '/platform/settings/integrations', context: `NooblyJS will ${saved.summary}. Nothing is sent until you approve.`,
        });
        const waiting = await save({ ...saved, approvalId: asked.approvalId });
        await audit('devtools.write_waiting', waiting, { status: 'waiting-approval', approvalId: asked.approvalId });
        return { ok: true, sent: false, state: 'waiting-approval', entry: waiting };
      } catch (err) {
        return refuse(saved, `The approval could not be asked for: ${err.message}`, 'no_approvals');
      }
    }
    return carryOut(entry);
  }

  async function entryOr404(id) {
    const entry = /^wr_[A-Za-z0-9_-]{4,40}$/.test(String(id)) ? await store.readYaml(file(id)).catch(() => null) : null;
    if (!entry) throw new HttpError(404, 'not_found', 'There is no such write.');
    return entry;
  }

  /**
   * The lifecycle engine carries an Approver's decision out (it has checked the person may approve; an agent never
   * gets here). Approve sends the write, or records it when a lock is closed; anything else discards it.
   */
  async function decideApproval({ designId, decision, comment = null, person } = {}) {
    const entry = await entryOr404(designId);
    if (entry.state !== 'waiting-approval') throw new HttpError(409, 'not_waiting', `That write is ${STATE_WORDS[entry.state]?.toLowerCase() ?? entry.state}; there is nothing to decide.`);
    if (!person?.id || person.kind === 'agent') throw new HttpError(403, 'forbidden', 'Only a person may approve a write to Jira or Bitbucket.');
    const decided = { ...entry, approvedBy: decision === 'approve' ? person.id : null, decision: { by: person.id, decision, comment: clip(comment), at: now() } };
    if (decision !== 'approve') {
      const saved = await save({ ...decided, state: 'discarded', reason: `${person.name ?? person.id} did not approve it${comment ? `: ${clip(comment)}` : ''}.` });
      await audit('devtools.write_discarded', saved, { status: 'discarded', by: person.id });
      return { state: 'discarded' };
    }
    const done = await carryOut(decided);
    if (done.state === 'failed') throw new HttpError(502, 'write_failed', `Approved, but it could not be sent: ${done.message} It is in the outbox to send again.`);
    return { state: done.state };
  }

  /** A person with the permission sends a recorded or failed write now (the route checks the permission). */
  async function retry(id, person) {
    const entry = await entryOr404(id);
    if (!person?.id || person.kind === 'agent') throw new HttpError(403, 'forbidden', 'Only a person may send a write.');
    if (!['recorded', 'failed'].includes(entry.state)) throw new HttpError(409, 'not_sendable', `That write is ${STATE_WORDS[entry.state]?.toLowerCase() ?? entry.state}.`);
    const fact = await facts[entry.kind]({ ...entry, actor: entry.actor }).catch((err) => ({ ok: false, message: err.message }));
    if (!fact.ok) throw new HttpError(409, 'facts', `It can no longer be sent: ${fact.message}`);
    const rule = (await settings()).rules[entry.kind] ?? 'automatic';
    if (rule === 'off') throw new HttpError(409, 'rule_off', `${KINDS[entry.kind].label} is switched off.`);
    if (rule === 'approval' && !entry.approvedBy) throw new HttpError(409, 'needs_approval', `${KINDS[entry.kind].label} needs an approval first.`);
    const lock = await locks(KINDS[entry.kind].system);
    if (!lock.open) throw new HttpError(409, 'writes_closed', `Nothing was sent. ${lock.why}`);
    await audit('devtools.write_retried', entry, { by: person.id });
    return carryOut({ ...entry, retriedBy: person.id });
  }

  async function discard(id, person) {
    const entry = await entryOr404(id);
    if (!person?.id || person.kind === 'agent') throw new HttpError(403, 'forbidden', 'Only a person may discard a write.');
    if (!['recorded', 'failed', 'waiting-approval'].includes(entry.state)) throw new HttpError(409, 'not_discardable', `That write is ${STATE_WORDS[entry.state]?.toLowerCase() ?? entry.state}.`);
    if (entry.state === 'waiting-approval') {
      await services?.get?.('workflows')?.withdrawAppApprovals?.({ type: 'devtools-write', ref: { app: 'devtools', designId: entry.id }, reason: `${person.name ?? person.id} discarded the write` });
    }
    const saved = await save({ ...entry, state: 'discarded', reason: `Discarded by ${person.name ?? person.id}.` });
    await audit('devtools.write_discarded', saved, { status: 'discarded', by: person.id });
    return saved;
  }

  const view = (e) => ({
    id: e.id, kind: e.kind, kindLabel: KINDS[e.kind]?.label ?? e.kind, system: KINDS[e.kind]?.system ?? null, state: e.state, stateText: STATE_WORDS[e.state] ?? e.state,
    itemId: e.itemId ?? null, target: e.target ?? null, summary: e.summary, reason: e.reason ?? null, at: e.at, updatedAt: e.updatedAt ?? e.at, sentAt: e.sentAt ?? null,
    result: e.result ?? null, attempts: e.attempts ?? 0, approvalId: e.approvalId ?? null, payload: e.payload ?? null,
  });

  const api = {
    send,
    retry,
    discard,
    decideApproval,
    /** Runs after a kind was sent, by any path (at once, after an approval, sent again by a person). */
    onSent(kind, fn) {
      if (!KINDS[kind]) throw new Error(`No write called ${kind}.`);
      sentHooks.set(kind, [...(sentHooks.get(kind) ?? []), fn]);
    },
    get: async (id) => view(await entryOr404(id)),
    byKey: async (key) => { const e = await byKey(String(key)); return e ? view(e) : null; },
    /** The outbox, newest first. */
    async outbox({ state = null, itemId = null, system = null, limit = 50 } = {}) {
      if (state && !STATES.has(state)) throw new HttpError(400, 'invalid_state', 'That is not an outbox state.');
      const entries = (await all()).filter((e) => (!state || e.state === state) && (!itemId || e.itemId === itemId) && (!system || KINDS[e.kind]?.system === system));
      const counts = {};
      for (const e of await all()) counts[e.state] = (counts[e.state] ?? 0) + 1;
      return { entries: entries.slice(0, Math.min(Math.max(Number(limit) || 50, 1), 200)).map(view), total: entries.length, counts };
    },
    /** What people see in Platform · Settings · Integrations. */
    async status() {
      const { modes, rules } = await settings();
      const systems = {};
      for (const system of SYSTEMS) {
        const lock = await locks(system);
        systems[system] = { mode: lock.mode, sending: lock.open, credential: lock.hasCredential, why: lock.why };
      }
      return {
        enabled, modes, systems,
        kinds: Object.entries(KINDS).map(([kind, k]) => ({ kind, label: k.label, system: k.system, rule: rules[kind] ?? 'automatic' })),
      };
    },
    /** An Owner switches a system between Record only and Send (the route checks the permission; audited). */
    async setMode(system, mode, person) {
      if (!SYSTEMS.includes(system) || !MODES.includes(mode)) throw new HttpError(400, 'invalid_mode', 'A system is jira or bitbucket, and its mode is record or send.');
      if (!person?.id || person.kind === 'agent') throw new HttpError(403, 'forbidden', 'Only a person may change whether NooblyJS writes.');
      const before = (await settings()).modes[system] ?? 'record';
      await saveSettings({ modes: { [system]: mode } });
      await auditLog?.record?.({ actor: person.id, action: 'devtools.write_mode_changed', target: system, system: 'devtools', before, after: mode, status: 'ok' });
      await events?.emit?.('devtools.write_mode_changed', { system, before, after: mode, actorName: person.name ?? person.id, summary: `set ${system === 'jira' ? 'Jira' : 'Bitbucket'} to ${mode === 'send' ? 'Send' : 'Record only'}` }, { actor: person.id });
      return api.status();
    },
    async setRule(kind, rule, person) {
      if (!KINDS[kind] || !RULES.includes(rule)) throw new HttpError(400, 'invalid_rule', 'A rule is automatic, approval or off, for a kind of write NooblyJS has.');
      if (!person?.id || person.kind === 'agent') throw new HttpError(403, 'forbidden', 'Only a person may change a write rule.');
      const before = (await settings()).rules[kind] ?? 'automatic';
      await saveSettings({ rules: { [kind]: rule } });
      await auditLog?.record?.({ actor: person.id, action: 'devtools.write_rule_changed', target: kind, system: 'devtools', before, after: rule, status: 'ok' });
      return api.status();
    },
  };
  return api;
}
