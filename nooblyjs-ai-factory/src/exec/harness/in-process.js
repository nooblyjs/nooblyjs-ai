// @ts-check
// Phase F01: the IN-PROCESS driver. The harness as a library.
//
//   const session = await createSession({ cwd, provider, model, permissionMode, … });
//   for await (const event of session.stream(prompt, { signal })) …
//
// Everything runs inside the factory's own Node process. That makes it fast
// (no process start-up) and easy to test: pass a scripted provider object
// (createMockProvider) and the whole agent is deterministic.
//
// The price: the agent shares our memory, our event loop and our fate. A tool
// that hangs the event loop hangs the factory. That's why `factory serve` will
// default to the subprocess driver, and tests to this one.
import { createSession, EVENT } from '../../harness.js';
import { createLastText, outcomeOf } from './driver.js';
import { createLimits } from './limits.js';
import { inProcessEnvProblem } from '../../security/agent-env.js';

/** @type {import('./driver.js').HarnessDriver} */
export const inProcessDriver = {
  name: 'in-process',

  async run(run) {
    // Phase F24: an in-process agent's commands inherit OUR environment. With secrets in it, refuse.
    const problem = inProcessEnvProblem(run);
    if (problem) throw new Error(problem);
    const started = Date.now();
    const limits = createLimits({ signal: run.signal, ...run.limits, model: run.model });
    let events = 0;
    const lastText = createLastText();
    /** @type {any} */
    let end = null;
    let session = null;

    try {
      session = await createSession({
        cwd: run.cwd,
        provider: run.provider,
        model: run.model,
        permissionMode: run.permissionMode,
        allowedTools: run.allowedTools,
        disallowedTools: run.disallowedTools,
        maxTurns: run.limits?.maxTurns,
        settings: run.settings,
        tools: run.tools, // Phase F16: the factory's own tools for this step
        // No requestPermission: with nobody at a keyboard the harness treats "ask" as NO,
        // and tells the model which rule would allow it. (Phase F12 routes asks to a human inbox.)
      });
      for await (const event of session.stream(run.prompt, { signal: limits.signal })) {
        events++;
        limits.observe(event);
        lastText.observe(event);
        run.onEvent?.(event);
        if (event.type === EVENT.TURN_END) end = event;
      }
    } catch (error) {
      // An abort can surface as a thrown error rather than an interrupted turn_end.
      end = { error: limits.stopped ? null : (error instanceof Error ? error.message : String(error)), interrupted: true };
    } finally {
      limits.dispose();
      session?.mcp?.close?.();
    }

    end ??= { error: 'The harness ended without a turn_end event.' };
    return {
      outcome: outcomeOf(end, limits.stopped),
      text: end.error ?? (lastText.value || end.text || ''),
      usage: end.usage ?? {},
      costUsd: limits.spent,
      costIsEstimate: limits.isEstimate,
      turns: end.rounds ?? 0,
      toolCalls: end.toolCalls ?? 0,
      durationMs: Date.now() - started,
      sessionId: null,
      model: session?.model ?? run.model ?? null,
      events,
    };
  },
};
