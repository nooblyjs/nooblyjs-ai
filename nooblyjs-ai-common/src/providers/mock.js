// A scripted provider for tests, and for running an app offline. You give it the
// replies in order; it streams them back as events and records every request it
// received. Moved here from the harness's providers/mock.js.
//
//   const provider = createMockProvider([
//     { text: 'Let me look.', tools: [{ name: 'Read', input: { file_path: 'a.txt' } }] },
//     new ApiError(529, 'overloaded_error', '…'),   // this request fails
//     { text: 'Done', stopReason: 'max_tokens' },
//   ]);
//
// A reply with `tools` gets stop_reason "tool_use" automatically.
import { EVENT } from './events.js';

export function createMockProvider(script, { chunkSize = 3 } = {}) {
  const queue = [...script];
  const requests = [];
  let toolIds = 0;

  return {
    name: 'mock',
    requests,

    async *stream(request, { signal } = {}) {
      requests.push(structuredClone(request));
      const turn = queue.shift();
      if (!turn) throw new Error('Mock provider: no more scripted replies');
      if (turn instanceof Error) throw turn;

      const text = turn.text ?? '';
      const usage = turn.usage ?? { input_tokens: 10, output_tokens: 5 };
      yield { type: EVENT.MESSAGE_START, model: request.model, usage: { input_tokens: usage.input_tokens } };

      for (let i = 0; i < text.length; i += chunkSize) {
        signal?.throwIfAborted();
        yield { type: EVENT.TEXT_DELTA, text: text.slice(i, i + chunkSize) };
        await turn.onChunk?.(i);
      }
      if (turn.failMidStream) throw turn.failMidStream;

      const toolUses = (turn.tools ?? []).map((tool) => ({
        type: 'tool_use',
        id: tool.id ?? `toolu_mock_${++toolIds}`,
        name: tool.name,
        input: tool.input ?? {},
      }));
      const content = turn.content ?? [...(text ? [{ type: 'text', text }] : []), ...toolUses];

      yield {
        type: EVENT.MESSAGE,
        message: {
          model: request.model,
          content,
          stop_reason: turn.stopReason ?? (toolUses.length ? 'tool_use' : 'end_turn'),
          usage,
        },
      };
    },
  };
}
