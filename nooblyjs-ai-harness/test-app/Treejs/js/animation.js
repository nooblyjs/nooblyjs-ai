// Pose maths for the astronaut: standing, walking and mining.
// These are plain numbers with no three.js, so the motion can be tested in Node.
// Each pose is a set of angles (radians) that main.js applies to the model's limbs.

import { MINE_SECONDS } from './mining.js';

// The mining swing is one full cycle per unit of ore. The pick hits the rock at this fraction.
export const STRIKE_AT = 0.75;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
// Smooth start and finish: slow at both ends, quick in the middle.
const smooth = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Where the astronaut is in the current swing, from 0 to 1. */
export function swingPhase(swingTime) {
  return (swingTime % MINE_SECONDS) / MINE_SECONDS;
}

/** How many times the pick has hit the rock after swingTime seconds of mining. */
export function hitCount(swingTime) {
  const cycles = swingTime / MINE_SECONDS;
  if (cycles < STRIKE_AT) return 0;
  // The small margin stops rounding errors in the timer from losing a hit at the boundary.
  return Math.floor(cycles - STRIKE_AT + 1e-9) + 1;
}

/** A camera shake that starts big and fades out quickly. */
export function createShake() {
  return { strength: 0 };
}

/** Adds shake on a hit. Hits stack, but the shake never gets bigger than maxStrength. */
export function addShake(shake, amount, maxStrength = 0.3) {
  shake.strength = Math.min(maxStrength, shake.strength + amount);
}

/**
 * Moves the shake on by dt seconds and returns the offset to apply to the camera.
 * random can be replaced in tests so the result is predictable.
 */
export function stepShake(shake, dt, random = Math.random) {
  shake.strength *= Math.exp(-dt * 18); // fades in well under half a second
  if (shake.strength < 0.001) {
    shake.strength = 0;
    return { x: 0, y: 0, z: 0 };
  }
  const s = shake.strength;
  return {
    x: (random() * 2 - 1) * s,
    y: (random() * 2 - 1) * s * 0.5,
    z: (random() * 2 - 1) * s,
  };
}

/**
 * A point along a flight from `from` to `to`, where t goes from 0 to 1.
 * The path rises in a curve (a parabola) so the ore looks thrown, not slid.
 */
export function arcPoint(from, to, t, height = 2.5) {
  const u = clamp01(t);
  const lift = 4 * height * u * (1 - u); // 0 at both ends, peak at the middle
  return {
    x: from.x + (to.x - from.x) * u,
    y: from.y + (to.y - from.y) * u + lift,
    z: from.z + (to.z - from.z) * u,
  };
}

/**
 * The pose for a given mode: 'idle', 'walk' or 'mine'.
 * time drives walking and breathing. swingTime counts only while mining.
 */
export function heroPose(mode, time, swingTime = 0) {
  if (mode === 'walk') {
    const p = time * 10; // legs and arms swing in step with each stride
    return {
      bodyX: 0.08,
      bodyY: Math.abs(Math.sin(p)) * 0.05,
      armLeft: -Math.sin(p) * 0.6,
      armRight: Math.sin(p) * 0.6,
      legLeft: Math.sin(p) * 0.7,
      legRight: -Math.sin(p) * 0.7,
    };
  }

  if (mode === 'mine') {
    const t = swingPhase(swingTime);
    // Wind up: the pick rises. Strike: it comes down fast. Recover: it settles back.
    const windup = smooth(t / STRIKE_AT);
    const strike = smooth((t - STRIKE_AT) / 0.12);
    const recover = smooth((t - STRIKE_AT - 0.12) / (1 - STRIKE_AT - 0.12));
    const armRight = t < STRIKE_AT
      ? -2.0 * windup
      : -2.0 + 2.3 * strike - 0.3 * recover;
    // The body leans into the rock on the strike.
    const lean = Math.sin(Math.PI * clamp01((t - 0.55) / 0.4));
    return {
      bodyX: 0.12 + 0.2 * lean,
      bodyY: -0.03 * lean,
      armLeft: -0.5 + Math.sin(time * 6) * 0.05,
      armRight,
      legLeft: -0.25, // feet apart, bracing against the rock
      legRight: 0.25,
    };
  }

  // Idle: a slow breath.
  const breath = Math.sin(time * 2);
  return {
    bodyX: 0,
    bodyY: breath * 0.008,
    armLeft: breath * 0.04,
    armRight: breath * 0.04,
    legLeft: 0,
    legRight: 0,
  };
}
