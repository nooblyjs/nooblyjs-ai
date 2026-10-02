// The interactive chat screen, built with Ink (React for the terminal).
//
// Layout, top to bottom:
//   <Static>      finished output. Printed once, then it scrolls up like normal terminal output.
//   live reply    the part of the reply still streaming in (Phase 03)
//   live tools    tools currently running (Phase 04; several at once from Phase 05)
//   <TodoList>    the model's todo list while it works (Phase 11)
//   <PermissionDialog>  "Allow noobly to …?" when a tool needs your OK (Phase 06)
//   <PlanDialog>  "Here is my plan" when the model wants to leave plan mode (Phase 11)
//   <RewindDialog> Esc Esc on an empty prompt: go back to before an earlier message (Phase 21)
//   <Thinking>    spinner + "esc to interrupt" while the model is working...
//   <PromptInput> ...or the input box when idle.
//   <StatusBar>   model, tokens and cost.
import { useEffect, useRef, useState } from 'react';
import { Box, Static, useApp, useInput } from 'ink';
import { describeRewind } from '../commands/builtin.js';
import { isCommand, runCommand } from '../commands/index.js';
import { formatCost, hasPrice } from '../core/cost.js';
import { EVENT } from '../core/events.js';
import { textOf } from '../core/messages.js';
import { loadContext } from '../context/system-prompt.js';
import { temporarilyAllow } from '../permissions/gate.js';
import { nextMode } from '../permissions/modes.js';
import { Banner } from './components/Banner.jsx';
import { Message } from './components/Message.jsx';
import { PermissionDialog } from './components/PermissionDialog.jsx';
import { PlanDialog } from './components/PlanDialog.jsx';
import { RewindDialog } from './components/RewindDialog.jsx';
import { TodoList } from './components/TodoList.jsx';
import { safeSplitPoint } from './markdown.jsx';
import { PromptInput } from './components/PromptInput.jsx';
import { StatusBar } from './components/StatusBar.jsx';
import { Thinking } from './components/Thinking.jsx';
import { ToolCall } from './components/ToolCall.jsx';

let nextId = 0;
const entry = (kind, text, extra = {}) => ({ id: nextId++, kind, text, ...extra });

