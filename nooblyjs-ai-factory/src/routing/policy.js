// @ts-check
// Phase F22: COST-AWARE ROUTING. Spend strong models where they change the outcome.
//
// Before F22, each role had one tier (fast / balanced / strong → a model, F09). F22 makes the
// choice depend on what's happening in THIS run:
//
//   start cheap        the builder starts on a cheaper tier than its role asks for…
//   climb on a signal  …and each time something says "this is harder than it looked", the next
//                      agent at that station (or the fixer) gets one tier stronger
//
// Signals (all read from the run's own history, so decisions are reproducible and explainable):
//
//   repair           the fixer's Nth attempt (after failed checks or blocking review findings)
//   retry            the station is running again because its agent failed (max_turns, error…)
//   low_confidence   the triager's confidence in the item is below a threshold
//   medium_or_large  the triager sized it medium or large
//   human_review     a person asked for changes on the PR (F15)
//
// A policy is DATA (config.routing.policies), so it can be compared on the bench:
//
//   "cheap-first": { "stations": {
//      "build":  { "start": "fast", "climbOn": ["retry", "low_confidence", "medium_or_large"] },
//      "repair": { "start": "fast", "climbOn": ["repair", "human_review"] } } }
//
// Stations a policy doesn't mention keep their role's tier. An explicit --model on the run
// always wins: routing is a default, not an override of a person.

export const LADDER = ['fast', 'balanced', 'strong'];
export const SIGNALS = ['repair', 'retry', 'low_confidence', 'medium_or_large', 'human_review'];

/** The built-in policies. `static` is the pre-F22 behaviour. */
export const POLICIES = {
  static: { stations: {} },
  'cheap-first': {
    stations: {
      build: { start: 'fast', climbOn: ['retry', 'low_confidence', 'medium_or_large'] },
      repair: { start: 'fast', climbOn: ['repair', 'human_review'] },
      spec: { start: 'balanced', climbOn: ['retry', 'low_confidence'] },
    },
  },
  escalate: {
    stations: {
      build: { climbOn: ['retry', 'low_confidence'] },
      repair: { climbOn: ['repair', 'human_review'] },
    },
  },
  strong: { stations: { '*': { start: 'strong', climbOn: [] } } },
};

/**
 * Which signals are true for this station, right now? Pure: the run (projection) and triage result in, names out.
 * @param {{ station: string, run: any, triage?: any, attempt: number, lowConfidence?: number }} input
 * @returns {{ name: string, weight: number }[]}  weight: how many tiers this signal is worth
 */
export function signalsFor({ station, run, triage, attempt, lowConfidence = 0.6 }) {
  const out = [];
  if (station === 'repair') {
    const n = (run?.repairs ?? []).length; // attempts before this one
    if (n > 0) out.push({ name: 'repair', weight: n });
  }
  if (attempt > 1 && station !== 'repair') out.push({ name: 'retry', weight: attempt - 1 });
  if (typeof triage?.confidence === 'number' && triage.confidence < lowConfidence) out.push({ name: 'low_confidence', weight: 1 });
  if (triage?.size === 'medium' || triage?.size === 'large') out.push({ name: 'medium_or_large', weight: 1 });
  if (run?.humanReview) out.push({ name: 'human_review', weight: 1 });
  return out;
}

/**
 * The routing decision for one agent step. Pure.
 * @param {{ station: string, roleTier: string, policy: { stations: Record<string, { start?: string, climbOn?: string[], max?: string }> }, signals: { name: string, weight: number }[] }} input
 * @returns {{ tier: string, reason: string, climbed: string[] }}
 */
export function routeTier({ station, roleTier, policy, signals }) {
  const rule = policy?.stations?.[station] ?? policy?.stations?.['*'];
  if (!rule) return { tier: roleTier, reason: `role tier (${roleTier})`, climbed: [] };
  const start = rule.start ?? roleTier;
  const counted = signals.filter((s) => (rule.climbOn ?? []).includes(s.name));
  const steps = counted.reduce((n, s) => n + s.weight, 0);
  const top = LADDER.indexOf(rule.max ?? 'strong');
  const index = Math.min(LADDER.indexOf(start) + steps, top);
  const tier = LADDER[Math.max(0, index)];
  const reason = counted.length ? `${start} + ${counted.map((s) => `${s.name}${s.weight > 1 ? ` ×${s.weight}` : ''}`).join(', ')} → ${tier}` : `starts at ${start}`;
  return { tier, reason, climbed: counted.map((s) => s.name) };
}

/** The policy a run uses: its request's, else config.routing.policy, else static. Custom ones in config.routing.policies. */
export function policyFor(request, config) {
  const name = request?.routing ?? config?.routing?.policy ?? 'static';
  const policy = config?.routing?.policies?.[name] ?? POLICIES[name];
  if (!policy) throw new Error(`No routing policy "${name}". Built in: ${Object.keys(POLICIES).join(', ')}.`);
  return { name, policy };
}
