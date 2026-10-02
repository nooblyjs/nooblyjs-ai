// @ts-check
// Phase F12: the human side of the line.
//
//   factory inbox                              what's waiting for a person
//   factory approve <id> [--now]               approve (a spec; or add a role's rule for a policy gap)
//   factory reject <id> --feedback "…" [--now] send it back, with what to change
//   factory answer <id> "…" [--now]            answer an agent's question
//
// --now carries on with the run right here, instead of waiting for `factory serve`.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { answerEntry, openEntries } from '../humans/inbox.js';
import { continueRun } from '../job/run-job.js';
import { resumeRun } from '../scheduler/kill-switch.js';
import { openStore } from '../store/events.js';
import { factoryHome } from '../util/paths.js';

const dim = (text) => `\x1b[2m${text}\x1b[0m`;

export async function inboxCommand() {
  const store = openStore();
  try {
    const open = openEntries(store);
    if (!open.length) console.log('Nothing is waiting for you.');
    for (const e of open) {
      console.log(`${{ approval: '✋', question: '❓', policy: '🔐' }[e.kind] ?? '•'} ${e.id}  ${e.title}  ${dim(`(${e.kind}, run ${e.runId})`)}`);
      console.log(dim(e.body.split('\n').map((l) => `    ${l}`).join('\n')));
      console.log(dim(`    → factory ${e.kind === 'question' ? `answer ${e.id} "…"` : `approve ${e.id}   ·   factory reject ${e.id} --feedback "…"`}`));
    }
    return 0;
  } finally {
    store.close();
  }
}

/** @param {'approved' | 'rejected' | 'answered'} decision */
function decideCommand(decision) {
  /** @param {string[]} argv */
  return async (argv) => {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { feedback: { type: 'string' }, now: { type: 'boolean' } } });
    const [id, ...words] = positionals;
    if (!id) throw new Error(`Usage: factory ${{ approved: 'approve <id>', rejected: 'reject <id> --feedback "…"', answered: 'answer <id> "…"' }[decision]} [--now]`);
    const store = openStore();
    try {
      const entry = answerEntry(store, id, decision === 'rejected' ? 'rejected' : decision, { feedback: values.feedback, answer: words.join(' ') || undefined });
      if (entry.kind === 'policy') {
        if (decision === 'approved' && entry.detail?.rule) addRoleRule(entry.detail.role, entry.detail.rule);
        console.log(decision === 'approved' ? `Added ${entry.detail?.rule} to the ${entry.detail?.role} role (~/.factory/config.json). It applies from the next run.` : 'Dismissed.');
        return 0;
      }
      const run = store.get('runs', entry.runId);
      if (run?.status === 'parked') resumeRun(store, entry.runId);
      console.log({ approved: 'Approved.', rejected: 'Rejected: the run goes back to redo the work, with your feedback.', answered: 'Answered.' }[decision]);
      if (values.now && store.get('runs', entry.runId)?.status === 'queued') {
        const out = await continueRun(store, entry.runId, { live: { log: (l) => process.stderr.write(dim(`${l}\n`)) } });
        console.log(`\n${out.status}${out.head ? ` · ${out.head}` : ''} · run ${out.runId}`);
        if (out.pr) console.log(`PR: ${out.pr.path}`);
      } else console.log(dim(`The run is back in the queue: factory serve picks it up (or add --now).`));
      return 0;
    } finally {
      store.close();
    }
  };
}

export const approveCommand = decideCommand('approved');
export const rejectCommand = decideCommand('rejected');
export const answerCommand = decideCommand('answered');

/** A policy gap approved: the operator adds the rule to the role, in THEIR config (not the repo's). */
function addRoleRule(role, rule) {
  const file = path.join(factoryHome(), 'config.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  config.roles ??= {};
  config.roles[role] ??= {};
  config.roles[role].allow = [...new Set([...(config.roles[role].allow ?? []), rule])];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
