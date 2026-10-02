// @ts-check
// Phase F00: time you can control.
//
// Schedulers, leases, timeouts and budgets all depend on "what time is it?".
// If the code calls Date.now() directly, tests have to really wait. Passing a
// clock in lets a test jump ahead an hour in one line:
//
//   const clock = createFakeClock(0);
//   clock.advance(60_000);   // a minute passes, instantly
//
// Real code uses systemClock. Tests use createFakeClock.

/** @typedef {{ now: () => number }} Clock */

/** @type {Clock} */
export const systemClock = { now: () => Date.now() };

/** A clock that only moves when told to. */
export function createFakeClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    /** @param {number} ms */
    advance(ms) {
      time += ms;
    },
    /** @param {number} ms */
    set(ms) {
      time = ms;
    },
  };
}

/** An ISO timestamp for logs and records. */
export function isoNow(clock = systemClock) {
  return new Date(clock.now()).toISOString();
}
