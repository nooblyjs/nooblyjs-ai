// @ts-check
// Phase F01: an agent is a FUNCTION CALL.
//
// To a factory, an agent run is: a prompt and some limits go in; a stream of
// events and one result come out. Nothing else about the harness should leak
// into the rest of the factory. That's this interface:
//
//   const result = await driver.run({ cwd, prompt, limits, onEvent, signal });
//   result.outcome   // 'success' | 'max_turns' | 'budget' | 'timeout' | 'interrupted' | 'refusal' | 'blocked' | 'error'
//
// Two drivers implement it, with different failure isolation:
//
//   in-process   createSession() in THIS Node process    fast, easy to test, but a hang or a crash is ours too
//   subprocess   `noobly -p --output-format stream-json`  a separate process: it can crash, leak or hang alone,
//                                                          and we can always kill it (and later, move it into a container)

/**
 * What to run.
 * @typedef {Object} AgentRun
 * @property {string} cwd                       the workspace folder (Phase F02 makes one per step)
 * @property {string} prompt
 * @property {string} [model]
 * @property {string | object} [provider]       a provider id ('anthropic', 'echo'…); in-process also takes a provider object (tests: createMockProvider)
 * @property {'default'|'acceptEdits'|'plan'|'bypass'} [permissionMode]
 * @property {string[]} [allowedTools]          harness permission rules that never ask, e.g. 'Bash(npm test:*)'
 * @property {string[]} [disallowedTools]       rules that always deny, e.g. 'Bash(git push:*)'
 * @property {Limits} [limits]
 * @property {object} [settings]                extra harness settings (sandbox, hooks…). Phase F02 fills this
 * @property {string} [harnessHome]             subprocess: a NOOBLY_HOME for this run (Phase F02)
 * @property {object[]} [tools]                 in-process: extra harness tools (Phase F16; subprocess gets them via mcp.json)
 * @property {Record<string, string>} [env]     subprocess: extra environment variables
 * @property {AbortSignal} [signal]             the caller's stop button (kill switch, lost lease…)
 * @property {(event: object) => void} [onEvent]  every harness event, as it happens
 */

/**
 * Hard limits. Exceeding any one stops the run.
 * @typedef {Object} Limits
 * @property {number} [maxTurns]    model requests (the harness enforces this itself)
 * @property {number} [timeoutMs]   wall clock
 * @property {number} [budgetUsd]   money (the factory enforces this by watching events; see limits.js)
 */

/**
 * What happened.
 * @typedef {Object} StepResult
 * @property {Outcome} outcome
 * @property {string} text            the agent's LAST message: the text of its final model request (or the error message)
 * @property {object} usage           tokens, as the harness reports them
 * @property {number} costUsd         exact when the harness finished the turn; otherwise our estimate
 * @property {boolean} costIsEstimate
 * @property {number} turns           model requests made
 * @property {number} toolCalls
 * @property {number} durationMs
 * @property {string | null} sessionId  the harness transcript id (subprocess) or null
 * @property {string | null} model
 * @property {number} events          how many events were seen
 */

/** @typedef {'success'|'max_turns'|'budget'|'timeout'|'interrupted'|'refusal'|'blocked'|'error'} Outcome */

/** @typedef {{ name: string, run: (agentRun: AgentRun) => Promise<StepResult> }} HarnessDriver */

export const OUTCOMES = ['success', 'max_turns', 'budget', 'timeout', 'interrupted', 'refusal', 'blocked', 'error'];

/** Pick a driver by name. */
export async function createDriver(name = 'subprocess') {
  if (name === 'in-process') return (await import('./in-process.js')).inProcessDriver;
  if (name === 'subprocess') return (await import('./subprocess.js')).subprocessDriver;
  throw new Error(`Unknown driver "${name}". Use "in-process" or "subprocess".`);
}

/**
 * The harness's own way of saying how a turn ended → our Outcome.
 * `stopped` is the reason WE stopped it (timeout, budget, interrupted), which wins:
 * the harness only sees "interrupted", but we know why.
 * @param {{ stopReason?: string | null, interrupted?: boolean, error?: string }} end
 * @param {Outcome | null} stopped
 * @returns {Outcome}
 */
export function outcomeOf(end, stopped) {
  if (stopped) return stopped;
  if (end.error) return 'error';
  if (end.interrupted) return 'interrupted';
  if (end.stopReason === 'max_turns') return 'max_turns';
  if (end.stopReason === 'refusal') return 'refusal';
  if (end.stopReason === 'blocked') return 'blocked';
  return 'success';
}

/**
 * The text of the LAST model request of a turn.
 *
 * The harness's turn_end.text joins the text of EVERY request in the turn
 * ("Let me look." + "Now I'll edit." + "Done: I changed…"). For a summary we
 * want only the final answer, so we restart at each message_start.
 */
export function createLastText() {
  let text = '';
  return {
    observe(/** @type {any} */ event) {
      if (event.type === 'message_start') text = '';
      else if (event.type === 'text_delta') text += event.text;
    },
    get value() {
      return text.trim();
    },
  };
}
