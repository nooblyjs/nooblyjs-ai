// The economy: mining crystal, carrying it to the ship, flying the ship to the depot,
// and selling the ship's load. Pure logic, no three.js, so the rules can be tested without a browser.

export const CARGO_CAPACITY = 10; // what the astronaut can carry in one trip
export const SHIP_CAPACITY = 30; // what the ship's hold can carry before it must drive to the depot
export const MINE_SECONDS = 1.2; // time to dig out one unit of ore
export const ORE_VALUE = 25; // credits per unit delivered
export const QUOTA = 40; // units to deliver to finish the quota

/** A fresh player: empty hands, no credits. */
export function createPlayer() {
  return { cargo: 0, credits: 0, delivered: 0, mineTimer: 0 };
}

/** A fresh ship: an empty hold. */
export function createShip() {
  return { hold: 0, capacity: SHIP_CAPACITY };
}

/**
 * Mines a crystal node for dt seconds.
 * node is { amount }; amount goes down as ore is taken. Returns { status, mined }
 * where status is 'mining', 'full' (the astronaut's cargo is full) or 'depleted' (node is empty).
 */
export function stepMining(player, node, dt) {
  let mined = 0;
  player.mineTimer += dt;
  while (player.mineTimer >= MINE_SECONDS &&
         node.amount > 0 && player.cargo < CARGO_CAPACITY) {
    player.mineTimer -= MINE_SECONDS;
    node.amount -= 1;
    player.cargo += 1;
    mined += 1;
  }
  if (node.amount <= 0) {
    player.mineTimer = 0;
    return { status: 'depleted', mined };
  }
  if (player.cargo >= CARGO_CAPACITY) {
    // Do not store up progress while the cargo is full.
    player.mineTimer = 0;
    return { status: 'full', mined };
  }
  return { status: 'mining', mined };
}

/**
 * The astronaut tips its cargo into the ship's hold, as much as the hold can take.
 * Returns how many units were moved.
 */
export function loadShip(player, ship) {
  const space = ship.capacity - ship.hold;
  const ore = Math.min(player.cargo, space);
  player.cargo -= ore;
  ship.hold += ore;
  return ore;
}

/** True when the ship's hold has no room left, so it should drive to the depot. */
export function shipFull(ship) {
  return ship.hold >= ship.capacity;
}

/** The ship unloads its whole hold at the depot. Returns how much was sold and earned. */
export function offload(player, ship) {
  const ore = ship.hold;
  const credits = ore * ORE_VALUE;
  ship.hold = 0;
  player.delivered += ore;
  player.credits += credits;
  return { ore, credits };
}

/** True once enough ore has been delivered to finish the quota. */
export function quotaMet(player) {
  return player.delivered >= QUOTA;
}
