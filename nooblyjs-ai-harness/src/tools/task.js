// Phase 13: the Task tool. The model delegates a job to a subagent.
//
//   Task({ subagent_type: "explore", description: "Find settings readers",
//          prompt: "Find every place settings are read…" })
//
// The subagent works in its own context window and returns ONE reply. Several
// Task calls in the same message run at the same time if they can't change
// anything (read-only agents like explore).
import { runSubagent } from '../agents/subagent.js';
import { createWorktree, finishWorktree } from '../agents/worktree.js';
import { defineTool, ToolError } from './tool.js';

export const taskTool = defineTool({
  name: 'Task',
  // The permission gate never asks about Task itself: every tool the subagent
  // uses goes through the same gate (and the same questions) one by one.
  isReadOnly: true,
  // …but two subagents that might EDIT must not run at the same time.
  isConcurrencySafe: (input, session) => {
    if (input?.isolation === 'worktree') return true; // Phase 29: separate folders can't collide
    const agent = session.agents?.find((a) => a.name === input?.subagent_type);
    return Boolean(agent?.tools?.length) && agent.tools.every((name) => session.tools.get(name)?.isReadOnly === true);
  },
  description: [
    'Hand a task to a subagent: a separate AI agent with a fresh context window. It works on its own and returns only its final report.',
    'Use it when a job would fill your context with material you won\'t need afterwards: broad searches ("where is X used?"), reading many files to answer one question, or an independent piece of work.',
    'The available subagent types are listed in the system prompt under "Subagents". For several independent questions, send several Task calls in ONE reply: read-only ones run in parallel.',
    'The subagent knows nothing of this conversation: write a complete, self-contained prompt (goal, relevant paths, what to report back).',
    'Don\'t use it for simple lookups you can do with one Read/Glob/Grep: that is faster and cheaper done directly.',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'A 3-5 word label for the task, shown to the user' },
      prompt: { type: 'string', description: 'The full task for the subagent' },
      subagent_type: { type: 'string', description: 'Which subagent to use, e.g. "explore" or "general"' },
      isolation: {
        type: 'string',
        enum: ['worktree'],
        description: 'Give the subagent its own git worktree and branch (from the last commit). Use it for editing tasks that should run in parallel; its changes come back as a branch to merge.',
      },
    },
    required: ['description', 'prompt', 'subagent_type'],
    additionalProperties: false,
  },

  summarize: ({ subagent_type, description }) => `${subagent_type}: ${description}`,

  async call({ prompt, subagent_type, description, isolation }, ctx) {
    const session = ctx.session;
    if (session.isSubagent) throw new ToolError('Subagents cannot start subagents. Do the work yourself.');
    const agent = session.agents.find((a) => a.name === subagent_type);
    if (!agent) {
      throw new ToolError(`There is no subagent called "${subagent_type}". Choose one of: ${session.agents.map((a) => a.name).join(', ')}.`);
    }

    // Phase 29: its own worktree and branch, cleaned up whatever happens.
    let worktree = null;
    if (isolation === 'worktree') {
      try {
        worktree = await createWorktree(session.cwd, description || subagent_type);
      } catch (error) {
        throw new ToolError(error.message);
      }
    }
    let result;
    let outcome = null;
    try {
      result = await runSubagent(session, agent, prompt, { signal: ctx.signal, emit: ctx.emit, toolUseId: ctx.toolUseId, worktree });
    } finally {
      if (worktree) outcome = await finishWorktree(worktree, `noobly subagent (${subagent_type}): ${description || 'task'}${result?.interrupted || !result ? ' (interrupted)' : ''}`);
    }
    const tokens = (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0) + (result.usage.cache_read_input_tokens ?? 0) + (result.usage.cache_creation_input_tokens ?? 0);
    const stats = `${result.toolCalls} tool use${result.toolCalls === 1 ? '' : 's'} · ${tokens.toLocaleString()} tokens · ${(result.durationMs / 1000).toFixed(1)}s`;

    let content = result.text || '(The subagent finished without writing a final reply.)';
    if (result.interrupted) content = `The subagent was interrupted by the user. Its last words: ${content}`;
    else if (result.stopReason === 'max_turns') content += '\n\n(The subagent hit its round limit before finishing, so this may be incomplete.)';
    if (outcome) {
      content += outcome.changed
        ? `\n\n[Worktree: the changes were committed to branch ${outcome.branch} (not merged into the working folder). The user can merge it with /merge ${outcome.branch}.]\n${outcome.stat}`
        : '\n\n[Worktree: no files were changed, so the worktree and its branch were removed.]';
    }
    const branchNote = outcome?.changed ? ` · branch ${outcome.branch}` : '';
    return { content, display: `${result.interrupted ? 'Interrupted' : 'Done'} (${stats})${branchNote}`, usage: result.usage, cost: result.cost };
  },
});
