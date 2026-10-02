// @ts-check
// Phase F16: the OPERATOR's tools. `factory mcp --operator`, for a person's own `noobly` chat:
//
//   "file a factory item to add --json to the status command"
//        → submit_item → a queued run → `factory serve` picks it up
//
//   submit_item    a new item (repo + title + body) → queued
//   list_runs      what's queued, running, parked, done
//   get_run        one run's story (the same text as `factory logs`)
//   answer_inbox   approve / reject / answer what's waiting for a person
//
// These act as the OPERATOR (whoever started the server), like the CLI does. There's no
// step token: this server runs in a person's own chat, not in an agent's workspace.
import fs from 'node:fs';
import path from 'node:path';
import { describe } from '../commands/history.js';
import { answerEntry, openEntries } from '../humans/inbox.js';
import { submitJob } from '../job/run-job.js';
import { resumeRun } from '../scheduler/kill-switch.js';
import { newId } from '../util/ids.js';
import { factoryHome } from '../util/paths.js';

/** @type {import('./step-tools.js').FactoryTool[]} */
export const OPERATOR_TOOLS = [
  {
    name: 'submit_item',
    description: 'File a work item for the factory: a change to a repository, described like a GitHub issue. It is queued; `factory serve` builds it and opens a pull request.',
    inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'path to the git repository' }, title: { type: 'string' }, body: { type: 'string', description: 'what to change and how to tell it is done' }, priority: { type: 'string', enum: ['high', 'normal', 'low'] }, autonomy: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3'] } }, required: ['repo', 'title', 'body'] },
    handle(ctx, { repo, title, body, priority, autonomy }) {
      if (!fs.existsSync(path.join(String(repo), '.git'))) return `Refused: ${repo} is not a git repository.`;
      const dir = path.join(factoryHome(ctx.env), 'issues');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${newId('issue')}.md`);
      fs.writeFileSync(file, `# ${String(title).trim()}\n\n${priority ? `Priority: ${priority}\n\n` : ''}${String(body).trim()}\n`);
      const runId = submitJob(ctx.store, { repo: String(repo), issueFile: file, ...(autonomy && { autonomy }) });
      return `Queued ${runId}: "${title}". It runs when \`factory serve\` is running (see list_runs).`;
    },
  },
  {
    name: 'list_runs',
    readOnly: true,
    description: 'The factory\'s runs, newest first: id, status, title, cost.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'only this status (queued, running, parked, delivered, …)' }, limit: { type: 'number' } } },
    handle(ctx, { status, limit = 20 } = {}) {
      const runs = ctx.store.list('runs').filter((r) => !status || r.status === status).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, limit);
      if (!runs.length) return status ? `No ${status} runs.` : 'No runs yet.';
      return runs.map((r) => `${r.id}  ${r.status.padEnd(16)} $${(r.costUsd ?? 0).toFixed(4)}  ${r.title}`).join('\n');
    },
  },
  {
    name: 'get_run',
    readOnly: true,
    description: 'One run\'s story, from the event log: stations, results, repairs, questions, the PR.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] },
    handle(ctx, { runId }) {
      const run = ctx.store.get('runs', runId);
      if (!run) return `No run "${runId}".`;
      const story = ctx.store.read({ stream: `run:${runId}` }).map((e) => describe(e)).filter(Boolean);
      return `${run.id} · ${run.status} · ${run.title}\n\n${story.join('\n')}`;
    },
  },
  {
    name: 'answer_inbox',
    description: 'Deal with something waiting for a person. With no arguments: list the open entries. Otherwise: approve, reject (needs feedback) or answer one. A parked run goes back in the queue.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, decision: { type: 'string', enum: ['approved', 'rejected', 'answered'] }, answer: { type: 'string' }, feedback: { type: 'string' } } },
    handle(ctx, { id, decision, answer, feedback } = {}) {
      if (!id) {
        const open = openEntries(ctx.store);
        return open.length ? open.map((e) => `${e.id}  ${e.kind.padEnd(9)} ${e.runId}  ${e.title}`).join('\n') : 'The inbox is empty.';
      }
      const entry = answerEntry(ctx.store, id, /** @type {any} */ (decision ?? (answer ? 'answered' : 'approved')), { answer, feedback, by: `${ctx.env?.USER ?? 'operator'} (via chat)` });
      const run = ctx.store.get('runs', entry.runId);
      if (run?.status === 'parked') resumeRun(ctx.store, entry.runId);
      return `${id}: ${entry.status}.${run?.status === 'parked' ? ` Run ${entry.runId} is back in the queue.` : ''}`;
    },
  },
];
