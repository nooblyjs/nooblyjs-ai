// Phase 11: a todo list the MODEL keeps for itself.
//
// Why would a model need a todo list? It "remembers" the whole conversation…
// but on a long task that memory is a pile of file contents and command output,
// and the plan made at the start gets buried under it. A short list the model
// rewrites as it goes keeps the plan near the end of the conversation, where
// models pay the most attention, and shows YOU what it is doing and what's left.
//
// The model sends the WHOLE list every time (not "add item 3"): simpler for the
// model, and the latest call is always the complete truth.
import { defineTool, ToolError } from './tool.js';

export const TODO_STATUSES = ['pending', 'in_progress', 'completed'];
const ICONS = { pending: '☐', in_progress: '◐', completed: '☒' };

export const todoWriteTool = defineTool({
  name: 'TodoWrite',
  // It only changes noobly's own notes, never your files, so it's allowed in every mode (plan mode too).
  isReadOnly: true,
  description: [
    'Create or update your todo list for the current task. Send the COMPLETE list every time: it replaces the previous one.',
    'Use it for tasks with 3 or more steps, or when the user gives you several things to do. Skip it for quick questions and one-step changes.',
    'Rules:',
    '- Write the list before you start, based on what you have learned.',
    '- Exactly one item should be "in_progress" while you are working. Mark it "completed" as soon as it is done, then start the next.',
    '- Only mark an item completed when it is really finished (tests pass, nothing half-done). If you are blocked, keep it in_progress and add an item for the blocker.',
    '- Add items you discover along the way; remove ones that no longer apply.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: 'The full, updated todo list',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'What to do, as an instruction, e.g. "Run the tests"' },
            status: { type: 'string', enum: TODO_STATUSES },
            activeForm: { type: 'string', description: 'The same step while it happens, e.g. "Running the tests"' },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
    additionalProperties: false,
  },

  summarize: ({ todos }) => {
    if (!Array.isArray(todos)) return '';
    const done = todos.filter((t) => t?.status === 'completed').length;
    return `${done}/${todos.length} done`;
  },

  async call({ todos }, ctx) {
    const problem = checkTodos(todos);
    if (problem) throw new ToolError(`Invalid todo list: ${problem}`);
    const clean = todos.map(({ content, status, activeForm }) => ({ content: content.trim(), status, ...(activeForm && { activeForm }) }));
    ctx.session.todos = clean;

    const open = clean.filter((t) => t.status !== 'completed').length;
    const note = clean.length === 0 ? 'The todo list is now empty.' : open === 0 ? 'Every item is completed.' : `${open} item(s) still open. Keep going, and update the list as you finish each one.`;
    return { content: `Todo list updated. ${note}`, display: `${clean.length - open}/${clean.length} done`, preview: formatTodos(clean) };
  },
});

/** Check what the schema checker can't: every item, and at most one in progress. */
export function checkTodos(todos) {
  for (const [i, todo] of todos.entries()) {
    if (typeof todo?.content !== 'string' || !todo.content.trim()) return `item ${i + 1} needs a non-empty "content".`;
    if (!TODO_STATUSES.includes(todo.status)) return `item ${i + 1} has status "${todo.status}"; use one of ${TODO_STATUSES.join(', ')}.`;
  }
  const active = todos.filter((t) => t.status === 'in_progress').length;
  if (active > 1) return `${active} items are in_progress. Work on one thing at a time: keep one in_progress and set the others to pending.`;
  return null;
}

/** ["☒ Read the code", "◐ Running the tests", "☐ Update the docs"] */
export function formatTodos(todos) {
  return todos.map((t) => `${ICONS[t.status]} ${t.status === 'in_progress' ? (t.activeForm ?? t.content) : t.content}`);
}

/** The list as a system reminder (after compaction, the TodoWrite calls that made it may be gone). */
export function todoReminder(todos) {
  const lines = todos.map((t) => `${ICONS[t.status]} [${t.status}] ${t.content}`);
  return `Your todo list (kept from before the conversation was summarized). Continue from it and keep it up to date with TodoWrite:\n${lines.join('\n')}`;
}

/** Rebuild the todo list from history: the input of the last successful TodoWrite call (used when resuming). */
export function todosFromHistory(history) {
  const failed = new Set();
  for (const message of history) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    for (const block of message.content) if (block.type === 'tool_result' && block.is_error) failed.add(block.tool_use_id);
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const call = message.content.findLast((b) => b.type === 'tool_use' && b.name === 'TodoWrite' && !failed.has(b.id));
    if (call && Array.isArray(call.input?.todos) && !checkTodos(call.input.todos)) return call.input.todos;
  }
  return [];
}
