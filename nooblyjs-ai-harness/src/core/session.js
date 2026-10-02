// The Session owns the conversation and everything the agent loop needs.
//
// Phase 02: the model is STATELESS, so we re-send the whole history every turn.
// Phase 03: replies STREAM as events, and a turn can be interrupted.
// Phase 04: the model can use TOOLS. The loop that runs them lives in loop.js.
// Phase 05: a real toolset (Read, Glob, Grep, Edit, Write, Bash).
// Extra:    any provider (Anthropic, OpenAI, Grok). The Session doesn't care which.
// Phase 06: a permission gate decides whether each tool call may run.
// Phase 07: the system prompt is built from the environment and NOOBLY.md files.
// Phase 08: the context window is watched, and history compacted when it fills up.
// Phase 09: every message is saved to a transcript, so sessions can be resumed.
// Phase 10: options come from layered settings files.
// Phase 11: the model keeps a todo list, and asks before leaving plan mode.
// Phase 12: hooks (your commands) run at fixed moments of a turn.
// Phase 13: the model can delegate to subagents (the Task tool).
// Phase 15: skills: instructions the model loads when it needs them.
// Phase 16: memory: files in ~/.noobly/projects/<slug>/memory the model may read and write.
// Phase 20: Bash commands run in an OS sandbox (sandbox/index.js).
// Phase 21: every file change is checkpointed, and a turn can be rewound (checkpoints/store.js).
// Phase 22: commands can run in the background while the agent works (tasks/registry.js).
// Phase 24: after every edit, a quick check reports the problems it introduced (feedback/index.js).
import crypto from 'node:crypto';
import path from 'node:path';
import { BUILTIN_AGENTS } from '../agents/definitions.js';
import { DEFAULTS } from '../config/defaults.js';
import { compactSession, hasThinking, stripThinking } from '../context/compact.js';
import { buildSystemPrompt } from '../context/system-prompt.js';
import { createPermissions } from '../permissions/gate.js';
import { createTaskRegistry } from '../tasks/registry.js';
import { PROVIDERS } from '../providers/index.js';
import { readMemoryIndex } from '../memory/memory.js';
import { hashTools, openTranscript, readTranscript } from '../session-store/transcript.js';
import { createDefaultTools } from '../tools/index.js';
import { todosFromHistory } from '../tools/todo.js';
import { addUsage, costOf, emptyUsage } from './cost.js';
import { runTurn } from './loop.js';

export class Session {
  /**
   * @param {{ provider: { name: string, stream: Function }, providerId?: string, model?: string, systemPrompt?: string,
   *           tools?: import('../tools/registry.js').ToolRegistry, cwd?: string, retry?: object,
   *           permissions?: object, requestPermission?: Function, requestPlanApproval?: Function, context?: object,
   *           settings?: object, newTranscript?: () => object, hooks?: object, sandbox?: object,
   *           newCheckpoints?: (id: string) => object }} options
   *   `retry` is passed to withRetry (e.g. { maxRetries: 0 } in tests)
   *   `permissions` from createPermissions() (Phase 06)
   *   `requestPermission` asks the user; the UI replaces it. Without a UI, "ask" means no.
   *   `requestPlanApproval` shows the user a plan (Phase 11); the UI replaces it. Without a UI, the plan is not approved.
   *   `context` is what Phase 07 gathered (environment, instruction files), for /context
   *   `settings` the merged settings (Phase 10); anything missing comes from DEFAULTS
   *   `newTranscript` makes a transcript for each new conversation (Phase 09); none in tests
   *   `hooks` a hook runner from hooks/runner.js (Phase 12), or null for none
   *   `sandbox` from sandbox/index.js (Phase 20), or null: Bash runs unsandboxed
   *   `newCheckpoints` makes the checkpoint store for a conversation id (Phase 21); none in tests
   */
  constructor({
    provider,
    providerId = 'anthropic',
    settings = {},
    model = settings.model ?? PROVIDERS[providerId]?.defaultModel,
    cwd = process.cwd(),
    context = null,
    systemPrompt = buildSystemPrompt(context ?? {}),
    tools = createDefaultTools(),
    retry = {},
    permissions = createPermissions(),
    requestPermission = denyWithoutUser,
    requestPlanApproval = rejectPlanWithoutUser,
    newTranscript = null,
    hooks = null,
    sandbox = null,
    newCheckpoints = null,
    feedback = null,
  }) {
    this.provider = provider;
    this.providerId = providerId;
    this.settings = { ...DEFAULTS, ...settings };
    this.model = model;
    this.cwd = cwd;
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.retry = retry;
    this.permissions = permissions;
    this.requestPermission = requestPermission;
    this.requestPlanApproval = requestPlanApproval;
    this.context = context;
    this.newTranscript = newTranscript;
    this.hooks = hooks;
    this.sandbox = sandbox;
    this.newCheckpoints = newCheckpoints;
    /** Phase 24: checks after every Edit/Write (feedback/index.js), or null. */
    this.feedback = feedback;
    /** Phase 22: background tasks (dev servers, watchers, long builds). */
    this.tasks = createTaskRegistry();
    this.clear();
  }

