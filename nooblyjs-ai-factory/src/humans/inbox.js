// @ts-check
// Phase F12: the INBOX. Everything that waits for a person, in one place.
//
//   approval   "approve the spec for issue #3?"        approve / reject --feedback "…"
//   question   an agent asks something (F16's ask_human) answer "…"
//   policy     an agent was refused something only a person could allow:
//              "the builder wanted Bash(npm install:*)"  approve = add that rule for the role
//
// Entries are events (inbox.opened, inbox.answered) and a projection (the inbox table),
// like everything else: the story of who approved what, when, is kept forever.
//
// Waiting never blocks the line: a run that needs an answer PARKS (releases its
// lease; holds no slot, spends nothing), and the answer puts it back in the queue.
import { newId } from '../util/ids.js';

/**
 * @param {import('../store/events.js').Store} store
 * @param {{ runId: string, kind: 'approval' | 'question' | 'policy', gate?: string, title: string, body?: string, detail?: object }} entry
 */
export function openEntry(store, entry) {
  const inboxId = newId('ask');
  store.append(`run:${entry.runId}`, 'inbox.opened', { inboxId, ...entry });
  return inboxId;
}

/**
 * Record a person's answer. Returns the entry.
 * @param {'approved' | 'rejected' | 'answered' | 'dismissed'} decision
 */
export function answerEntry(store, inboxId, decision, { feedback, answer, by = process.env.USER ?? 'operator' } = {}) {
  const entry = store.get('inbox', inboxId);
  if (!entry) throw new Error(`No inbox entry "${inboxId}". See: factory inbox`);
  if (entry.status !== 'open') throw new Error(`${inboxId} was already ${entry.status}.`);
  if (decision === 'answered' && !String(answer ?? '').trim()) throw new Error('An answer needs some text.');
  if (decision === 'rejected' && !feedback?.trim()) throw new Error('A rejection needs --feedback: the agent redoing the work has to know what to change.');
  store.append(`run:${entry.runId}`, 'inbox.answered', { inboxId, runId: entry.runId, decision, feedback, answer, by });
  // Phase F16: an agent's request_scope, approved: the scope guard now allows those paths for this run.
  if (entry.gate === 'scope' && decision === 'approved') store.append(`run:${entry.runId}`, 'scope.granted', { runId: entry.runId, paths: entry.detail?.paths ?? [], reason: entry.detail?.reason, by });
  return store.get('inbox', inboxId);
}

/** Open entries, oldest first. */
export function openEntries(store) {
  return store.list('inbox').filter((e) => e.status === 'open').sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

/** A run's entries for one gate, newest first. */
export function entriesFor(store, runId, gate) {
  return store.list('inbox').filter((e) => e.runId === runId && e.gate === gate).sort((a, b) => b.openedAt.localeCompare(a.openedAt) || b.id.localeCompare(a.id));
}
