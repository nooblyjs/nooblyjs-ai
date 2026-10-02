// Phase 22: the two tools for background tasks (started with Bash run_in_background).
//
//   TaskOutput  read what a task printed since the last read; optionally wait for
//               it to end, or for a line to appear ("ready on port 3000")
//   TaskStop    stop it, and everything it started
import { defineTool, ToolError } from './tool.js';

const MAX_WAIT_SECONDS = 120;

function findTask(ctx, id) {
  const task = ctx.session.tasks?.get(id);
  if (!task) {
    const ids = ctx.session.tasks?.list().map((t) => t.id) ?? [];
    throw new ToolError(`There is no background task ${id}.${ids.length ? ` Tasks: ${ids.join(', ')}.` : ' Start one with Bash and run_in_background: true.'}`);
  }
  return task;
}

export function describeStatus(task) {
  if (task.status === 'running') return `running for ${Math.round((Date.now() - task.startedAt) / 1000)}s`;
  if (task.status === 'stopped') return 'stopped';
  return `exited with code ${task.exitCode ?? 'none (killed)'}`;
}

export const taskOutputTool = defineTool({
  name: 'TaskOutput',
  // Reads output; changes nothing (so it runs in plan mode, and never asks).
  isReadOnly: true,
  description: [
    'Read the new output of a background task (a Bash command started with run_in_background: true): only what it printed since your last read.',
    `\`wait_seconds\` (max ${MAX_WAIT_SECONDS}) waits for the task to end first; with \`until\` (a regular expression) it stops waiting as soon as a matching line appears, e.g. until: "listening on|ready" for a server. Use this instead of calling TaskOutput again and again.`,
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      task_id: { type: 'integer', description: 'The task id Bash returned' },
      wait_seconds: { type: 'integer', description: `Wait up to this long for the task to end (or for \`until\`), max ${MAX_WAIT_SECONDS}` },
      until: { type: 'string', description: 'Stop waiting when new output matches this regular expression' },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
  summarize: ({ task_id, until }) => `task ${task_id}${until ? ` until /${until}/` : ''}`,

  async call({ task_id, wait_seconds = 0, until }, ctx) {
    const task = findTask(ctx, task_id);
    if (until) {
      try {
        new RegExp(until);
      } catch (error) {
        throw new ToolError(`\`until\` is not a valid regular expression: ${error.message}`);
      }
    }
    let waited = '';
    if (wait_seconds > 0 || until) {
      const ms = Math.min(Math.max(wait_seconds || 30, 1), MAX_WAIT_SECONDS) * 1000;
      const why = await ctx.session.tasks.wait(task_id, { ms, until, signal: ctx.signal });
      if (why === 'timeout') waited = `(Waited ${ms / 1000}s: ${until ? `no line matched /${until}/ yet` : 'still running'}.)`;
    }
    const { text, notes } = ctx.session.tasks.read(task_id);
    task.notified ||= task.status !== 'running'; // it has now seen the ending
    const lineCount = text ? text.trimEnd().split('\n').length : 0;
    return {
      content: [`Task ${task.id} (\`${task.command.split('\n')[0]}\`) is ${describeStatus(task)}.`, waited, ...notes, text.trimEnd() || '(no new output)'].filter(Boolean).join('\n'),
      display: `${describeStatus(task)} · ${lineCount} new line${lineCount === 1 ? '' : 's'}`,
      preview: text.trimEnd().split('\n').slice(-4).filter(Boolean),
    };
  },
});

export const taskStopTool = defineTool({
  name: 'TaskStop',
  // It only stops a process noobly itself started; nothing on disk changes. So it never asks.
  isReadOnly: true,
  description: 'Stop a background task (and every process it started), e.g. a dev server you no longer need.',
  inputSchema: {
    type: 'object',
    properties: { task_id: { type: 'integer', description: 'The task id Bash returned' } },
    required: ['task_id'],
    additionalProperties: false,
  },
  summarize: ({ task_id }) => `task ${task_id}`,

  async call({ task_id }, ctx) {
    const task = findTask(ctx, task_id);
    const stopped = ctx.session.tasks.stop(task_id);
    return {
      content: stopped ? `Stopped task ${task.id} (\`${task.command.split('\n')[0]}\`).` : `Task ${task.id} had already ${describeStatus(task)}.`,
      display: stopped ? 'stopped' : describeStatus(task),
    };
  },
});