  /** Phase 13: the subagents the Task tool can start. */
  get agents() {
    return this.context?.agents ?? BUILTIN_AGENTS;
  }

  /** Phase 15: installed skills (names and descriptions; see skills/loader.js). */
  get skills() {
    return this.context?.skills ?? [];
  }

  /** Phase 16: this project's memory folder, or null. */
  get memoryDir() {
    return this.context?.memory?.dir ?? null;
  }

  /** Folders outside the project that Read may open anyway: your own skills (Phase 15), memory (Phase 16), saved tool output (Phase 26). */
  get readableDirs() {
    return [
      ...this.skills.filter((skill) => skill.scope === 'user').map((skill) => skill.dir),
      ...this.writableDirs,
      ...(this.toolResultsDir ? [this.toolResultsDir] : []),
    ];
  }

  /** Phase 28: can this provider's models see images? (Unknown providers: assume yes and let the API say.) */
  get canSeeImages() {
    return PROVIDERS[this.providerId]?.images ?? true;
  }

  /** Phase 26: where too-long tool output of this conversation is saved (next to its checkpoints), or null. */
  get toolResultsDir() {
    return this.checkpoints ? path.join(this.checkpoints.dir, 'tool-results') : null;
  }

  /** Folders outside the project that Write and Edit may change: memory (Phase 16). */
  get writableDirs() {
    return this.memoryDir ? [this.memoryDir] : [];
  }

  get maxTokens() {
    return this.settings.maxTokens;
  }
  get maxTurns() {
    return this.settings.maxTurns;
  }
  set maxTurns(value) {
    this.settings.maxTurns = value;
  }

  /**
   * Start a fresh conversation: forget history, reset counters, and begin a new
   * transcript. This is also the one safe moment to pick up a changed NOOBLY.md,
   * because nothing has been sent yet.
   */
  clear() {
    // Phase 22: a new conversation doesn't inherit processes it knows nothing about.
    this.tasks?.stopAll();
    /** @type {Array<{ role: 'user' | 'assistant', content: any }>} */
    this.history = [];
    this.usage = emptyUsage();
    this.cost = 0;
    this.turns = 0;
    /** Phase 19: one trace per turn (timings, tokens, tool durations) for /stats. */
    this.traces = [];
    /** Files the model has Read (or written), and their modification time then. Write/Edit check this. */
    this.readFiles = new Map();
    /** The Bash tool's current directory. It persists between commands, like a real terminal. */
    this.shellCwd = this.cwd;
    /** What the reminders have already told the model (Phase 07): starts with the current mode. */
    this.reminderState = { mode: this.permissions.mode, noticedMtimes: new Map() };
    /** Phase 11: the model's todo list, [{ content, status, activeForm? }], written by TodoWrite. */
    this.todos = [];
    /** Phase 12: the SessionStart hooks run with the next message; this says why the conversation started. */
    this.pendingSessionStart = this.pendingSessionStart === undefined ? 'startup' : 'clear';
    // Phase 16: memories saved in the last conversation join the prompt of the next one.
    if (this.context?.memory) this.context.memory = readMemoryIndex(this.context.memory.dir);
    if (this.context) this.systemPrompt = buildSystemPrompt(this.context);
    /** Phase 09: where this conversation is saved. */
    this.transcript = this.newTranscript?.() ?? null;
    this.transcript?.setMeta(this.describe());
    /** Phase 21: this conversation's checkpoints (same id as the transcript, so they resume together). */
    this.checkpoints = this.newCheckpoints?.(this.transcript?.id ?? crypto.randomUUID()) ?? null;
  }

  /** What a transcript's first line records about this session. */
  describe() {
    return {
      cwd: this.cwd,
      providerId: this.providerId,
      model: this.model,
      systemPrompt: this.systemPrompt,
      toolsHash: hashTools(this.tools.toApiSchemas()),
    };
  }

  // ── Phase 09: saving ────────────────────────────────────────────────────

  /** Called by the loop when a turn's messages join the history. */
  recordMessages(messages) {
    for (const message of messages) this.transcript?.append({ type: 'message', message });
  }

  recordTurn(usage, cost, trace) {
    if (trace) this.traces.push(trace);
    this.transcript?.append({ type: 'turn', usage, cost, model: this.model, ...(trace && { trace }) });
  }

