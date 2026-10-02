// @ts-check
// Phase F18: CHATOPS. Comment commands on GitHub issues and PRs.
//
//   @factory run              (on an issue)   build this issue
//   @factory fix <what>       (on a factory PR) back to the fixer, with <what> as the review
//   @factory stop             (either)        cancel the run that's working on it
//   @factory explain          (either)        reply with the run's timeline
//
// A FIXED grammar: one command per comment, on a line of its own, from a short list.
// No "natural language" parsing: a command that can be misread will be, and this one
// can spend money and cancel work. Anything else after "@factory" gets a short
// reply listing the commands.
//
// Only people in github.allowedUsers may command the factory. Others get a polite
// reply saying so (silence would look like the factory is broken).
import { describe } from '../../commands/history.js';
import { cancelRun } from '../../scheduler/kill-switch.js';
import { handleWebhook } from './webhooks.js';

export const COMMANDS = ['run', 'fix', 'stop', 'explain'];
const HELP = 'Commands: `@factory run` (on an issue), `@factory fix <what to change>` (on a factory PR), `@factory stop`, `@factory explain`.';

/**
 * The command in a comment, if any.
 * @returns {{ command: string, args: string } | { error: string } | null}
 */
export function parseCommand(body) {
  const line = String(body ?? '').split('\n').map((l) => l.trim()).find((l) => /^@factory\b/i.test(l));
  if (!line) return null;
  const m = line.match(/^@factory\s+(\w+)\s*(.*)$/i);
  if (!m) return { error: `I didn't catch a command. ${HELP}` };
  const command = m[1].toLowerCase();
  if (!COMMANDS.includes(command)) return { error: `I don't know "${m[1]}". ${HELP}` };
  // "fix" takes the rest of the comment (the line and anything after it) as what to change.
  const rest = command === 'fix' ? String(body).slice(String(body).indexOf(line) + line.length - m[2].length).trim() : m[2].trim();
  if (command === 'fix' && !rest) return { error: 'Tell me what to change: `@factory fix <what to change>`.' };
  return { command, args: rest };
}

/** An issue_comment webhook → a command (or a reason it isn't one). */
export function parseComment(payload, settings) {
  if (payload.action !== 'created' || !payload.comment) return null;
  const who = payload.comment.user?.login;
  if (payload.comment.user?.type === 'Bot' || payload.comment.body?.includes('<!-- factory:')) return null; // never answer ourselves
  const parsed = parseCommand(payload.comment.body);
  if (!parsed) return null;
  const repo = payload.repository;
  const where = { owner: repo.owner?.login, name: repo.name, cloneUrl: repo.clone_url, number: payload.issue.number, isPR: Boolean(payload.issue.pull_request), by: who };
  if (!settings.allowedUsers.includes(who)) return { type: 'reply', ...where, text: `Sorry @${who}, only ${settings.allowedUsers.length ? settings.allowedUsers.map((u) => `@${u}`).join(', ') : 'the people in `github.allowedUsers`'} can give the factory commands here.` };
  if ('error' in parsed) return { type: 'reply', ...where, text: parsed.error };
  const i = payload.issue;
  return { type: `comment.${parsed.command}`, ...where, args: parsed.args, issue: { number: i.number, ref: `${where.owner}/${where.name}#${i.number}`, title: i.title, body: i.body ?? '', labels: (i.labels ?? []).map((l) => l.name) } };
}

/** The newest run for this issue or PR. */
function runFor(store, cmd) {
  const itemId = `github-${cmd.owner}-${cmd.name}#${cmd.number}`;
  return store.list('runs')
    .filter((r) => r.itemId === itemId || String(r.pr ?? '').endsWith(`/pull/${cmd.number}`))
    .sort((a, b) => String(b.queuedAt).localeCompare(String(a.queuedAt)) || (a.id < b.id ? 1 : -1))[0] ?? null;
}

/**
 * Do a comment command. Returns { handled, runId?, reason?, reply? }: `reply` is posted
 * back on the issue/PR by the caller (it owns the GitHub client).
 */
export function handleComment(store, cmd, ctx) {
  if (!cmd) return { handled: false, reason: 'no command' };
  if (cmd.type === 'reply') return { handled: false, reason: 'not a command the factory can run', reply: cmd.text };
  const run = runFor(store, cmd);
  switch (cmd.type) {
    case 'comment.run': {
      if (cmd.isPR) return { handled: false, reply: '`@factory run` works on issues. On a factory PR, use `@factory fix <what to change>`.' };
      if (run && ['queued', 'running', 'parked', 'paused'].includes(run.status)) return { handled: false, reply: `Already on it: run \`${run.id}\` is ${run.status}.` };
      const out = handleWebhook(store, { type: 'submit', owner: cmd.owner, name: cmd.name, cloneUrl: cmd.cloneUrl, issue: cmd.issue, by: cmd.by }, ctx);
      return { ...out, reply: out.handled ? `On it (run \`${out.runId}\`). I'll open a pull request here.` : undefined };
    }
    case 'comment.fix': {
      if (!run?.head) return { handled: false, reply: "I can't find a factory PR for this. `@factory fix` works on the factory's own PRs." };
      const out = handleWebhook(store, { type: 'changes_requested', owner: cmd.owner, name: cmd.name, head: run.head, body: cmd.args, by: cmd.by }, ctx);
      return { ...out, reply: out.handled ? `On it: the fixer has your request (run \`${run.id}\`).` : `Not now: ${out.reason}.` };
    }
    case 'comment.stop': {
      if (!run || !['queued', 'running', 'parked', 'paused'].includes(run.status)) return { handled: false, reply: 'Nothing is running for this.' };
      cancelRun(store, run.id);
      return { handled: true, runId: run.id, reply: `Stopped run \`${run.id}\`. Its work so far stays on its branch.` };
    }
    case 'comment.explain': {
      if (!run) return { handled: false, reply: 'The factory has no run for this yet.' };
      const lines = store.read({ stream: `run:${run.id}` }).filter((e) => e.type !== 'agent.event').map((e) => `${e.at.slice(11, 19)} ${String(describe(e) ?? '').replace(/\x1b\[[0-9;]*m/g, '')}`);
      const shown = lines.length > 60 ? [...lines.slice(0, 20), `… ${lines.length - 50} more …`, ...lines.slice(-30)] : lines;
      return { handled: true, runId: run.id, reply: `Run \`${run.id}\`: **${run.status}**, $${(run.costUsd ?? 0).toFixed(2)}\n\n\`\`\`\n${shown.join('\n')}\n\`\`\`` };
    }
    default:
      return { handled: false, reason: `unknown ${cmd.type}` };
  }
}
