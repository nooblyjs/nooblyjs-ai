// Phase 1: draw an isometric scene on a canvas. Phase 2: characters, walking and the camera.
// The maths functions at the top are pure (no DOM), so tests can import them.

/** Width and height of one tile's top face (a diamond) in the source art, in pixels. */
export const TILE_WIDTH = 256;
export const TILE_HEIGHT = 128;

/** Size of every sprite image in the Kenney pack. */
export const SPRITE_WIDTH = 256;
export const SPRITE_HEIGHT = 512;

/**
 * The point in a sprite image that sits on the centre of its tile.
 * Measured from the floor art: the diamond's top face spans y 364–492, so its centre is at y 428.
 * The space above is for tall things like walls; the 19 px below is the floor slab's side.
 */
export const SPRITE_ANCHOR = { x: 128, y: 428 };

/** Layers within one tile, drawn in this order. */
export const LAYER = Object.freeze({ floor: 0, object: 1, character: 2 });

/**
 * Centre of tile (col, row) in screen pixels, before scaling, relative to tile (0, 0).
 * Moving one column goes right and down the screen; moving one row goes left and down.
 */
export function gridToScreen(col, row) {
  return {
    x: (col - row) * (TILE_WIDTH / 2),
    y: (col + row) * (TILE_HEIGHT / 2),
  };
}

/** The opposite of gridToScreen: which tile a screen point (unscaled, relative to tile 0, 0) is on. */
export function screenToGrid(x, y) {
  // Fractional grid position; the tile's centre is at a whole number, so round to the nearest.
  const col = (x / (TILE_WIDTH / 2) + y / (TILE_HEIGHT / 2)) / 2;
  const row = (y / (TILE_HEIGHT / 2) - x / (TILE_WIDTH / 2)) / 2;
  return { col: Math.floor(col + 0.5), row: Math.floor(row + 0.5) };
}

/** Where to draw the top-left corner of a sprite image so it stands on tile (col, row). */
export function spriteOrigin(col, row) {
  const centre = gridToScreen(col, row);
  return { x: centre.x - SPRITE_ANCHOR.x, y: centre.y - SPRITE_ANCHOR.y };
}

/**
 * Sort drawables into painter's order: farther things first, so nearer things cover them.
 * All floor tiles come first (they are flat, so nothing on the floor may be hidden by one).
 * Then everything else by depth (col + row, or `item.depth` if given), then by layer, then in list order.
 */
export function drawOrder(items) {
  const depth = (item) => item.depth ?? item.col + item.row;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const floorA = a.item.layer === LAYER.floor ? 0 : 1;
      const floorB = b.item.layer === LAYER.floor ? 0 : 1;
      return floorA - floorB
        || depth(a.item) - depth(b.item)
        || a.item.layer - b.item.layer
        || a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * A character walking from one tile to the next, `progress` of the way there (0 to 1).
 * Its position slides smoothly between the tiles, but for the draw order it counts as standing on
 * whichever of the two tiles is nearer the camera. Otherwise, while stepping towards the camera,
 * it would be drawn under the thing it is walking in front of.
 */
export function walkingDrawable({ from, to, progress, key }) {
  const t = Math.min(1, Math.max(0, progress));
  return {
    key,
    col: from.col + (to.col - from.col) * t,
    row: from.row + (to.row - from.row) * t,
    depth: Math.max(from.col + from.row, to.col + to.row),
    layer: LAYER.character,
  };
}

/** The screen rectangle (unscaled) covered by the sprites of a scene: { left, top, right, bottom }. */
export function sceneBounds(items) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const { col, row } of items) {
    const origin = spriteOrigin(col, row);
    left = Math.min(left, origin.x);
    top = Math.min(top, origin.y);
    right = Math.max(right, origin.x + SPRITE_WIDTH);
    bottom = Math.max(bottom, origin.y + SPRITE_HEIGHT);
  }
  return { left, top, right, bottom };
}

/**
 * The scale and offset that fit a scene into a viewport, centred, with some padding.
 * `contentBounds` should be the area that must be visible (by default the whole scene).
 * The scale never goes above `maxScale`, so a small room is not blown up into a blur.
 */
