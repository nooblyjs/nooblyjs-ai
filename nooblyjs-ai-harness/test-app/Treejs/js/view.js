// The camera's maths: where it can look, how it pans, how the minimap maps to the map,
// and how long the ship takes to fly. No three.js here, so it can be tested in Node.

// The camera looks down at the map from the (+x, +y, +z) side, so the screen's right
// and up directions lie along these diagonals of the ground (the square root of 2 keeps them unit length).
const SQRT_HALF = Math.SQRT1_2;
const SCREEN_RIGHT = { x: SQRT_HALF, z: -SQRT_HALF };
const SCREEN_UP = { x: -SQRT_HALF, z: -SQRT_HALF };

/** Keeps a focus point (x, z) on the map. The camera may look at the very edge but not past it. */
export function clampFocus({ x, z }, worldSize) {
  const max = worldSize - 1;
  return { x: Math.min(max, Math.max(0, x)), z: Math.min(max, Math.max(0, z)) };
}

/**
 * Moves a focus point across the screen. right and up are -1..1 (left/right, down/up),
 * and speed is in world units per second. Returns a new focus point, kept on the map.
 */
export function panFocus(focus, { right = 0, up = 0 }, speed, dt, worldSize) {
  // Pressing two keys at once (a diagonal) should not make the view faster, so scale it back to length 1.
  const length = Math.hypot(right, up) || 1;
  const r = right / length;
  const u = up / length;
  const dx = (SCREEN_RIGHT.x * r + SCREEN_UP.x * u) * speed * dt;
  const dz = (SCREEN_RIGHT.z * r + SCREEN_UP.z * u) * speed * dt;
  return clampFocus({ x: focus.x + dx, z: focus.z + dz }, worldSize);
}

/**
 * Turns a mouse position near the edge of the screen into a pan direction.
 * rect is the canvas box { left, top, width, height }. Returns { right, up } from -1 to 1.
 */
export function edgePan(clientX, clientY, rect, margin = 28) {
  let right = 0;
  let up = 0;
  if (clientX - rect.left < margin) right = -1;
  else if (rect.left + rect.width - clientX < margin) right = 1;
  if (clientY - rect.top < margin) up = 1;
  else if (rect.top + rect.height - clientY < margin) up = -1;
  return { right, up };
}

// A tile's centre is at a whole number in world units, so tile col covers col - 0.5 to col + 0.5.
// On the minimap, tile col covers pixels col * scale to (col + 1) * scale.
/** A point on the minimap (in pixels) to a point on the map (world units). scale is pixels per tile. */
export function minimapToWorld(px, py, scale) {
  return { x: px / scale - 0.5, z: py / scale - 0.5 };
}

/** A point on the map (world units) to a point on the minimap (in pixels). */
export function worldToMinimap(x, z, scale) {
  return { px: (x + 0.5) * scale, py: (z + 0.5) * scale };
}

/**
 * How long the ship takes to fly from one spot to another, in seconds.
 * Farther trips take longer, but never less than 2.5 s or more than 8 s.
 */
export function flightSeconds(from, to) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  return Math.min(8, Math.max(2.5, distance / 8));
}