/** Stats line shown under a finished reply, e.g. "2.1s · in 58 · out 40 tokens · $0.0010". */
function describeTurn(end, model) {
  return [
    end.interrupted && 'interrupted',
    `${(end.durationMs / 1000).toFixed(1)}s`,
    end.toolCalls > 0 && `${end.toolCalls} tool call${end.toolCalls === 1 ? '' : 's'}`,
    `in ${end.usage.input_tokens ?? 0} · out ${end.usage.output_tokens ?? 0} tokens`,
    hasPrice(model) ? formatCost(end.cost) : 'price unknown',
    end.stopReason && end.stopReason !== 'end_turn' && `stop: ${end.stopReason}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Phase 13: add a subagent's tool_start / tool_end to its Task call's progress lines. */
function withProgress(tool, event) {
  const progress = tool.progress ?? [];
  if (event.type === EVENT.TOOL_START) {
    return { ...tool, progress: [...progress, { id: event.id, name: event.name, summary: event.summary, running: true }], progressCount: (tool.progressCount ?? 0) + 1 };
  }
  if (event.type === EVENT.TOOL_END) {
    return { ...tool, progress: progress.map((line) => (line.id === event.id ? { ...line, running: false, isError: event.isError } : line)) };
  }
  return tool;
}

export function App({ session, version }) {
  const { exit } = useApp();
  const [items, setItems] = useState([entry('banner')]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null); // { text, continued }: streamed text not yet moved into <Static>
  const [liveTools, setLiveTools] = useState([]); // tool calls currently running
  const [retryNote, setRetryNote] = useState(null);
  const [hint, setHint] = useState(null);
  const [permission, setPermission] = useState(null); // { request, finish } while a dialog is open
  const [plan, setPlan] = useState(null); // Phase 11: { request, finish } while a plan waits for approval
  const [sent, setSent] = useState([]); // Phase 17: what you typed before, for ↑/↓
  const [rewinding, setRewinding] = useState(null); // Phase 21: the turns shown in the rewind dialog
  const lastEscape = useRef(0);
  const [, setModeTick] = useState(0); // re-render when the permission mode changes

  // Phase 06: when the gate says "ask", show the dialog and wait for your answer.
  useEffect(() => {
    session.requestPermission = (request) =>
      new Promise((resolve) => {
        const finish = (answer) => {
          setPermission(null);
          resolve(answer);
        };
        // Interrupting (Esc/Ctrl+C) while the dialog is open counts as "no".
        request.signal?.addEventListener('abort', () => finish({ behavior: 'deny', reason: 'Interrupted by the user.' }), { once: true });
        setPermission({ request, finish });
      });
    // Phase 11: the model called ExitPlanMode. Show the plan and wait.
    session.requestPlanApproval = (request) =>
      new Promise((resolve) => {
        const finish = (answer) => {
          setPlan(null);
          setModeTick((n) => n + 1);
          resolve(answer);
        };
        request.signal?.addEventListener('abort', () => finish({ behavior: 'reject', reason: 'Interrupted by the user.' }), { once: true });
        setPlan({ request, finish });
      });
  }, [session]);

  // Phase 22: when a background task starts or ends, redraw the status bar; when one ends on its own, say so.
  useEffect(() => {
    const onChange = (task) => {
      setModeTick((n) => n + 1);
      if (task.status === 'exited') setItems((prev) => [...prev, entry('info', `Background task ${task.id} exited with code ${task.exitCode ?? 'none'}: ${task.command.split('\n')[0].slice(0, 60)}`)]);
    };
    session.tasks?.events.on('change', onChange);
    return () => session.tasks?.events.off('change', onChange);
  }, [session]);

  const abortRef = useRef(null); // AbortController for the reply in progress
  const lastCtrlC = useRef(0);

  const add = (...newItems) => setItems((prev) => [...prev, ...newItems]);

  // Keyboard shortcuts. (Ink's own "Ctrl+C quits" is switched off in start.jsx.)
  // While the permission dialog is open, it gets the keyboard instead.
  useInput((ch, key) => {
    const ctrlC = key.ctrl && ch === 'c';

    // Shift+Tab: default → accept edits → plan → default. Takes effect from the next tool call.
    // From bypass (/accept-all-permissions) it goes back to default; it never goes INTO bypass.
    if (key.tab && key.shift) {
      session.permissions.mode = nextMode(session.permissions.mode);
      setModeTick((n) => n + 1);
      return;
    }

    if (busy) {
      if (ctrlC || key.escape) abortRef.current?.abort(); // stop this reply only
      return;
    }
    // Phase 21: Esc twice on an empty prompt opens the rewind dialog.
    if (key.escape && !input) {
      if (Date.now() - lastEscape.current < 800) {
        lastEscape.current = 0;
        const turns = session.checkpoints?.turns() ?? [];
        if (turns.length) setRewinding(turns);
        else {
          setHint('Nothing to rewind yet');
          setTimeout(() => setHint(null), 2000);
        }
      } else lastEscape.current = Date.now();
      return;
    }
    if (!ctrlC) return;
    if (input) return setInput(''); // first, clear what you typed
    if (Date.now() - lastCtrlC.current < 2000) return exit(); // second press quits
    lastCtrlC.current = Date.now();
    setHint('Press Ctrl+C again to exit');
    setTimeout(() => setHint(null), 2000);
  }, { isActive: !permission && !plan && !rewinding });

  /** Phase 21: the rewind dialog's answer. */
  async function rewindTo(turn, what) {
    setRewinding(null);
    try {
      const result = await session.rewind(turn.id, { code: what !== 'conversation', conversation: what !== 'code' });
      add(entry('divider', describeRewind(session, result, what)));
      if (what !== 'code') setInput(turn.prompt); // what you typed then, to edit and send again
    } catch (error) {
      add(entry('error', error.message));
    }
  }

  async function handleSubmit(value) {
    const text = value.trim();
    if (!text || busy) return;
    setInput('');
    setSent((prev) => (prev.at(-1) === text ? prev : [...prev, text]));

    // Slash commands are handled by the harness and never reach the model.
    if (isCommand(text)) {
      add(entry('user', text));
      setBusy(true); // some commands take a while (/compact, /models)
      const result = await runCommand(text, session).finally(() => setBusy(false));
      if (result.action === 'exit') return exit();
      if (result.action === 'prompt') {
        // /init and custom commands turn into a message to the model.
        add(entry('info', result.text));
        const undo = temporarilyAllow(session, result.allow); // a custom command's allowed-tools
        try {
          await runAgentTurn(result.prompt);
        } finally {
          undo();
        }
        if (result.reloadContext) await reloadContext();
        return;
      }
      if (result.action === 'rewound') {
        add(entry('divider', result.text));
        if (result.prompt) setInput(result.prompt);
        return;
      }
      if (result.action === 'resumed') {
        add(entry('divider', result.text));
        if (result.last) add(entry('assistant', textOf(result.last.content), { meta: 'last reply before you left' }));
        return;
      }
      add(entry(result.action === 'clear' ? 'divider' : 'info', result.text));
      return;
    }

    add(entry('user', text));
    await runAgentTurn(text);
  }

  /**
   * After /init: re-read NOOBLY.md files. The system prompt is NOT changed now:
   * changing it mid-conversation breaks prompt caching and Claude's thinking
   * blocks (see docs 08). It's used from the next conversation (/clear or restart).
   */
  async function reloadContext() {
    session.context = await loadContext(session.cwd);
    const count = session.context.instructions.length;
    add(entry('info', `Found ${count} instruction file(s). They'll be used from your next conversation (/clear or restart).`));
  }

  async function runAgentTurn(text) {
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Long replies would make the live area taller than the screen, so each
    // finished paragraph is moved into <Static> as soon as it is complete
    // (but never in the middle of a ``` code block: see safeSplitPoint).
    let pending = '';
    let continued = false; // has part of this reply already been moved to <Static>?
    let thinking = ''; // Phase 18: the thinking summary so far (shown once the answer starts)
    const flushThinking = () => {
      if (thinking.trim()) add(entry('thinking', thinking.trim()));
      thinking = '';
    };
    const flushParagraphs = () => {
      const cut = safeSplitPoint(pending);
      if (cut === -1) return;
      add(entry('assistant', pending.slice(0, cut), { continued }));
      continued = true;
      pending = pending.slice(cut + 2);
    };

    try {
      for await (const event of session.stream(text, { signal: controller.signal })) {
        if (event.type === EVENT.THINKING_DELTA) {
          thinking += event.text;
          setRetryNote(`Thinking: ${thinking.trim().split('\n').at(-1).slice(-80)}`);
          continue;
        }
        if (event.type !== EVENT.MESSAGE_START) flushThinking();
        if (event.type === EVENT.TOOL_START) {
          // The model's text before a tool call is finished: move it to <Static>.
          if (pending) add(entry('assistant', pending, { continued }));
          pending = '';
          continued = false;
          setLive(null);
          setLiveTools((tools) => [...tools, { ...event, status: 'running' }]);
        } else if (event.type === EVENT.SUBAGENT) {
          // Phase 13: show the subagent's tool calls under its Task call.
          setLiveTools((tools) => tools.map((tool) => (tool.id === event.parentId ? withProgress(tool, event.event) : tool)));
        } else if (event.type === EVENT.TOOL_END) {
          setLiveTools((tools) => tools.filter((tool) => tool.id !== event.id));
          add(entry('tool', '', { ...event, status: 'done' }));
        } else if (event.type === EVENT.NOTICE) {
          add(entry('info', event.text));
        } else if (event.type === EVENT.COMPACT_START) {
          setRetryNote(`Context ${Math.round((event.tokens / event.window) * 100)}% full: making room…`);
        } else if (event.type === EVENT.COMPACT) {
          setRetryNote(null);
          const how = event.method === 'cleared' ? 'cleared old tool output' : 'summarised earlier messages';
          add(entry('divider', `✻ Context compacted (${how}): ~${event.before.toLocaleString()} → ~${event.after.toLocaleString()} tokens`));
        } else if (event.type === EVENT.TEXT_DELTA) {
          pending += event.text;
          flushParagraphs();
          setLive({ text: pending, continued });
          setRetryNote(null);
        } else if (event.type === EVENT.STREAM_RESET) {
          // Phase 18: the connection broke mid-reply and the reply starts again.
          if (pending) add(entry('assistant', pending, { continued, warn: true, meta: 'cut off' }));
          add(entry('info', `${event.error}. Asking again…`));
          pending = '';
          continued = false;
          setLive(null);
        } else if (event.type === EVENT.RETRY) {
          setRetryNote(`${event.error}. Retrying in ${(event.delayMs / 1000).toFixed(1)}s (attempt ${event.attempt})`);
        } else if (event.type === EVENT.TURN_END) {
          // If the reply ended right after a tool (no final text), show just the stats line.
          const statsOnly = !pending && !continued;
          add(entry('assistant', pending, { continued: continued || statsOnly, meta: describeTurn(event, session.model), warn: event.interrupted }));
        }
      }
    } catch (error) {
      if (pending) add(entry('assistant', pending, { continued }));
      add(entry('error', error.message));
    } finally {
      setLive(null);
      setLiveTools([]);
      setRetryNote(null);
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item) =>
          item.kind === 'banner' ? (
            <Banner
              key={item.id}
              version={version}
              model={session.model}
              provider={session.provider.name}
              cwd={process.cwd()}
              mode={session.permissions.mode}
              instructionFiles={session.context?.instructions.length ?? 0}
              settingsFiles={(session.settingsInfo?.loaded ?? []).map((file) => file.replace(process.cwd() + '/', '').replace(process.env.HOME ?? '~', '~'))}
              notices={session.settingsInfo?.notices ?? []}
              resumed={session.resumedFrom}
            />
          ) : item.kind === 'tool' ? (
            <ToolCall key={item.id} item={item} />
          ) : (
            <Message key={item.id} item={item} />
          )
        }
      </Static>

      {live?.text && <Message item={{ kind: 'assistant', ...live }} />}
      {liveTools.map((tool) => (
        <ToolCall key={tool.id} item={tool} />
      ))}
      {busy && <TodoList todos={session.todos} />}
      {plan ? (
        <PlanDialog request={plan.request} onAnswer={plan.finish} onInterrupt={() => abortRef.current?.abort()} />
      ) : permission ? (
        <PermissionDialog request={permission.request} onAnswer={permission.finish} onInterrupt={() => abortRef.current?.abort()} />
      ) : rewinding ? (
        <RewindDialog turns={rewinding} cwd={session.cwd} onChoose={rewindTo} onCancel={() => setRewinding(null)} />
      ) : busy ? (
        <Thinking streaming={Boolean(live)} note={retryNote} />
      ) : (
        <PromptInput value={input} onChange={setInput} onSubmit={handleSubmit} history={sent} />
      )}
      <StatusBar session={session} hint={hint} />
    </Box>
  );
}
