// @ts-check
// Phase F01: the three ways a run is stopped from OUTSIDE.
//
//   the caller    kill switch, lost lease, Ctrl+C          → 'interrupted'
//   the clock     it has run longer than timeoutMs         → 'timeout'
//   the money     it has cost more than budgetUsd          → 'budget'
//
// All three end the same way: one AbortController is aborted. The driver
// passes its signal to the harness, which stops cleanly. We remember WHICH
// limit fired, because the harness only knows "I was interrupted".
//
// Money is the interesting one. The harness reports the exact cost only at
// the END of a turn (turn_end.cost). A runaway agent can make 25 requests
// before that. So while it runs we ESTIMATE, from the events we can see:
//
//   message_start  usage.input_tokens     exact input tokens of each request: the whole
//                                          conversation so far, usually most of the cost
//   text_delta     ~4 characters a token   output we can see
//   tool_start     the tool's input JSON   output we can see
//
// (The harness doesn't pass on the per-request `message` event with exact
// output tokens. Doing the budget INSIDE the harness is harness track H32.)
import { costOf } from 'nooblyjs-ai-common/cost';
import { CHARS_PER_TOKEN } from 'nooblyjs-ai-common/tokens';
import { EVENT } from '../../harness.js';

/**
 * @param {{ signal?: AbortSignal, timeoutMs?: number, budgetUsd?: number, model?: string }} options
 */
export function createLimits({ signal, timeoutMs, budgetUsd, model } = {}) {
  const controller = new AbortController();
  /** @type {null | 'interrupted' | 'timeout' | 'budget'} */
  let stopped = null;
  let currentModel = model ?? null;
  let estimate = 0; // dollars, while the turn runs
  let exact = null; // dollars, once turn_end arrives
  let outputChars = 0; // since the last message_start

  const stop = (/** @type {'interrupted' | 'timeout' | 'budget'} */ reason) => {
    if (controller.signal.aborted) return;
    stopped = reason;
    controller.abort(new Error(reason));
  };

  const onCallerAbort = () => stop('interrupted');
  if (signal?.aborted) stop('interrupted');
  else signal?.addEventListener('abort', onCallerAbort, { once: true });

  const timer = timeoutMs ? setTimeout(() => stop('timeout'), timeoutMs) : null;

  const outputCost = () => (currentModel ? costOf(currentModel, { output_tokens: Math.ceil(outputChars / CHARS_PER_TOKEN) }) : 0);

  return {
    signal: controller.signal,
    /** Which limit stopped the run, if any. */
    get stopped() {
      return stopped;
    },
    /** Dollars so far: exact after turn_end, an estimate before. */
    get spent() {
      return exact ?? estimate + outputCost();
    },
    get isEstimate() {
      return exact === null;
    },

    /** Feed every harness event through here. */
    observe(/** @type {any} */ event) {
      if (event.type === EVENT.MESSAGE_START) {
        // A new request: bank the previous one's output, add this one's input.
        if (event.model) currentModel = event.model;
        estimate += outputCost();
        outputChars = 0;
        if (currentModel) estimate += costOf(currentModel, event.usage ?? {});
      } else if (event.type === EVENT.TEXT_DELTA || event.type === EVENT.THINKING_DELTA) {
        outputChars += event.text?.length ?? 0;
      } else if (event.type === EVENT.TOOL_START) {
        outputChars += JSON.stringify(event.input ?? {}).length;
      } else if (event.type === EVENT.TURN_END && typeof event.cost === 'number') {
        // After an interrupt, the harness's cost counts only the requests that FINISHED.
        // The one we cut off was still billed for its input, so keep the larger number.
        const running = estimate + outputCost();
        if (event.interrupted && running > event.cost) estimate = running;
        else exact = event.cost;
      }
      if (budgetUsd !== undefined && this.spent > budgetUsd) stop('budget');
    },

    /** Stop the timer and stop listening to the caller. Call when the run is over. */
    dispose() {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    },
  };
}
