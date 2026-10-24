// Moon lander physics: pure functions, no DOM, so the same code runs in the browser and in tests.
// Units are real-world: metres, seconds, degrees. y points UP (altitude); the renderer flips it.

export const MOON_GRAVITY = 1.62; // m/s², the real value on the Moon
export const THRUST = 4.5; // m/s² of push from the engine, about 2.8× lunar gravity
export const ROTATE_SPEED = 110; // degrees per second while an arrow key is held
export const FUEL_MAX = 100;
export const FUEL_BURN = 4; // fuel units per second of thrust (25 s from a full tank)
export const REFUEL = 50; // fuel gained the first time you land on a platform

// Safe touchdown limits.
export const MAX_LANDING_VY = 4; // m/s downward
export const MAX_LANDING_VX = 2.5; // m/s sideways
export const MAX_LANDING_ANGLE = 15; // degrees from upright

export const WORLD = Object.freeze({ width: 250, height: 150 });

export const PLATFORMS = Object.freeze([
  { id: 1, x: 10, width: 18, y: 22 },
  { id: 2, x: 74, width: 14, y: 48 },
  { id: 3, x: 140, width: 12, y: 14 },
  { id: 4, x: 210, width: 12, y: 62 },
]);

// Lander shape in local metres, origin at the centre, y up. Feet are what should touch down;
// the hull points catch crashes into slopes.
export const FEET = Object.freeze([
  { x: -3.2, y: -3.6 },
  { x: 3.2, y: -3.6 },
]);
const HULL = [
  { x: -2.4, y: 3.6 },
  { x: 2.4, y: 3.6 },
  { x: -2.9, y: 0 },
  { x: 2.9, y: 0 },
];

const toRad = (deg) => (deg * Math.PI) / 180;

/** Seeded random numbers, so the moon surface is the same every game. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the jagged surface as a list of {x, y} points, flat across each platform. */
export function buildTerrain(platforms = PLATFORMS, world = WORLD, seed = 1969) {
  const random = seededRandom(seed);
  const points = [];
  let x = 0;
  for (const platform of [...platforms].sort((a, b) => a.x - b.x)) {
    while (x < platform.x - 3) {
      points.push({ x, y: 6 + random() * 50 });
      x += 3 + random() * 5;
    }
    points.push({ x: platform.x, y: platform.y }, { x: platform.x + platform.width, y: platform.y });
    x = platform.x + platform.width + 3;
  }
  while (x < world.width) {
    points.push({ x, y: 6 + random() * 50 });
    x += 3 + random() * 5;
  }
  points.push({ x: world.width, y: 6 + random() * 50 });
  return points;
}

