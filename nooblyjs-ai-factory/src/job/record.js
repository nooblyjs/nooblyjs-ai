// @ts-check
// Phase F05: recording what the AGENT did, in the event log, at a sensible size.
//
// A harness turn emits hundreds of events: one text_delta per few characters.
// Storing each as a row would drown the log. So the recorder COALESCES:
//
//   text_delta × 300           →  one agent.event { kind: 'text', text: '…the whole paragraph…' }
//   tool_start                 →  agent.event { kind: 'tool', name, summary }
//   tool_end                   →  agent.event { kind: 'tool_result', name, isError, display, content (first 1000 chars) }
//   notice (e.g. a Stop hook)  →  agent.event { kind: 'notice', text }
//   turn_end                   →  agent.event { kind: 'turn_end', rounds, toolCalls, cost, usage }
//
// Enough to replay the story in `factory logs`; the full transcript is an artifact.

const KEEP = 1000;

/**
 * @param {import('../store/events.js').Store} store
 * @param {{ runId: string, step: string }} where
 */
export function createAgentRecorder(store, { runId, step }) {
  let text = '';
  const put = (event) => store.append(`run:${runId}`, 'agent.event', { runId, step, event });
  const flush = () => {
    if (text.trim()) put({ kind: 'text', text: text.trim() });
    text = '';
  };
  return {
    /** Feed every harness event here. */
    observe(/** @type {any} */ e) {
      if (e.type === 'text_delta') {
        text += e.text;
        return;
      }
      if (e.type === 'message_start') return flush();
      if (e.type === 'tool_start') {
        flush();
        put({ kind: 'tool', name: e.name, summary: e.summary });
      } else if (e.type === 'tool_end') {
        put({ kind: 'tool_result', name: e.name, isError: e.isError, display: e.display, content: String(e.content ?? '').slice(0, KEEP) });
      } else if (e.type === 'notice') {
        flush();
        put({ kind: 'notice', text: e.text });
      } else if (e.type === 'turn_end') {
        flush();
        put({ kind: 'turn_end', rounds: e.rounds, toolCalls: e.toolCalls, cost: e.cost, usage: e.usage, stopReason: e.stopReason, interrupted: e.interrupted });
      }
    },
    flush,
  };
}
