// A fake provider that never calls the internet, so you can try noobly for free
// with `noobly --echo`.
//
// - Normally it repeats what you said, one word at a time (try Ctrl+C / Esc).
// - It pretends to use tools when you type one of these, just like a real model:
//     read <file>        → Read
//     find <pattern>     → Glob, e.g. find src/**/*.jsx
//     grep <regex>       → Grep
//     run <command>      → Bash, e.g. run ps aux | head -5
//     write <file> <text> → Write (shows the permission dialog, Phase 06)
//     markdown           → a reply full of Markdown, to see it rendered
//     search <word>      → Glob AND Grep in the same reply (they run in parallel)
//     todo a; b; c       → TodoWrite (Phase 11), the first item in progress
//     plan <text>        → ExitPlanMode (Phase 11; switch to plan mode first with Shift+Tab)
//     task <prompt>      → Task: an explore subagent gets <prompt> (Phase 13), e.g. task read package.json
//     tasks <a> | <b>    → two explore subagents in parallel
//     skill <name>       → Skill (Phase 15)
//     mcp <tool> <json>  → an MCP tool (Phase 14), e.g. mcp mcp__echo__echo {"text":"hi"}
//     fetch <url> [question] → WebFetch (Phase 18)
//     think <text>       → streams a pretend "thinking summary" first (Phase 18)
//   When the tool results come back, it reports on them.
import { EVENT } from '../core/events.js';
import { sleep } from './retry.js';

export function createEchoProvider({ wordDelayMs = 60 } = {}) {
  let toolIds = 0;

  return {
    name: 'echo',

    async *stream({ model, system, messages }, { signal } = {}) {
      const last = messages.at(-1);
      const usage = { input_tokens: Math.ceil(JSON.stringify(messages).length / 4), output_tokens: 0 };
      yield { type: EVENT.MESSAGE_START, model, usage };

      // Phase 08: a summarisation request gets a (fake) short summary instead of an echo.
      const { text, toolUse, extraTools, thinking } = system?.startsWith('You write summaries')
        ? { text: `Summary (from the echo provider): an earlier conversation of about ${Math.round(JSON.stringify(messages).length / 4)} tokens was summarised here.` }
        : decideReply(last, messages.length);
      for (const word of (thinking ?? '').split(/(?<= )/).filter(Boolean)) {
        await sleep(wordDelayMs, signal);
        yield { type: EVENT.THINKING_DELTA, text: word };
      }
      for (const word of text.split(/(?<= )/)) {
        await sleep(wordDelayMs, signal);
        yield { type: EVENT.TEXT_DELTA, text: word };
      }

      const toolUses = (toolUse ? [toolUse] : []).concat(extraTools ?? []);
      const content = [{ type: 'text', text }];
      for (const use of toolUses) content.push({ type: 'tool_use', id: `toolu_echo_${++toolIds}`, ...use });

      yield {
        type: EVENT.MESSAGE,
        message: {
          model,
          content,
          stop_reason: toolUses.length ? 'tool_use' : 'end_turn',
          usage: { ...usage, output_tokens: Math.ceil(text.length / 4) },
        },
      };
    },
  };
}

const COMMANDS = [
  [/^read\s+(\S+)/i, (m) => ({ name: 'Read', input: { file_path: m[1] } })],
  [/^find\s+(\S+)/i, (m) => ({ name: 'Glob', input: { pattern: m[1] } })],
  [/^grep\s+(.+)/i, (m) => ({ name: 'Grep', input: { pattern: m[1].trim(), output_mode: 'content', head_limit: 20 } })],
  [/^run\s+(.+)/is, (m) => ({ name: 'Bash', input: { command: m[1].trim() } })],
  [/^write\s+(\S+)\s+(.+)/is, (m) => ({ name: 'Write', input: { file_path: m[1], content: `${m[2]}\n` } })],
  [
    /^todo\s+(.+)/is,
    (m) => ({
      name: 'TodoWrite',
      input: { todos: m[1].split(';').map((item, i) => ({ content: item.trim(), status: i === 0 ? 'in_progress' : 'pending' })).filter((t) => t.content) },
    }),
  ],
  [/^plan\s+(.+)/is, (m) => ({ name: 'ExitPlanMode', input: { plan: m[1].trim() } })],
  [/^task\s+(.+)/is, (m) => ({ name: 'Task', input: { subagent_type: 'explore', description: m[1].trim().slice(0, 30), prompt: m[1].trim() } })],
  [/^skill\s+(\S+)(.*)/is, (m) => ({ name: 'Skill', input: { skill: m[1], ...(m[2].trim() && { args: m[2].trim() }) } })],
  [/^mcp\s+(\S+)\s*(.*)/is, (m) => ({ name: m[1], input: parseJson(m[2]) })],
  [/^fetch\s+(\S+)\s*(.*)/is, (m) => ({ name: 'WebFetch', input: { url: m[1], ...(m[2].trim() && { prompt: m[2].trim() }) } })],
];

