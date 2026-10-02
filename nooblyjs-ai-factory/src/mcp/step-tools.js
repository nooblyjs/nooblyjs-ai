// @ts-check
// Phase F16: FACTORY TOOLS for agents. A narrow, factory-aware API instead of a bigger prompt.
//
//   read_spec        the spec, or one part of it (a file, a requirement, a task), on demand
//   report_progress  "halfway: tests written" (the dashboard shows it; no effect on flow)
//   ask_human        a question for a person: the run PARKS until they answer (no tokens spent waiting)
//   record_decision  "chose X over Y because…" → the evidence bundle's Decisions section
//   submit_artifact  "keep this file": the control plane stores it with the run
//   request_scope    "I need to touch README.md too": granted at L3, a person decides otherwise
//
// Each tool is a plain definition: a name, a JSON schema, and handle(ctx, input) → text.
// The SAME definitions are served two ways (src/mcp/wire.js): as in-process harness tools,
// and over MCP (`factory mcp --step`) for the subprocess driver. The agent sees the same
// names either way: mcp__factory__<tool>.
//
// ctx: { store, runId, step, station, workspace, env }. Every write is an EVENT on the run's
// stream: the tools can't do anything the event log doesn't show.
import fs from 'node:fs';
import path from 'node:path';
import { openEntry } from '../humans/inbox.js';
import { recordArtifact } from '../store/artifacts.js';

const SPEC_FILES = ['requirements', 'design', 'tasks'];

/** @typedef {{ store: import('../store/events.js').Store, runId: string, step: string, station: string, workspace: string, env?: NodeJS.ProcessEnv }} StepToolContext */
/** @typedef {{ name: string, description: string, inputSchema: object, readOnly?: boolean, handle: (ctx: StepToolContext, input: any) => string }} FactoryTool */

