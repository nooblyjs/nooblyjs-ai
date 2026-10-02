// @ts-check
// Phase F18: which EVENTS are worth telling a person about, and in what words.
//
//   inbox.opened (approval, question, policy, scope)  → "inbox.opened"      a person is needed
//   inbox.opened (escalation)                         → "run.escalated"     the factory gave up
//   run.finished delivered                            → "run.delivered"     a PR to review
//   run.finished (a failure)                          → "run.failed"
//   run.merged                                        → "run.merged"
//   budget.exceeded                                   → "budget.exceeded"   work waits on money
//
// Everything else (steps starting, agents typing) is for the dashboard, not a channel.
// Bring humans in only when they're needed: every ping should be something to DO.

/** @typedef {{ kind: string, title: string, text: string, runId: string | null, slug: string | null, seq: number, at: string }} Notification */

const FAILED = ['agent_failed', 'gate_failed', 'changes_requested', 'error', 'no_changes'];

/**
 * @param {import('../store/events.js').FactoryEvent} e
 * @param {import('../store/events.js').Store} store
 * @returns {Notification | null}
 */
export function toNotification(e, store) {
  const d = /** @type {any} */ (e.data);
  const run = d.runId ? store.get('runs', d.runId) : null;
  const base = { runId: d.runId ?? null, slug: run?.slug ?? run?.request?.forge?.name ?? null, seq: e.seq, at: e.at };
  const title = run?.title ?? d.runId ?? '';
  switch (e.type) {
    case 'inbox.opened':
      if (d.kind === 'escalation') return { ...base, kind: 'run.escalated', title: `🆘 Needs a person: ${title}`, text: `${d.title}\n${firstLine(d.body)}\n→ factory inbox (${d.inboxId})` };
      return { ...base, kind: 'inbox.opened', title: `🙋 ${d.kind === 'question' ? 'A question' : d.kind === 'policy' ? 'A permission' : 'An approval'} for: ${title}`, text: `${d.title}\n→ factory inbox (${d.inboxId}), or the dashboard` };
    case 'run.finished':
      if (d.status === 'delivered') return { ...base, kind: 'run.delivered', title: `✅ Ready for review: ${title}`, text: `${d.pr ?? d.head ?? ''}\n$${(run?.costUsd ?? 0).toFixed(2)}` };
      if (FAILED.includes(d.status)) return { ...base, kind: 'run.failed', title: `❌ ${d.status}: ${title}`, text: `${d.pr ? `Draft PR: ${d.pr}\n` : ''}→ factory logs ${d.runId}` };
      return null;
    case 'run.merged':
      return { ...base, kind: 'run.merged', title: `🔀 Merged: ${title}`, text: d.by ? `by ${d.by}` : '' };
    case 'budget.exceeded':
      return { ...base, kind: 'budget.exceeded', title: '💸 Budget reached: work is waiting', text: d.reason };
    default:
      return null;
  }
}

const firstLine = (s) => String(s ?? '').split('\n').find((l) => l.trim())?.slice(0, 200) ?? '';

/**
 * One or more notifications → the JSON a target expects.
 *   slack    { text }      (Slack and Mattermost incoming webhooks)
 *   discord  { content }   (Discord webhooks; 2000 characters at most)
 *   json     { notifications: [...] }   (your own endpoint)
 * @param {'slack' | 'discord' | 'json'} format
 * @param {Notification[]} batch
 */
export function formatBatch(format, batch) {
  if (format === 'json') return { notifications: batch };
  const one = (n) => `*${n.title}*${n.text ? `\n${n.text}` : ''}`;
  const text = batch.length === 1 ? one(batch[0]) : `*factory: ${batch.length} updates*\n\n${batch.map(one).join('\n\n')}`;
  if (format === 'discord') return { content: text.replace(/\*(.+?)\*/g, '**$1**').slice(0, 1990) };
  return { text };
}
