// @ts-check
// Phase F05: reading the factory's history.
//
//   factory runs [--all]              runs, newest first (and recovery: dead "running" runs → interrupted)
//   factory logs <run>                one run's story, from its events
//   factory events [--run <id>] [--after <seq>]   the raw log, one JSON event per line
//   factory db rebuild                throw the projection tables away and replay the log
import { parseArgs } from 'node:util';
import { openStore } from '../store/events.js';
import { recoverRuns } from '../store/recovery.js';

const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const ICON = { parked: '✋', merged: '🔀', suggested: '💡', changes_requested: '⛔', needs_info: '❓', running: '⏳', delivered: '✅', gate_failed: '❌', agent_failed: '⚠️', no_changes: '·', error: '💥', interrupted: '⏸️' };

/** @param {string[]} argv */
export async function runsCommand(argv) {
  const { values } = parseArgs({ args: argv, options: { all: { type: 'boolean' }, limit: { type: 'string' } } });
  const store = openStore();
  try {
    const recovered = recoverRuns(store);
    for (const id of recovered) console.log(dim(`(${id}: its process is gone, marked interrupted)`));
    const runs = store.list('runs').sort((a, b) => (a.id < b.id ? 1 : -1)); // ids sort by time (F00)
    const shown = values.all ? runs : runs.slice(0, Number(values.limit ?? 20));
    if (!shown.length) console.log('No runs yet. Try: factory run <issue.md> --repo <path>');
    for (const run of shown) {
      const cost = `$${run.costUsd.toFixed(4)}`;
      console.log(`${ICON[run.status] ?? '?'} ${run.id}  ${run.status.padEnd(12)} ${cost.padStart(9)}  ${run.title}${run.attempt > 1 ? dim(` (attempt ${run.attempt})`) : ''}`);
      if (run.pr) console.log(dim(`   PR ${run.pr}`));
      if (run.status === 'interrupted' || run.status === 'error') console.log(dim(`   retry: factory run retry ${run.id}`));
    }
    return 0;
  } finally {
    store.close();
  }
}