/** The parts of a markdown file whose heading mentions an id (R1, R1.2, T2). */
function sectionsNaming(markdown, id) {
  const parts = markdown.split(/^(?=#{1,4} )/m);
  const re = new RegExp(`\\b${id.replace('.', '\\.')}\\b`);
  return parts.filter((p) => re.test(p.split('\n')[0]) || (id.includes('.') && re.test(p)));
}

/** @type {FactoryTool[]} */
export const STEP_TOOLS = [
  {
    name: 'read_spec',
    readOnly: true,
    description: 'Read this item\'s spec: all of it, one file ("requirements", "design", "tasks"), or the part about one id ("R2", "R2.1", "T3"). Use it instead of guessing what was asked.',
    inputSchema: { type: 'object', properties: { section: { type: 'string', description: 'requirements | design | tasks | an id like R2, R2.1, T3. Omit for everything.' } } },
    handle(ctx, { section } = {}) {
      const specDir = ctx.store.get('runs', ctx.runId)?.steps?.spec?.result?.specDir;
      if (!specDir) return 'This item has no spec: it was small enough to build straight from the issue. The issue text is in your instructions.';
      const read = (f) => {
        try {
          return fs.readFileSync(path.join(ctx.workspace, specDir, `${f}.md`), 'utf8');
        } catch {
          return '';
        }
      };
      if (!section) return SPEC_FILES.map((f) => read(f)).filter(Boolean).join('\n\n---\n\n');
      if (SPEC_FILES.includes(section)) return read(section) || `No ${section}.md in ${specDir}/.`;
      const found = SPEC_FILES.flatMap((f) => sectionsNaming(read(f), section).map((p) => `(${f}.md)\n${p.trim()}`));
      return found.length ? found.join('\n\n') : `Nothing in the spec mentions "${section}". Try read_spec with no section.`;
    },
  },
  {
    name: 'report_progress',
    description: 'Tell the people watching how far you are ("tests written, implementing now"). It does not change what happens next.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, percent: { type: 'number', minimum: 0, maximum: 100 } }, required: ['message'] },
    handle(ctx, { message, percent }) {
      ctx.store.append(`run:${ctx.runId}`, 'step.progress', { runId: ctx.runId, step: ctx.station, agentStep: ctx.step, message: String(message).slice(0, 300), percent: typeof percent === 'number' ? Math.round(percent) : null });
      return 'Noted.';
    },
  },
  {
    name: 'ask_human',
    description: 'Ask a person a question you cannot answer from the code, the spec or the issue, when guessing would be wrong. The run PAUSES until they answer, then this step starts again with their answer. After calling it, END YOUR TURN: stop working and write one line saying you are waiting.',
    inputSchema: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, required: ['question'] },
    handle(ctx, { question, options }) {
      const gate = `ask:${ctx.station}`;
      const open = ctx.store.list('inbox').find((e) => e.runId === ctx.runId && e.gate === gate && e.status === 'open');
      if (open) return `You already asked (${open.id}): "${open.title}". End your turn now; the step restarts when a person answers.`;
      const opts = Array.isArray(options) && options.length ? `\n\nOptions:\n${options.map((o) => `- ${o}`).join('\n')}` : '';
      const id = openEntry(ctx.store, { runId: ctx.runId, kind: 'question', gate, title: String(question).slice(0, 200), body: `${question}${opts}`, detail: { step: ctx.step, options: options ?? [] } });
      return `Asked (${id}). END YOUR TURN NOW: write one line saying you are waiting for an answer. This step will start again with the answer.`;
    },
  },
  {
    name: 'record_decision',
    description: 'Record a design decision for the reviewer: what you chose, and why (especially over an obvious alternative). It appears in the pull request\'s Decisions section.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, rationale: { type: 'string' } }, required: ['title', 'rationale'] },
    handle(ctx, { title, rationale }) {
      ctx.store.append(`run:${ctx.runId}`, 'decision.recorded', { runId: ctx.runId, step: ctx.station, title: String(title).slice(0, 200), rationale: String(rationale).slice(0, 2000) });
      return 'Recorded.';
    },
  },
  {
    name: 'submit_artifact',
    description: 'Hand a file you made (a report, findings, a benchmark result) to the factory to keep with this run. The path is relative to the workspace.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', description: 'e.g. report, findings, benchmark' }, path: { type: 'string' } }, required: ['kind', 'path'] },
    handle(ctx, { kind, path: file }) {
      const full = path.resolve(ctx.workspace, String(file));
      if (!full.startsWith(`${path.resolve(ctx.workspace)}${path.sep}`)) return `Refused: ${file} is outside the workspace.`;
      let content;
      try {
        content = fs.readFileSync(full);
      } catch {
        return `No file at ${file}.`;
      }
      if (content.length > 1_000_000) return `Refused: ${file} is ${content.length} bytes (the limit is 1 MB).`;
      if (!/^[a-z][a-z0-9-]{0,30}$/.test(String(kind))) return 'Refused: kind must be a short lowercase word (report, findings, …).';
      const sha = recordArtifact(ctx.store, { runId: ctx.runId, kind: `agent-${kind}`, name: path.basename(full), content });
      return `Stored as agent-${kind} (${String(sha).slice(0, 12)}).`;
    },
  },
  {
    name: 'request_scope',
    description: 'Ask to change files OUTSIDE your task\'s declared Paths (the scope check fails otherwise). Say why. At full autonomy it is granted at once; otherwise a person decides, and until then, stay within scope.',
    inputSchema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, minItems: 1 }, reason: { type: 'string' } }, required: ['paths', 'reason'] },
    handle(ctx, { paths, reason }) {
      const list = (Array.isArray(paths) ? paths : [paths]).map(String).filter(Boolean).slice(0, 20);
      if (!list.length) return 'Refused: name at least one path.';
      const run = ctx.store.get('runs', ctx.runId);
      if (run?.request?.autonomy === 'L3') {
        ctx.store.append(`run:${ctx.runId}`, 'scope.granted', { runId: ctx.runId, paths: list, reason, by: 'autonomy L3' });
        return `Granted: ${list.join(', ')}.`;
      }
      const id = openEntry(ctx.store, { runId: ctx.runId, kind: 'approval', gate: 'scope', title: `Allow changes to ${list.join(', ')}?`, body: `The ${ctx.station} agent asks to change files outside its declared Paths:\n\n${list.map((p) => `- \`${p}\``).join('\n')}\n\nWhy: ${reason}`, detail: { paths: list, reason } });
      return `Asked a person (${id}). Until it is granted, do not change those files: finish the rest of the task within scope.`;
    },
  },
];