  /** Continue a saved session: its history, totals and system prompt. */
  resume(file) {
    const saved = readTranscript(file);
    this.clear();
    this.history = saved.history;
    this.usage = { ...emptyUsage(), ...saved.usage };
    this.cost = saved.cost;
    this.turns = saved.turns;
    this.traces = saved.traces;
    // Reuse the SAVED system prompt: rebuilding it would give a different date and
    // git status, which changes the start of every request (no cache hits, and
    // Claude's saved thinking blocks would no longer match their conversation).
    if (saved.meta?.systemPrompt) this.systemPrompt = saved.meta.systemPrompt;
    // If the tools changed since (e.g. noobly was updated), those thinking blocks can't be replayed either.
    if (!saved.meta || saved.meta.toolsHash !== hashTools(this.tools.toApiSchemas()) || saved.meta.systemPrompt !== this.systemPrompt) {
      if (hasThinking(this.history)) this.history = stripThinking(this.history);
    }
    this.todos = todosFromHistory(this.history); // Phase 11
    this.pendingSessionStart = 'resume'; // Phase 12
    this.transcript = openTranscript(file);
    this.checkpoints = this.newCheckpoints?.(this.transcript.id) ?? null; // Phase 21
    return saved;
  }

  // ── Phase 21: rewinding ─────────────────────────────────────────────────

  /**
   * Go back to how things were when turn `turnId` began.
   * @param {{ code?: boolean, conversation?: boolean }} what  the files, the conversation, or both
   * @returns {Promise<{ turn: object, files?: object }>}  `turn.prompt` is what you typed then (the UI puts it back)
   */
  async rewind(turnId, { code = true, conversation = true } = {}) {
    if (!this.checkpoints) throw new Error('This session has no checkpoints.');
    const turn = this.checkpoints.turns().find((t) => t.id === turnId);
    if (!turn) throw new Error(`There is no turn ${turnId} to rewind to. Type /rewind to see the list.`);
    if (conversation && turn.historyLength === null) {
      throw new Error('The conversation was compacted after that turn, so it can no longer be rewound. You can still rewind the code: /rewind ' + turnId + ' code');
    }
    const result = { turn };
    if (code) {
      result.files = await this.checkpoints.restoreTo(turnId);
      // The model's picture of these files is out of date: it must Read them again before editing.
      const touched = [...result.files.restored, ...result.files.deleted];
      for (const file of touched) this.readFiles.delete(file);
      if (!conversation && (touched.length || result.files.notRestorable.length)) this.reminderState.rewound = { turn, ...result.files };
    }
    if (conversation) {
      this.history = this.history.slice(0, turn.historyLength);
      this.transcript?.append({ type: 'history', reason: 'rewind', history: this.history });
      this.todos = todosFromHistory(this.history);
      this.checkpoints.dropFrom(turnId);
    }
    return result;
  }

  // ── Phase 08: making room ───────────────────────────────────────────────

  /** Replace the whole history (after compaction), and record it. */
  replaceHistory(history, { reason, summaryUsage } = {}) {
    this.history = history;
    if (summaryUsage) {
      const cost = costOf(summaryUsage.model, summaryUsage.usage);
      this.usage = addUsage(this.usage, summaryUsage.usage);
      this.cost += cost;
      this.transcript?.append({ type: 'turn', usage: summaryUsage.usage, cost, model: summaryUsage.model, note: 'compaction' });
    }
    this.transcript?.append({ type: 'history', reason, history });
    this.checkpoints?.historyReplaced(); // Phase 21: old positions in the history are gone
    // Phase 11: a summary may have swallowed the TodoWrite calls, so remind the model of its list.
    if (reason === 'summarized' && this.todos.some((todo) => todo.status !== 'completed')) this.reminderState.todosAfterCompact = true;
  }

  /** Make room in the context window (see context/compact.js). */
  compact(options) {
    return compactSession(this, options);
  }

  /**
   * Send one user message and yield events while the agent works.
   * The last event is always { type: 'turn_end', ... } unless an error is thrown.
   * @param {string} text
   * @param {{ signal?: AbortSignal }} [options] abort the signal to interrupt
   * @returns {AsyncGenerator<import('./events.js').Event>}
   */
  stream(text, options) {
    return runTurn(this, text, options);
  }

  /** Convenience: run a whole turn and return only the final `turn_end` event. */
  async send(text, options) {
    let end;
    for await (const event of this.stream(text, options)) {
      if (event.type === 'turn_end') end = event;
    }
    return end;
  }
}

/** Phase 11: without a UI nobody can approve a plan, so the model is told to present it as its answer. */
async function rejectPlanWithoutUser() {
  return {
    behavior: 'reject',
    reason:
      'noobly is running non-interactively, so nobody can approve a plan. Stay in plan mode and give the plan as your final answer; the user can run it later in another mode.',
  };
}

/** The default way to "ask": nobody is there to answer (print mode, tests), so the answer is no. */
async function denyWithoutUser({ tool, suggestion }) {
  const howToAllow = suggestion.type === 'mode' ? `--permission-mode ${suggestion.mode}` : `--allow "${suggestion.rule}"`;
  return {
    behavior: 'deny',
    reason: `${tool.name} needs the user's permission, but noobly is running non-interactively (nobody can answer). To allow it, run noobly with ${howToAllow}.`,
  };
}
