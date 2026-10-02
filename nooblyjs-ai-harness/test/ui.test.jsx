import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToString } from 'ink';
import { Message } from '../src/ui/components/Message.jsx';
import { PlanDialog } from '../src/ui/components/PlanDialog.jsx';
import { RewindDialog } from '../src/ui/components/RewindDialog.jsx';
import { TodoList } from '../src/ui/components/TodoList.jsx';
import { ToolCall } from '../src/ui/components/ToolCall.jsx';

test('assistant message shows the text and the stats line', () => {
  const out = renderToString(<Message item={{ id: 1, kind: 'assistant', text: 'Hello!', meta: '1.0s · $0.01' }} />);
  assert.match(out, /● Hello!/);
  assert.match(out, /⎿ 1.0s · \$0.01/);
});

test('user message is prefixed with the prompt arrow', () => {
  const out = renderToString(<Message item={{ id: 2, kind: 'user', text: 'hi' }} />);
  assert.match(out, /❯ hi/);
});

// Phases 11 and 13: new components.

test('the todo list shows each item with its state', () => {
  const out = renderToString(
    <TodoList
      todos={[
        { content: 'Read the code', status: 'completed' },
        { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
        { content: 'Write docs', status: 'pending' },
      ]}
    />,
  );
  assert.match(out, /☒ Read the code/);
  assert.match(out, /◐ Running tests/);
  assert.match(out, /☐ Write docs/);
  assert.equal(renderToString(<TodoList todos={[]} />), '');
});

test('the plan dialog renders the plan as Markdown with the three choices', () => {
  const out = renderToString(<PlanDialog request={{ plan: '## Steps\n1. **Edit** loop.js' }} onAnswer={() => {}} onInterrupt={() => {}} />);
  assert.match(out, /Steps/);
  assert.match(out, /Edit loop\.js/);
  assert.match(out, /1\. Yes, and auto-accept edits/);
  assert.match(out, /3\. No, keep planning/);
});

test('a running Task shows its subagent\'s latest tool calls', () => {
  const progress = Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: 'Read', summary: `f${i}.js`, running: i === 5 }));
  const out = renderToString(<ToolCall item={{ name: 'Task', summary: 'explore: find it', status: 'running', progress, progressCount: 6 }} />);
  assert.match(out, /… 2 earlier tool uses/);
  assert.doesNotMatch(out, /f1\.js/);
  assert.match(out, /● Read\(f4\.js\)/);
  assert.match(out, /… Read\(f5\.js\)/);
});

// Phase 21

test('the rewind dialog lists earlier messages with what changed, the newest selected', () => {
  const turns = [
    { id: 1, prompt: 'add a flag', files: ['/p/cli.js'], bashFiles: [], historyLength: 0 },
    { id: 2, prompt: 'run the build', files: [], bashFiles: ['/p/dist/a.js', '/p/dist/b.js'], historyLength: 4 },
  ];
  const out = renderToString(<RewindDialog turns={turns} cwd="/p" onChoose={() => {}} onCancel={() => {}} />);
  assert.match(out, /go back to before which message\?/);
  assert.match(out, /  add a flag  \(cli\.js\)/);
  assert.match(out, /❯ run the build  \(2 by commands\)/);
});