function parseJson(text) {
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return { text };
  }
}

function decideReply(last, messageCount) {
  // We are being sent tool results: report on each one.
  if (Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
    const reports = last.content.map((result, i) => {
      if (result.is_error) return `Result ${i + 1} was an error: ${result.content}`;
      const lines = result.content.split('\n');
      return `Result ${i + 1} has ${lines.length} line(s), starting with: ${lines[0].trim()}`;
    });
    return { text: reports.join(' ') };
  }

  // Our message may carry <system-reminder> blocks after the text; the first block is what you typed.
  const said = typeof last.content === 'string' ? last.content : (last.content.find((b) => b.type === 'text')?.text ?? '(non-text message)');
  if (/^markdown$/i.test(said.trim())) return { text: MARKDOWN_SAMPLE };
  const reminders = Array.isArray(last.content) ? last.content.filter((b) => b.text?.startsWith('<system-reminder>')).length : 0;

  const think = said.match(/^think\s+(.+)/is);
  if (think) {
    return { thinking: `The user wants me to think about "${think[1].trim()}". This is the echo provider, so this "thinking" is pretend: a real model would reason here first. `, text: `Done thinking about: ${think[1].trim()}` };
  }

  const tasks = said.match(/^tasks\s+(.+)\|(.+)/is);
  if (tasks) {
    const task = (prompt) => ({ name: 'Task', input: { subagent_type: 'explore', description: prompt.trim().slice(0, 30), prompt: prompt.trim() } });
    return { text: 'I\'ll ask two explore subagents at the same time. ', toolUse: task(tasks[1]), extraTools: [task(tasks[2])] };
  }

  const search = said.match(/^search\s+(\S+)/i);
  if (search) {
    return {
      text: `I'll look for file names and file contents mentioning ${search[1]} at the same time. `,
      toolUse: { name: 'Glob', input: { pattern: `**/*${search[1]}*` } },
      extraTools: [{ name: 'Grep', input: { pattern: search[1] } }],
    };
  }
  for (const [pattern, makeToolUse] of COMMANDS) {
    const match = said.match(pattern);
    if (match) {
      const toolUse = makeToolUse(match);
      return { text: `I'll use the ${toolUse.name} tool. `, toolUse };
    }
  }

  return {
    text:
      `You said: "${said}". This is the echo provider, so no real model is involved. ` +
      `I can see ${messageCount} message(s) in the history I was sent` +
      (reminders ? `, and ${reminders} system reminder(s) from noobly. ` : '. ') +
      'To see tools, try: read package.json, find src/**/*.jsx, grep TODO, run ls -la, or search loop.',
  };
}

const MARKDOWN_SAMPLE = `## Markdown rendering

Models reply in **Markdown**, so noobly renders it: *italic*, ~~strikethrough~~, \`inline code\` and [links](https://github.com/nooblyjs/nooblyjs-learn-harness).

- Bullet lists
  - with nesting
- [x] and task items

1. Numbered
2. lists

| Tool | Read-only | Phase |
|------|:---------:|------:|
| Read | yes | 4 |
| Edit | no | 5 |

> Quotes get a bar on the left.

\`\`\`js
// A code block with a blank line inside

const answer = 42;
\`\`\`

---
That's it.`;
