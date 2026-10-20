// What the screens show, in words (product.md §1: status is said in words, not colour alone). The API returns
// these texts ready to print; a `tone` only picks the second signal (a pill's colour).
import { KIND_LABEL } from '../util/ids.js';

export const LAYERS = [['edge', 'Edge'], ['compute', 'Compute'], ['data', 'Data'], ['messaging', 'Messaging'], ['security', 'Security'], ['observe', 'Observe']];
const STATE_LABEL = { new: 'New', changed: 'Changed', existing: 'Existing, shared', removed: 'Removed' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthName = (month) => MONTHS[Number(month.slice(5, 7)) - 1];

/** "$0.40", "$9", "$2,140". */
export function money(usd) {
  const value = Number(usd ?? 0);
  const cents = Math.abs(value) < 10 && value % 1 !== 0;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
}

/** "12 min ago", "3 h ago", "yesterday", "6 days ago". */
export function ago(iso, now) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const suiteText = (s) => (s.total > 1 ? `${s.suite} ${s.passed}/${s.total}` : `${s.suite} ${s.passed >= s.total ? 'passed' : 'failed'}`);
const failing = (tests) => (tests ?? []).filter((s) => s.passed < s.total);

/** The tests that ran in an environment: "e2e 41/42 · load passed", and whether anything is failing. */
export function testsView(env) {
  if (env.status === 'provisioning') return { text: 'Waiting', tone: 'neutral', suites: [] };
  const suites = (env.tests ?? []).map((s) => ({ ...s, text: suiteText(s), failing: s.failing ?? [], ok: s.passed >= s.total }));
  if (!suites.length) return { text: env.testsNote ?? 'No tests have run here', tone: env.testsTone ?? 'neutral', suites };
  return { text: suites.map((s) => s.text).join(' · '), tone: failing(env.tests).length ? 'warning' : 'success', suites };
}

export const deployedText = (env) => (env.deployed ?? []).map((d) => `${d.service} ${d.version}`).join(' · ');

/** One environment as a row of the table. `drift` is its open drift, `run` its run in progress. */
export function envView(env, { drift = null, run = null, now, mountPath }) {
  const provisioning = env.status === 'provisioning';
  const preview = env.kind === 'preview';
  const note = drift
    ? { text: `Drift: ${drift.summary}`, tone: 'warning' }
    : { text: env.note && preview ? `${env.repo} · ${env.note}` : env.note ?? (preview ? `${env.repo} · ${env.lifetime}` : env.designId ? `From design ${env.designId} v${env.designVersion}` : ''), tone: 'neutral' };
  const progress = provisioning ? run?.progress ?? 0 : null;
  return {
    name: env.name,
    kind: env.kind,
    kindLabel: KIND_LABEL[env.kind] ?? env.kind,
    product: env.product ?? null,
    status: env.status,
    statusText: provisioning ? `Provisioning · ${progress}%` : 'Live',
    progress,
    note,
    deployed: provisioning
      ? `Provisioning · ${progress}%`
      : preview && env.pr ? `PR #${env.pr} · ${ago(env.deployedAt, now)}` : deployedText(env) || 'Nothing deployed yet',
    tests: testsView(env),
    costPerDay: env.costPerDay ?? null,
    costText: env.costPerDay === undefined || env.costPerDay === null ? '—' : money(env.costPerDay),
    designId: env.designId ?? null,
    designVersion: env.designVersion ?? null,
    drift: drift && { id: drift.id, summary: drift.summary, detail: drift.detail },
    runId: run?.id ?? null,
    href: `${mountPath}/environments/${env.name}`,
  };
}

/** A design's status in words: who it waits for, or what was decided. */
export function designStatus(design) {
  if (design.status === 'waiting-approval') {
    const waiting = (design.approvals ?? []).find((a) => a.state === 'waiting');
    return { text: `Waiting for the ${(waiting?.role ?? 'approver').toLowerCase()}`, tone: 'warning' };
  }
  if (design.status === 'approved') return { text: `Approved · v${design.approvedVersion}`, tone: 'success' };
  if (design.status === 'changes-requested') return { text: 'Changes requested', tone: 'warning' };
  if (design.status === 'drafting') return { text: 'Being drafted', tone: 'info' };
  return { text: design.status ?? 'Unknown', tone: 'neutral' };
}

export const approvalView = (a, person, { canDecide = false } = {}) => ({
  role: a.role,
  // A waiting approval has no name yet: it is 'You' for someone who may decide, and the role alone for anyone else.
  name: a.personId ? (a.personId === person?.id ? 'You' : a.name ?? null) : a.state === 'waiting' && canDecide ? 'You' : null,
  state: a.state,
  stateText: a.state === 'approved' ? (a.via ? `Via ${a.via}` : 'Approved') : a.state === 'changes-requested' ? 'Asked for changes' : 'Waiting',
  tone: a.state === 'approved' ? 'success' : 'warning',
});

/** Resources grouped by layer, in the order the screen draws them. */
export function resourcesByLayer(design) {
  return LAYERS.map(([key, label]) => ({
    key,
    label,
    resources: (design.resources ?? []).filter((r) => r.layer === key).map((r) => ({
      key: r.key, name: r.name, detail: r.detail, state: r.state, stateLabel: STATE_LABEL[r.state] ?? r.state,
    })),
  })).filter((layer) => layer.resources.length);
}

export const runStatus = (run) => ({
  queued: { text: 'Queued', tone: 'neutral' },
  running: { text: `Provisioning · ${run.progress ?? 0}%`, tone: 'info' },
  done: { text: 'Provisioned', tone: 'success' },
  failed: { text: `Failed: ${run.error ?? 'see the log'}`, tone: 'danger' },
  cancelled: { text: run.cancelledBy ? `Cancelled by ${run.cancelledBy.name}` : 'Cancelled', tone: 'warning' },
}[run.status] ?? { text: run.status, tone: 'neutral' });

export const planText = (plan) => (plan ? `+${plan.add} to add · ~${plan.change} to change · ${plan.destroy} to destroy` : '');
