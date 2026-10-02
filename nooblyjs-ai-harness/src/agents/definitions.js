// Phase 13: the kinds of subagent the model can delegate to.
//
// Two are built in:
//   general  every tool (except Task: subagents can't start subagents)
//   explore  read-only search tools, told to come back with a SHORT report
//
// You can add your own as Markdown files:
//
//   .noobly/agents/test-runner.md      (this project)
//   ~/.noobly/agents/test-runner.md    (you, in every project)
//
//   ---
//   name: test-runner
//   description: Runs the test suite and reports only the failures
//   tools: Bash, Read, Grep
//   model: claude-haiku-4-5
//   ---
//   You run tests. Run `npm test`, then report each failing test with …
//
// The body becomes the subagent's instructions. `tools` limits what it may use
// (default: all); `model` picks a (cheaper?) model for it (default: yours).
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from '../util/frontmatter.js';
import { nooblyHome } from '../util/paths.js';
import { splitRules } from '../commands/custom.js';

export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep'];

export const BUILTIN_AGENTS = [
  {
    name: 'general',
    description: 'A general-purpose agent for multi-step tasks: researching a question, or making a self-contained change. Has every tool.',
    tools: null, // all
    scope: 'built-in',
    instructions: 'Complete the task you were given. When you are done, reply with a short report of what you did and found: the parent agent only sees that final reply.',
  },
  {
    name: 'explore',
    description: 'A fast, read-only agent for searching the codebase: finding files, definitions, usages, or answering "where/how is X done?". Cannot change anything.',
    tools: READ_ONLY_TOOLS,
    scope: 'built-in',
    instructions: [
      'You are a read-only search agent. Use Glob, Grep and Read to answer the question.',
      'Search efficiently: request independent searches together so they run in parallel.',
      'Your final reply is all the parent agent sees, so make it a concise report: the answer, with file paths and line numbers as evidence. Do not paste whole files.',
    ].join('\n'),
  },
];

export function agentFolders(cwd, nooblyDir = nooblyHome()) {
  return [
    { scope: 'user', dir: path.join(nooblyDir, 'agents') },
    { scope: 'project', dir: path.join(cwd, '.noobly', 'agents') },
  ];
}

/**
 * Built-in agents plus your own. Later folders win on a name clash (project over user over built-in).
 * @returns {Array<{ name: string, description: string, tools: string[] | null, model?: string, instructions: string, scope: string, file?: string }>}
 */
export function loadAgents(cwd, { nooblyDir } = {}) {
  const agents = new Map(BUILTIN_AGENTS.map((agent) => [agent.name, agent]));
  for (const { scope, dir } of agentFolders(cwd, nooblyDir)) {
    if (!fs.existsSync(dir)) continue;
    for (const fileName of fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort()) {
      const file = path.join(dir, fileName);
      const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
      const name = data.name || fileName.slice(0, -3);
      const tools = Array.isArray(data.tools) ? data.tools : splitRules(data.tools);
      agents.set(name, {
        name,
        description: data.description ?? body.trim().split('\n')[0].slice(0, 100),
        tools: tools.length ? tools : null,
        ...(data.model && { model: data.model }),
        instructions: body.trim(),
        scope,
        file,
      });
    }
  }
  return [...agents.values()];
}