/** Height of the surface at x, by straight-line interpolation between terrain points. */
export function groundHeight(terrain, x) {
  if (x <= terrain[0].x) return terrain[0].y;
  for (let i = 1; i < terrain.length; i++) {
    const a = terrain[i - 1];
    const b = terrain[i];
    if (x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
  }
  return terrain[terrain.length - 1].y;
}

/** Turns a point on the lander into world coordinates. Positive angle = tilted clockwise (right). */
export function toWorld(lander, point) {
  const r = toRad(lander.angle);
  return {
    x: lander.x + point.x * Math.cos(r) + point.y * Math.sin(r),
    y: lander.y - point.x * Math.sin(r) + point.y * Math.cos(r),
  };
}

/** The platform under both feet, or null. */
export function platformUnder(lander, platforms = PLATFORMS) {
  const [left, right] = FEET.map((foot) => toWorld(lander, foot));
  return platforms.find((p) => left.x >= p.x && right.x <= p.x + p.width) ?? null;
}

const restOn = (platform) => ({
  x: platform.x + platform.width / 2,
  y: platform.y - FEET[0].y,
  vx: 0,
  vy: 0,
  angle: 0,
});

/** A new game: parked on the first platform with a full tank. */
export function createGame(platforms = PLATFORMS) {
  const start = platforms[0];
  return {
    lander: restOn(start),
    fuel: FUEL_MAX,
    status: 'landed', // 'landed' | 'flying' | 'crashed' | 'won'
    platformId: start.id,
    visited: [start.id],
    message: 'Hold SPACE to lift off.',
    thrusting: false,
    time: 0,
  };
}

/** Is this touchdown gentle enough? Returns a reason string if not. */
export function landingProblem(lander, platform) {
  if (!platform) return 'You missed the platform.';
  if (Math.abs(lander.angle) > MAX_LANDING_ANGLE) return 'You came down at too steep an angle.';
  if (-lander.vy > MAX_LANDING_VY) return 'You hit the ground too hard.';
  if (Math.abs(lander.vx) > MAX_LANDING_VX) return 'You were sliding sideways too fast.';
  return null;
}

/**
 * Advances the game by dt seconds. input = { left, right, thrust } (booleans).
 * Returns a new state; the old one is not changed.
 */
export function step(game, input, dt, { terrain, platforms = PLATFORMS, world = WORLD } = {}) {
  if (game.status === 'crashed' || game.status === 'won') return { ...game, thrusting: false };

  const fuel = game.fuel;
  const firing = Boolean(input.thrust) && fuel > 0;
  const burned = firing ? Math.min(fuel, FUEL_BURN * dt) : 0;
  const time = game.time + dt;

  if (game.status === 'landed') {
    // On the pad you can't tip over; you can only lift straight up.
    if (!firing) return { ...game, thrusting: false, time };
    return {
      ...game,
      status: 'flying',
      lander: { ...game.lander, vy: (THRUST - MOON_GRAVITY) * dt },
      fuel: fuel - burned,
      thrusting: true,
      message: 'Fly to another platform and land gently.',
      time,
    };
  }

  // Flying: rotate, then apply thrust and gravity (simple Euler integration).
  let { x, y, vx, vy, angle } = game.lander;
  if (input.left) angle -= ROTATE_SPEED * dt;
  if (input.right) angle += ROTATE_SPEED * dt;
  angle = ((((angle + 180) % 360) + 360) % 360) - 180; // keep within -180..180

  const push = firing ? THRUST : 0;
  vx += push * Math.sin(toRad(angle)) * dt;
  vy += (push * Math.cos(toRad(angle)) - MOON_GRAVITY) * dt;
  x += vx * dt;
  y += vy * dt;

  // Invisible walls at the sides and a ceiling.
  if (x < 4) [x, vx] = [4, Math.max(0, vx)];
  if (x > world.width - 4) [x, vx] = [world.width - 4, Math.min(0, vx)];
  if (y > world.height + 20) [y, vy] = [world.height + 20, Math.min(0, vy)];

  const lander = { x, y, vx, vy, angle };
  const next = { ...game, lander, fuel: fuel - burned, thrusting: firing, time };
  if (input.thrust && fuel - burned <= 0 && fuel > 0) next.message = 'Out of fuel!';

  const touching = [...FEET, ...HULL]
    .map((point) => toWorld(lander, point))
    .some((point) => point.y <= groundHeight(terrain, point.x));
  if (!touching) return next;

  const platform = platformUnder(lander, platforms);
  const problem = landingProblem(lander, platform);
  if (problem) return { ...next, status: 'crashed', thrusting: false, message: `${problem} Press R to try again.` };

  const firstVisit = !game.visited.includes(platform.id);
  const visited = firstVisit ? [...game.visited, platform.id] : game.visited;
  const refuelled = firstVisit ? Math.min(FUEL_MAX, next.fuel + REFUEL) : next.fuel;
  const won = visited.length === platforms.length;
  let message = `Landed on platform ${platform.id}.`;
  if (firstVisit) message += ` +${REFUEL} fuel.`;
  message += won ? ' Every platform visited: mission complete! Press R to fly again.' : ' Hold SPACE to lift off.';

  return {
    ...next,
    lander: { ...restOn(platform), x: lander.x },
    status: won ? 'won' : 'landed',
    platformId: platform.id,
    visited,
    fuel: refuelled,
    thrusting: false,
    message,
  };
}