export function fitView(contentBounds, viewport, { padding = 24, maxScale = 0.5 } = {}) {
  const width = contentBounds.right - contentBounds.left;
  const height = contentBounds.bottom - contentBounds.top;
  const scale = Math.min(
    maxScale,
    (viewport.width - padding * 2) / width,
    (viewport.height - padding * 2) / height,
  );
  return {
    scale,
    offsetX: (viewport.width - width * scale) / 2 - contentBounds.left * scale,
    offsetY: (viewport.height - height * scale) / 2 - contentBounds.top * scale,
  };
}

/**
 * The part of the scene that has to be visible: the floor diamonds and everything standing on them,
 * but not the empty transparent space at the top of each sprite image.
 */
export function visibleBounds(items, sprites) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const item of items) {
    const origin = spriteOrigin(item.col, item.row);
    const box = sprites.get(itemKey(item))?.box
      ?? { left: 0, top: 0, right: SPRITE_WIDTH, bottom: SPRITE_HEIGHT };
    left = Math.min(left, origin.x + box.left);
    top = Math.min(top, origin.y + box.top);
    right = Math.max(right, origin.x + box.right);
    bottom = Math.max(bottom, origin.y + box.bottom);
  }
  return { left, top, right, bottom };
}

/** The key a sprite is stored under, e.g. "stoneWall_N". */
export function spriteKey(tile, facing) {
  return `${tile}_${facing}`;
}

/** The sprite key of a drawable: its own `key` (characters), or its tile and facing. */
export function itemKey(item) {
  return item.key ?? spriteKey(item.tile, item.facing);
}

/**
 * The zoom to draw at: as big as `maxScale`, smaller if the window cannot fit the whole level,
 * but never below `minScale` (on a phone the camera then follows the player instead).
 */
export function viewScale(contentBounds, viewport, { padding = 24, minScale = 0.3, maxScale = 0.5 } = {}) {
  const fit = Math.min(
    (viewport.width - padding * 2) / (contentBounds.right - contentBounds.left),
    (viewport.height - padding * 2) / (contentBounds.bottom - contentBounds.top),
  );
  return Math.max(minScale, Math.min(maxScale, fit));
}

/**
 * Where the camera should point (an unscaled scene position) to follow `target`.
 * On each axis: if the level fits in the window, centre the level and do not move at all;
 * otherwise follow the target, but stop at the level's edges so no empty space scrolls into view.
 */
export function cameraFocus(target, contentBounds, viewport, scale, { padding = 24 } = {}) {
  const axis = (value, low, high, size) => {
    const half = size / scale / 2; // half the window, in scene pixels
    const pad = padding / scale;
    if ((high - low) + pad * 2 <= half * 2) return (low + high) / 2;
    return Math.min(high + pad - half, Math.max(low - pad + half, value));
  };
  return {
    x: axis(target.x, contentBounds.left, contentBounds.right, viewport.width),
    y: axis(target.y, contentBounds.top, contentBounds.bottom, viewport.height),
  };
}

/** The { scale, offsetX, offsetY } that puts scene position `focus` in the middle of the viewport. */
export function viewAt(focus, viewport, scale) {
  return {
    scale,
    offsetX: viewport.width / 2 - focus.x * scale,
    offsetY: viewport.height / 2 - focus.y * scale,
  };
}

/**
 * Move `current` part of the way towards `target`, for a camera that glides instead of jumping.
 * Using the elapsed time (not a fixed fraction per frame) keeps the speed the same at 30 or 144 fps.
 * After `halfLife` milliseconds, half the remaining distance has been covered.
 */
export function ease(current, target, elapsedMs, halfLife = 120) {
  const keep = 0.5 ** (elapsedMs / halfLife);
  return {
    x: target.x + (current.x - target.x) * keep,
    y: target.y + (current.y - target.y) * keep,
  };
}

/**
 * Draw a scene onto a 2D canvas context.
 * `items` are { tile, facing, col, row, layer } (or { key, ... } for characters);
 * `sprites` is a Map from sprite key to { image }. `view` is { scale, offsetX, offsetY }.
 */
export function drawScene(ctx, items, sprites, view) {
  for (const item of drawOrder(items)) {
    const sprite = sprites.get(itemKey(item));
    if (!sprite) continue; // a missing sprite should not stop the rest of the room drawing
    const origin = spriteOrigin(item.col, item.row);
    ctx.drawImage(
      sprite.image,
      view.offsetX + origin.x * view.scale,
      view.offsetY + origin.y * view.scale,
      SPRITE_WIDTH * view.scale,
      SPRITE_HEIGHT * view.scale,
    );
  }
}
