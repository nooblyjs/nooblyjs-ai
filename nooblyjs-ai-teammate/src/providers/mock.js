// Offline provider: deterministic responses and estimated usage. Used when no Anthropic credentials are configured.
const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 4);
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

export class MockProvider {
  name = 'mock';

  constructor({ delayMs = 12 } = {}) {
    this.delayMs = delayMs;
  }

  async run({ model, system, context, messages, tools, onText, signal, purpose }) {
    const prompt = messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const usage = (text) => ({ inputTokens: estimateTokens(system) + estimateTokens(context) + estimateTokens(prompt), outputTokens: estimateTokens(text), cacheReadTokens: 0, cacheWriteTokens: 0 });
    const last = messages.at(-1);

    // Tools: after tool results come back, answer with them; otherwise call a tool when the task clearly asks for one.
    if (purpose !== 'reflection' && tools?.length) {
      if (Array.isArray(last?.content) && last.content.some((b) => b.type === 'tool_result')) {
        const parts = last.content.map((b) => `- ${b.is_error ? 'Problem' : 'Result'}: ${String(b.content).replace(/\s+/g, ' ').slice(0, 300)}`);
        const text = [`**${model.name}, offline mock**`, '', 'Here is what came back from the tools I used:', '', ...parts, '', 'That completes the task.'].join('\n');
        await this.emit(text, onText, signal);
        return { text, content: [{ type: 'text', text }], toolCalls: [], stopReason: 'end_turn', stopDetails: null, servedBy: `mock:${model.modelId}`, usage: usage(text) };
      }
      const call = MockProvider.pickToolCall(tools, String(last?.content ?? ''));
      if (call) {
        const text = `I'll use ${call.name} for this.`;
        await this.emit(text, onText, signal);
        const id = `toolu_mock_${Math.random().toString(36).slice(2, 10)}`;
        return {
          text, content: [{ type: 'text', text }, { type: 'tool_use', id, name: call.name, input: call.input }], toolCalls: [{ id, name: call.name, input: call.input }],
          stopReason: 'tool_use', stopDetails: null, servedBy: `mock:${model.modelId}`, usage: usage(text),
        };
      }
    }

    let text;
    if (purpose === 'reflection') {
      const task = /Task:\n(.*)/.exec(prompt)?.[1]?.slice(0, 120) ?? 'a task';
      text = JSON.stringify([{ kind: 'fact', text: `Completed "${task}" (offline mock run).` }]);
    } else {
      const who = /You are ([^,]+), an? ([^.]+?) on/.exec(system);
      const task = messages.at(-1)?.content ?? '';
      // Like a real model, cite the reference documents it was given and acknowledge an ongoing conversation.
      const cited = [...new Set([...String(context ?? '').matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]))];
      const earlier = (messages.length - 1) / 2;
      const lines = [`**${who?.[1] ?? 'Your teammate'} (${model.name}, offline mock)**`, ''];
      if (earlier) lines.push(`Following up on our earlier conversation (${earlier} earlier ${earlier === 1 ? 'turn' : 'turns'}).`, '');
      lines.push(
        `Here's how I'd approach this as ${who?.[2] ? `a ${who[2]}` : 'your teammate'}:`,
        '',
        `1. Clarify the goal: "${task.slice(0, 160)}${task.length > 160 ? '…' : ''}"`,
        '2. Gather what I already know from memory and the attached skills.',
        '3. Do the work, flag anything uncertain, and summarize the result for you.',
        '',
      );
      if (cited.length) lines.push(`Sources: ${cited.map((t) => `[${t}]`).join(', ')}`, '');
      lines.push('This is a mock response because no Anthropic credentials are configured. Set ANTHROPIC_API_KEY (or AI_PROVIDER=anthropic) to have this teammate do real work.');
      text = lines.join('\n');
      await this.emit(text, onText, signal);
    }
    return { text, content: [{ type: 'text', text }], toolCalls: [], stopReason: 'end_turn', stopDetails: null, servedBy: `mock:${model.modelId}`, usage: usage(text) };
  }

  async emit(text, onText, signal) {
    for (const word of text.split(/(?<=\s)/)) {
      onText?.(word);
      await sleep(this.delayMs, signal);
    }
  }

  /**
   * Deterministic tool choice for offline runs: delegate when the task names a teammate (or their role) the tool
   * lists, fetch a URL that appears in the task, notify when asked to notify, or call an MCP tool named in the task.
   */
  static pickToolCall(tools, task) {
    const lower = task.toLowerCase();
    for (const t of tools) {
      if (t.name === 'delegate') {
        for (const [, id, name, role] of t.description.matchAll(/^- ([a-z0-9-]+): (.+?) \((.+?)\)$/gm)) {
          if (lower.includes(name.split(' ')[0].toLowerCase()) || lower.includes(role.toLowerCase())) {
            return { name: 'delegate', input: { teammate: id, task: `Write this up for the team: ${task.split('\n')[0].slice(0, 300)}` } };
          }
        }
      } else if (t.name === 'fetch_url') {
        const url = /https?:\/\/[^\s)>\]"']+/.exec(task)?.[0];
        if (url) return { name: 'fetch_url', input: { url } };
      } else if (t.name === 'notify' && /\bnotify\b|let (the )?team know/.test(lower)) {
        return { name: 'notify', input: { subject: task.split('\n')[0].slice(0, 80), message: task } };
      } else if (t.name.startsWith('mcp__')) {
        const tool = t.name.split('__').pop();
        if (lower.includes(tool.toLowerCase())) {
          const input = {};
          for (const key of t.input_schema?.required ?? []) input[key] = t.input_schema.properties?.[key]?.type === 'number' ? 1 : task.slice(0, 200);
          return { name: t.name, input };
        }
      }
    }
    return null;
  }
}