/** @param {string[]} argv */
export async function logsCommand(argv) {
  const [runId] = argv;
  if (!runId) throw new Error('Usage: factory logs <run-id>');
  const store = openStore();
  try {
    recoverRuns(store);
    const run = store.get('runs', runId);
    if (!run) throw new Error(`No run "${runId}". See: factory runs`);
    console.log(`${run.id} · ${run.title} · ${run.status} · attempt ${run.attempt} · $${run.costUsd.toFixed(4)}\n`);
    for (const e of store.read({ stream: `run:${runId}` })) console.log(`${dim(`${e.at.slice(11, 19)} #${e.seq}`)}  ${describe(e)}`);
    if (run.artifacts.length) {
      console.log('\nArtifacts:');
      for (const a of run.artifacts) console.log(`  ${a.kind.padEnd(10)} ${a.name}  ${dim(`${a.sha.slice(0, 12)} · ${a.bytes} bytes`)}`);
    }
    return 0;
  } finally {
    store.close();
  }
}

/** One line per event, for people. */
export function describe(e) {
  const d = e.data;
  switch (e.type) {
    case 'run.started':
      return `▶ run started (pid ${d.pid})`;
    case 'run.queued':
      return `⌛ queued (priority ${d.priority ?? 0})`;
    case 'run.leased':
      return `▶ leased by ${d.worker}: attempt ${d.attempt}${d.budgetUsd !== undefined ? ` · budget $${Number(d.budgetUsd).toFixed(2)}` : ''}`;
    case 'run.requeued':
      return `↺ back in the queue (${d.reason})`;
    case 'run.rewound':
      return `⏮ rewound to ${d.from}: ${d.reset.join(', ')} start over${d.feedback ? ` (feedback: "${d.feedback}")` : ''}`;
    case 'run.pause_requested':
      return '⏸ pause requested (after the current station)';
    case 'run.paused':
      return '⏸ paused';
    case 'run.resumed':
      return '▶ resumed: back in the queue';
    case 'step.progress': // Phase F16: the agent's own progress notes
      return `│ … ${d.message}${d.percent != null ? ` (${d.percent}%)` : ''}`;
    case 'decision.recorded':
      return `│ 📝 decision: ${d.title}`;
    case 'scope.granted':
      return `│ ✅ scope granted (${d.by}): ${(d.paths ?? []).join(', ')}`;
    case 'budget.exceeded': // Phase F18
      return `💸 ${d.reason}: work waits until tomorrow (or a bigger budget)`;
    case 'route.decided': // Phase F22
      return `│ ⇅ ${d.role}: ${d.model ?? 'default model'} (${d.reason}${d.policy !== 'static' ? `, policy ${d.policy}` : ''})`;
    case 'security.blocked': // Phase F24
      return `│ 🛡 NOT pushed: ${d.findings.map((f) => `${f.kind} in ${f.file}`).join(', ')} (inbox ${d.inboxId})`;
    case 'run.merged':
      return `🔀 merged${d.by ? ` by ${d.by}` : ''}${d.sha ? ` (${String(d.sha).slice(0, 8)})` : ''}`;
    case 'pr.changes_requested':
      return `│ ✍ ${d.by} requested changes on the PR: "${String(d.body).slice(0, 80)}"`;
    case 'run.parked':
      return `⏸ parked: waiting for a person (${d.inboxId})`;
    case 'inbox.opened':
      return `│ ✋ asked a person: ${d.title} (${d.inboxId})`;
    case 'inbox.answered':
      return `│ ✍ ${d.by}: ${d.decision}${d.feedback ? ` — "${d.feedback}"` : ''}${d.answer ? ` — "${d.answer}"` : ''}`;
    case 'policy.gap':
      return `│ 🔐 policy gap: the ${d.role} was refused ${d.tool}${d.rule ? ` (would need ${d.rule})` : ''}`;
    case 'run.cancel_requested':
      return '✋ cancel requested';
    case 'run.retried':
      return `↻ retried: attempt ${d.attempt} (pid ${d.pid})`;
    case 'run.interrupted':
      return `⏸ interrupted: ${d.reason}`;
    case 'run.finished':
      return `■ finished: ${d.status}${d.error ? ` (${d.error})` : ''}`;
    case 'step.started':
      return `┌ ${d.step}`;
    case 'step.finished': {
      // Recognise each station's result by what only it has (a step name can be anything in a custom line).
      const r = d.result ?? {};
      if (r.size && r.kind) return `└ ${d.step}: ${r.kind} · ${r.size} · ${r.outOfScope ? 'out of scope' : r.clear ? 'clear' : 'unclear'}${r.stop ? ` → ${r.stop.status}` : ''} · $${(r.costUsd ?? 0).toFixed(4)}`;
      if ('commits' in r) {
        const gates = r.gates ? ` · gates ${r.gates.passed ? 'passed' : 'FAILED'}` : '';
        return `└ ${d.step}: agent ${r.agent?.outcome} · ${r.commits} commit(s)${gates} · $${(r.costUsd ?? r.agent?.costUsd ?? 0).toFixed(4)}${r.stop ? ` → ${r.stop.status}` : ''}`;
      }
      if (r.specDir) return `└ ${d.step}: ${r.requirements.length} requirement(s), ${r.trace.criteria.length} criteria, ${r.tasks.length} task(s) in ${r.specDir}`;
      if (r.decision) return `└ ${d.step}: ${r.decision}${r.by ? ` by ${r.by}` : ''}${r.feedback ? ` — "${r.feedback}"` : ''}${r.level ? ` (autonomy ${r.level})` : ''}`;
      if (r.escalated) return `└ ${d.step}: ESCALATED: ${r.reason}`;
      if (r.repaired) return `└ ${d.step}: repaired (${r.sha.slice(0, 8)}), checking again`;
      if ('merged' in r) return `└ ${d.step}: ${r.merged ? `merged (${r.sha.slice(0, 8)})` : `not merged: ${r.reason}`}`;
      if (r.by && Array.isArray(r.findings)) return `└ ${d.step}: ${r.verdict}${r.blocking ? `, ${r.blocking} blocking` : ''}${r.findings.length ? ` (${r.findings.length} finding(s))` : ''}`;
      if ('passed' in r) return `└ ${d.step}: ${r.passed === null ? 'no gates configured' : r.passed ? 'gates passed (clean checkout)' : 'gates FAILED (clean checkout)'}`;
      if (r.head) return `└ ${d.step}: ${r.status} → ${r.head}`;
      return `└ ${d.step}: ${r.stop ? `stop → ${r.stop.status}` : (r.status ?? 'done')}`;
    }
    case 'step.failed':
      return `└ ${d.step} FAILED: ${d.error}`;
    case 'workspace.acquired':
      return `│ workspace ${d.workspace.id} (${d.workspace.branch})`;
    case 'agent.event': {
      const a = d.event;
      if (a.kind === 'text') return `│ ${dim('agent:')} ${oneLine(a.text, 110)}`;
      if (a.kind === 'tool') return `│ ● ${a.name}(${a.summary ?? ''})`;
      if (a.kind === 'tool_result') return `│   ⎿ ${a.isError ? 'ERROR ' : ''}${oneLine(a.display ?? a.content ?? '', 100)}`;
      if (a.kind === 'notice') return `│ ${dim('notice:')} ${oneLine(a.text, 110)}`;
      if (a.kind === 'turn_end') return `│ ${dim(`turn end: ${a.rounds} round(s), ${a.toolCalls} tool call(s)${a.interrupted ? ', interrupted' : ''}`)}`;
      return `│ ${a.kind}`;
    }
    case 'wave.started':
      return `│ ≡ wave ${d.wave}: ${d.tasks.join(', ')}${d.tasks.length > 1 ? ' in parallel' : ''}`;
    case 'task.finished':
      return `│   ${d.task}: ${d.outcome} · ${d.commits} commit(s) · $${(d.costUsd ?? 0).toFixed(4)}`;
    case 'wave.integrated':
      return `│ ⤵ wave ${d.wave} merged${d.conflicts.length ? ` (conflicts resolved: ${d.conflicts.join(', ')})` : ''}`;
    case 'repair.attempted':
      return `│ 🔧 repair ${d.attempt} (${d.trigger === 'gates' ? 'checks' : 'review'}: ${d.title}): ${d.outcome === 'success' ? `fixed in ${String(d.sha).slice(0, 8)}` : d.outcome}`;
    case 'effect.intended':
      return `│ → ${d.kind} (intended)`;
    case 'effect.done':
      return `│ ✓ ${d.key.split(':')[0]} done${d.reconciled ? ' (reconciled after a crash: it had already happened)' : ''}`;
    case 'artifact.stored':
      return `│ 📎 ${d.kind}: ${d.name}`;
    default:
      return e.type;
  }
}

const oneLine = (text, max) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** @param {string[]} argv */
export async function eventsCommand(argv) {
  const { values } = parseArgs({ args: argv, options: { run: { type: 'string' }, after: { type: 'string' } } });
  const store = openStore();
  try {
    for (const e of store.read({ stream: values.run && `run:${values.run}`, after: Number(values.after ?? 0) })) console.log(JSON.stringify(e));
    return 0;
  } finally {
    store.close();
  }
}

/** @param {string[]} argv */
export async function dbCommand(argv) {
  if (argv[0] !== 'rebuild') throw new Error('Usage: factory db rebuild');
  const store = openStore();
  try {
    const before = snapshot(store);
    const counts = store.rebuild();
    const same = JSON.stringify(before) === JSON.stringify(snapshot(store));
    console.log(`Replayed ${store.read().length} events → ${Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(', ')}.`);
    console.log(same ? 'The rebuilt tables are identical to the old ones.' : 'The rebuilt tables DIFFER from the old ones (a projection changed, or the tables were edited).');
    return 0;
  } finally {
    store.close();
  }
}

/** Every projection row, for comparing. */
export function snapshot(store) {
  return Object.fromEntries(['items', 'runs', 'effects', 'system', 'inbox'].map((t) => [t, store.db.prepare(`SELECT id, data FROM ${t} ORDER BY id`).all()]));
}
