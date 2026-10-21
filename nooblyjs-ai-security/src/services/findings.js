// Findings (root product.md §3.5): a severity, an owner, a fix-by date from the policy, and a state:
//
//   open ──(Draft a fix as a PR)──► fixing ──(the fix run's scan passes for it)──► closed
//     │                                │
//     └──(a person accepts the risk, with a reason and an expiry)──► accepted ──(the expiry passes)──► open
//
// Closing needs proof: only a scan of the run made for the finding, without the finding in it, closes it. Accepting a
// risk is a person's decision with `accept-risk` (an Owner's for high and critical), never an agent's. Expiry is on the
// business clock (host.clock), checked whenever findings are read and by the sweep.
import { HttpError, badRequest, notFound, conflict } from '../util/errors.js';
import { isAgent, needs, peopleOnly, refuse } from '../util/http.js';
import { SEVERITY_LABEL, KIND_LABEL, atLeast } from '../util/ids.js';

const DAY_MS = 86_400_000;
const STATE_TEXT = { open: 'Open', fixing: 'Fix under way', closed: 'Closed', accepted: 'Risk accepted' };
const clean = (value, field, max = 1000) => {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required.`, { [field]: 'required' });
  if (value.trim().length > max) throw badRequest(`Keep ${field} under ${max} characters.`, { [field]: `max ${max}` });
  return value.trim();
};
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function createFindings({ repos, host, log, policies, now, mountPath }) {
  const iso = () => new Date(now()).toISOString();
  const emit = (type, payload, actor) => host.events.emit(type, payload, { actor: actor?.id ?? actor ?? null });
  const factory = () => host.service('factory');

  async function getOr404(id) {
    const f = await repos.findings.get(id);
    if (!f) throw notFound(`There is no finding ${id}.`);
    return f;
  }

  /** The fix-by date in words, against the business clock. */
  function fixByText(f, at = now()) {
    if (f.state === 'closed') return `Closed ${day(f.closedAt)}`;
    if (f.state === 'accepted') return `Risk accepted until ${day(f.acceptance.expiresAt)}`;
    const days = Math.ceil((new Date(f.fixBy).getTime() - at) / DAY_MS);
    if (days < 0) return `${-days} day${days === -1 ? '' : 's'} past its fix-by date (${day(f.fixBy)})`;
    return days === 0 ? `Fix by today (${day(f.fixBy)})` : `Fix by ${day(f.fixBy)} · in ${days} day${days === 1 ? '' : 's'}`;
  }

  async function nameOf(id) {
    if (!id) return null;
    return (await host.people.get(id).catch(() => null))?.name ?? id;
  }

  async function shape(f, at = now()) {
    const late = !['closed', 'accepted'].includes(f.state) && new Date(f.fixBy).getTime() < at;
    return {
      ...f, body: undefined,
      severityLabel: SEVERITY_LABEL[f.severity] ?? f.severity, kindLabel: KIND_LABEL[f.kind] ?? f.kind,
      stateText: STATE_TEXT[f.state] ?? f.state, fixByText: fixByText(f, at), late,
      ownerName: await nameOf(f.owner), href: `${mountPath}/findings/${f.id}`,
    };
  }

  /** Accepted risks whose expiry has passed are open again: recorded once, with an event and an audit record. */
  async function expireDue() {
    const at = now();
    for (const f of await repos.findings.list()) {
      if (f.state !== 'accepted' || new Date(f.acceptance?.expiresAt ?? 0).getTime() > at) continue;
      const done = await repos.findings.update(f.id, (cur) => (cur?.state !== 'accepted' || new Date(cur.acceptance?.expiresAt ?? 0).getTime() > at ? null : {
        ...cur, state: 'open', acceptance: { ...cur.acceptance, expired: true }, updatedAt: iso(),
        history: [...(cur.history ?? []), { at: iso(), what: `The risk acceptance by ${cur.acceptance.byName ?? cur.acceptance.by} expired; the finding is open again` }],
      }));
      if (!done) continue;
      await host.audit.record({ actor: null, action: 'risk.expired', target: f.id, acceptedBy: f.acceptance.by, expiresAt: f.acceptance.expiresAt });
      await emit('risk.expired', { findingId: f.id, itemId: f.subject?.itemId ?? null, acceptedBy: f.acceptance.by, expiresAt: f.acceptance.expiresAt });
      await emit('finding.reopened', { findingId: f.id, itemId: f.subject?.itemId ?? null, severity: f.severity, title: f.title, reason: 'its risk acceptance expired' });
    }
  }

  async function list({ state, itemId, repo } = {}) {
    await expireDue();
    const at = now();
    const all = (await repos.findings.list())
      .filter((f) => (!state || f.state === state) && (!itemId || f.subject?.itemId === itemId) && (!repo || f.subject?.repo === repo));
    // Open ones first, the most overdue at the top; then the rest by id.
    const rank = (f) => (f.state === 'closed' ? 2 : f.state === 'accepted' ? 1 : 0);
    all.sort((a, b) => rank(a) - rank(b) || new Date(a.fixBy) - new Date(b.fixBy) || a.id.localeCompare(b.id));
    return Promise.all(all.map((f) => shape(f, at)));
  }

  async function get(id) {
    await expireDue();
    return shape(await getOr404(id));
  }

  /**
   * One scan's finding: the open finding with the same fingerprint, or a new one with its owner and fix-by date. A
   * problem seen again after its finding closed is a new finding.
   */
  async function record(found, { repo, itemId, runId, sha, scanId, scanner }) {
    const open = (await repos.findings.list()).find((f) => f.fingerprint === found.fingerprint && f.state !== 'closed');
    if (open) return { finding: open, created: false };
    const p = await policies.read();
    const at = now();
    const finding = await repos.findings.create({
      title: found.title, kind: found.kind, rule: found.rule, severity: found.severity, state: 'open',
      subject: { itemId: itemId ?? null, repo, runId: runId ?? null, sha: sha ?? null, file: found.file ?? null, line: found.line ?? null },
      fingerprint: found.fingerprint, detail: found.detail, ...(found.fix ? { fixAs: found.fix } : {}),
      owner: policies.ownerFor(p, repo), openedAt: new Date(at).toISOString(), fixBy: policies.fixByFor(p, found.severity, at),
      source: { scanner, scanId },
      history: [{ at: new Date(at).toISOString(), what: `Opened by the ${scanner} scanner's ${KIND_LABEL[found.kind] ?? found.kind} scan of ${repo}${sha ? ` at ${sha.slice(0, 7)}` : ''}` }],
    });
    await emit('finding.opened', { findingId: finding.id, itemId: itemId ?? null, repo, severity: finding.severity, kind: finding.kind, title: finding.title, owner: finding.owner, fixBy: finding.fixBy, runId: runId ?? null });
    return { finding, created: true };
  }

  /** The proof: the fix run's scan no longer finds it. */
  async function closeWithProof(id, { scanId, runId, sha }) {
    const closed = await repos.findings.update(id, (cur) => (!cur || cur.state === 'closed' ? null : {
      ...cur, state: 'closed', closedAt: iso(), proof: { scanId, runId, sha: sha ?? null, text: `The scan of run ${runId}${sha ? ` at ${sha.slice(0, 7)}` : ''} no longer finds it` },
      updatedAt: iso(), history: [...(cur.history ?? []), { at: iso(), what: `Closed: the scan of the fix run ${runId} passes for it` }],
    }));
    if (!closed) return null;
    await host.audit.record({ actor: null, action: 'finding.closed', target: id, scanId, runId });
    await emit('finding.closed', { findingId: id, itemId: closed.subject?.itemId ?? null, title: closed.title, scanId, runId, proof: closed.proof.text });
    return closed;
  }

  /** "Draft a fix as a PR": a Software Factory run made for the finding, on its repository. */
  async function fix(id, person) {
    if (!person?.id) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
    await needs(host, person, 'draft', `ask for a fix of ${id}`);
    const f = await getOr404(id);
    if (f.state === 'closed') throw conflict(`${id} is closed already.`);
    if (f.state === 'fixing' && f.fix?.runId) throw conflict(`A fix for ${id} is under way already (run ${f.fix.runId}).`);
    const start = factory()?.startWork;
    if (typeof start !== 'function') throw new HttpError(503, 'factory_unavailable', 'The Software Factory is not running here, so no fix can be drafted.');
    const title = f.fixAs?.title ?? `Fix ${f.id}: ${f.title}`;
    const brief = `${f.id} (${SEVERITY_LABEL[f.severity]}): ${f.title}.\n\n${f.detail ?? ''}\n\n${f.fixAs?.brief ?? 'Fix it so the scan no longer finds it.'}`;
    const started = await start({ itemId: f.subject?.itemId ?? null, workItemId: f.id, title, repo: f.subject?.repo, brief, findingId: f.id, requestedBy: { id: person.id, name: person.name ?? person.id } });
    if (!started?.runId) throw new HttpError(409, 'fix_not_started', `No fix run started for ${id}: ${started?.waiting ?? 'the Software Factory said no'}.`);
    const updated = await repos.findings.update(id, (cur) => ({
      ...cur, state: cur.state === 'accepted' ? cur.state : 'fixing', fix: { runId: started.runId, title, askedBy: person.id, at: iso(), href: `/factory/runs/${started.runId}` }, updatedAt: iso(),
      history: [...(cur.history ?? []), { at: iso(), what: `${person.name ?? person.id} asked for a fix: Software Factory run ${started.runId} ("${title}")` }],
    }));
    await emit('finding.fix_requested', { findingId: id, itemId: f.subject?.itemId ?? null, runId: started.runId, title }, person);
    return shape(updated);
  }

  /** The fix run delivered its pull request: the finding links to it. */
  async function onRunFinished(payload = {}) {
    if (!payload.runId) return;
    const f = (await repos.findings.list()).find((x) => x.fix?.runId === payload.runId);
    if (!f) return;
    await repos.findings.update(f.id, (cur) => ({ ...cur, fix: { ...cur.fix, outcome: payload.outcome ?? null, pr: payload.pr ?? cur.fix?.pr ?? null }, updatedAt: iso() }));
  }

  /** A person accepts the risk: a reason and an expiry (at most the policy's days). */
  async function acceptRisk(id, body = {}, person) {
    const what = `accept the risk of ${id}`;
    if (!person?.id) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
    await peopleOnly(host, person, what);
    const f = await getOr404(id);
    const p = await policies.read();
    if (p.riskAcceptance.architectMay.includes(f.severity)) await needs(host, person, 'accept-risk', what);
    else if (person.accessRole !== 'Owner') {
      await refuse(host, person, { action: what, permission: 'accept-risk', reason: `a ${f.severity} risk needs an Owner`, message: `A ${SEVERITY_LABEL[f.severity].toLowerCase()} risk needs an Owner to accept it. Your access role is ${person.accessRole ?? 'none'}.` });
    }
    if (f.state === 'closed') throw conflict(`${id} is closed: there is no risk left to accept.`);
    if (f.state === 'accepted') throw conflict(`${id}'s risk is accepted already, until ${day(f.acceptance.expiresAt)}.`);
    const reason = clean(body.reason, 'reason');
    const days = Number(body.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > p.riskAcceptance.maxDays) throw badRequest(`Say for how many days, from 1 to ${p.riskAcceptance.maxDays}.`, { expiresInDays: `1–${p.riskAcceptance.maxDays}` });
    const at = now();
    const acceptance = { by: person.id, byName: person.name ?? person.id, reason, at: new Date(at).toISOString(), expiresAt: new Date(at + days * DAY_MS).toISOString(), days, stateBefore: f.state };
    const updated = await repos.findings.update(id, (cur) => ({
      ...cur, state: 'accepted', acceptance, acceptances: [...(cur.acceptances ?? []), acceptance], updatedAt: iso(),
      history: [...(cur.history ?? []), { at: iso(), what: `${acceptance.byName} accepted the risk for ${days} days: ${reason}` }],
    }));
    await host.audit.record({ actor: person.id, action: 'risk.accepted', target: id, reason, expiresAt: acceptance.expiresAt, severity: f.severity });
    await emit('risk.accepted', { findingId: id, itemId: f.subject?.itemId ?? null, severity: f.severity, reason, expiresAt: acceptance.expiresAt, days }, person);
    return shape(updated);
  }

  /** Another person owns it now. */
  async function setOwner(id, body = {}, person) {
    await needs(host, person, 'draft', `change who owns ${id}`);
    const owner = await host.people.get(String(body.owner ?? '')).catch(() => null);
    if (!owner?.active || isAgent(owner)) throw badRequest('Name a person to own it.', { owner: 'a person' });
    await getOr404(id);
    const updated = await repos.findings.update(id, (cur) => ({ ...cur, owner: owner.id, updatedAt: iso(), history: [...(cur.history ?? []), { at: iso(), what: `${person.name ?? person.id} gave it to ${owner.name}` }] }));
    await emit('finding.owner_changed', { findingId: id, itemId: updated.subject?.itemId ?? null, owner: owner.id }, person);
    return shape(updated);
  }

  /** The risk register: every acceptance, current and past. */
  async function risks() {
    await expireDue();
    const at = now();
    const rows = [];
    for (const f of await repos.findings.list()) {
      for (const a of f.acceptances ?? []) {
        const current = f.state === 'accepted' && f.acceptance?.at === a.at;
        const left = Math.ceil((new Date(a.expiresAt).getTime() - at) / DAY_MS);
        rows.push({
          findingId: f.id, title: f.title, severity: f.severity, severityLabel: SEVERITY_LABEL[f.severity], itemId: f.subject?.itemId ?? null, ...a,
          current, stateText: current ? `Accepted · ends ${day(a.expiresAt)} (in ${left} day${left === 1 ? '' : 's'})` : `Ended ${day(a.expiresAt)}`,
          href: `${mountPath}/findings/${f.id}`,
        });
      }
    }
    return rows.sort((a, b) => Number(b.current) - Number(a.current) || a.expiresAt.localeCompare(b.expiresAt));
  }

  /** Does this finding fail a gate that blocks at `blockAt`? An accepted risk doesn't, until it expires. */
  const blocks = (f, blockAt) => f.state !== 'accepted' && f.state !== 'closed' && atLeast(f.severity, blockAt);

  return { list, get, record, closeWithProof, fix, onRunFinished, acceptRisk, setOwner, risks, expireDue, blocks, shape, log };
}
