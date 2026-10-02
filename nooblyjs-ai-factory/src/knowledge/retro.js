// @ts-check
// Phase F21: the RETRO. After a run closes, what did it teach?
//
// Not a station on the line: the line ends at delivery, but the most useful feedback comes
// AFTER, from people (review comments, a rejection, the edits they made before merging).
// So the retro looks at runs that have CLOSED (merged, or finished and left alone for
// `settleHours`) and reads their events for feedback (learning.js). It's incremental: it
// remembers the last event it read per run (retro.done), so a review that arrives later
// is still learned from, once.
//
// Optionally the `retro` role (a cheap model) rewrites each piece of feedback as a general
// rule: "n >> 1 truncates odd numbers: use n / 2" → "Don't use bit shifts for arithmetic on
// numbers that may be odd or large." Rules phrased the same way cluster far better.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDriver } from '../exec/harness/driver.js';
import { rolePrompt } from '../roles/prompts.js';
import { newId } from '../util/ids.js';
import { learningsFromRun } from './learning.js';

const ACTIVE = ['queued', 'running', 'parked', 'paused'];

/** Has this run closed long enough ago that people have had their say? */
export function isSettled(run, { now = Date.now(), settleHours = 24 } = {}) {
  if (ACTIVE.includes(run.status)) return false;
  if (run.status === 'merged') return true;
  return Boolean(run.endedAt) && now - Date.parse(run.endedAt) >= settleHours * 3_600_000;
}

/**
 * Learn from every settled run's new feedback.
 * @param {import('../store/events.js').Store} store
 * @param {{ roles?: Record<string, any>, provider?: any, model?: string, now?: number, settleHours?: number, log?: (l: string) => void }} [options]
 *   provider: use the retro role (a provider id, or a provider object in tests); omit for the log-only retro
 * @returns {Promise<Array<object>>} the learnings recorded
 */
export async function runRetros(store, { roles, provider, model, now = Date.now(), settleHours = 24, log = () => {} } = {}) {
  const recorded = [];
  const done = new Map(store.read({ types: ['retro.done'] }).map((e) => [e.data.runId, e.data.seq]));
  for (const run of store.list('runs')) {
    if (!isSettled(run, { now, settleHours })) continue;
    const events = store.read({ stream: `run:${run.id}`, after: done.get(run.id) ?? 0 });
    if (!events.length) continue;
    const found = learningsFromRun({ ...run, slug: run.slug ?? slugOf(run) }, events);
    if (found.length && provider && roles?.retro) {
      const rules = await askForRules(roles.retro, found, { provider, model }).catch((error) => (log(`retro agent failed (${error.message}); keeping the feedback as it was said`), []));
      found.forEach((l, i) => (l.rule = typeof rules[i] === 'string' && rules[i].trim() ? rules[i].trim().slice(0, 300) : null));
    }
    for (const l of found) {
      if (provider && l.rule === null) continue; // the retro judged it a one-off
      const learning = { learningId: newId('learn'), ...l, repo: run.request?.repo ?? null, forge: run.request?.forge ?? null, base: run.request?.base ?? null };
      store.append(`run:${run.id}`, 'learning.recorded', learning);
      recorded.push(learning);
    }
    store.append(`run:${run.id}`, 'retro.done', { runId: run.id, seq: events.at(-1).seq, learnings: found.length });
    if (found.length) log(`retro ${run.id}: ${found.length} piece(s) of feedback`);
  }
  return recorded;
}

const slugOf = (run) => run.itemId?.split('#')[0] ?? '';

/** The retro role: feedback items → one general rule each (or null). */
async function askForRules(role, items, { provider, model }) {
  const list = items.map((l, i) => `${i + 1}. [${l.source}${l.by ? `, ${l.by}` : ''}] ${l.text}`).join('\n');
  const driver = await createDriver(typeof provider === 'object' ? 'in-process' : 'subprocess');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-retro-')); // it needs no files
  try {
    const result = await driver.run({ cwd, provider, model, permissionMode: 'plan', limits: { maxTurns: role.maxTurns ?? 3, budgetUsd: 0.2 }, prompt: rolePrompt(role, { steering: {}, context: [`# The feedback\n\n${list}`] }) });
    const json = /```json\s*([\s\S]*?)```/.exec(result.text)?.[1] ?? result.text;
    const rules = JSON.parse(json).rules;
    if (!Array.isArray(rules)) throw new Error('no "rules" array');
    return rules;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
