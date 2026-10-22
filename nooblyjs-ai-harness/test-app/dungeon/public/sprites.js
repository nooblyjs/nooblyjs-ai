// Phase 1: load the sprite images, and look them up by name and facing. Phase 2: character frames.
import { spriteKey, SPRITE_WIDTH, SPRITE_HEIGHT } from './render.js';

/** How many frames each character animation has (Characters/Male in the pack). */
export const CHARACTER_FRAMES = Object.freeze({ Idle: 1, Run: 10, Pickup: 10 });

/** The character animations the game uses so far. Pickup arrives with chests in Phase 4. */
export const CHARACTER_ANIMATIONS = ['Idle', 'Run'];

/** The sprite key of one character frame, e.g. "Male_2_Run3" (direction 2, frame 3 of the run). */
export function characterKey(direction, animation, frame = 0) {
  return `Male_${direction}_${animation}${frame}`;
}

/** The URL of a character frame copied by scripts/copy-assets.js. */
export function characterUrl(key) {
  return `assets/characters/${key}.png`;
}

/** Every character frame the game uses, for all 8 directions, as [{ key, url }]. */
export function characterSprites(animations = CHARACTER_ANIMATIONS) {
  const list = [];
  for (let direction = 0; direction < 8; direction++) {
    for (const animation of animations) {
      for (let frame = 0; frame < CHARACTER_FRAMES[animation]; frame++) {
        const key = characterKey(direction, animation, frame);
        list.push({ key, url: characterUrl(key) });
      }
    }
  }
  return list;
}

/** Which frame of an animation to show, `progress` of the way through it (0 to 1). */
export function animationFrame(animation, progress) {
  const frames = CHARACTER_FRAMES[animation];
  return Math.min(frames - 1, Math.max(0, Math.floor(progress * frames)));
}

/** The URL of a tile sprite copied by scripts/copy-assets.js, e.g. assets/tiles/stoneWall_N.png. */
export function tileUrl(tile, facing) {
  return `assets/tiles/${spriteKey(tile, facing)}.png`;
}

/** The distinct sprites a scene needs, as [{ key, url }]. */
export function spritesFor(items) {
  const wanted = new Map();
  for (const { tile, facing } of items) {
    const key = spriteKey(tile, facing);
    if (!wanted.has(key)) wanted.set(key, { key, url: tileUrl(tile, facing) });
  }
  return [...wanted.values()];
}

/** Load one image. Resolves when it has loaded; rejects with a readable message if it cannot. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load the image ${url}`));
    image.src = url;
  });
}

/**
 * The box around a sprite's visible (non-transparent) pixels: { left, top, right, bottom }.
 * Most of each 256 × 512 image is empty space, so this lets the view fit what is really there.
 */
export function opaqueBox(image) {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_WIDTH;
  canvas.height = SPRITE_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
  let left = SPRITE_WIDTH, top = SPRITE_HEIGHT, right = 0, bottom = 0;
  for (let y = 0; y < SPRITE_HEIGHT; y++) {
    for (let x = 0; x < SPRITE_WIDTH; x++) {
      if (data[(y * SPRITE_WIDTH + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x >= right) right = x + 1;
      if (y < top) top = y;
      if (y >= bottom) bottom = y + 1;
    }
  }
  return { left, top, right, bottom };
}

/**
 * Load every sprite in `list` ([{ key, url }]) at the same time.
 * `onProgress(loaded, total)` is called after each image, for a loading bar.
 * Resolves to a Map from key to { image, box }.
 */
export async function loadSprites(list, { onProgress = () => {} } = {}) {
  const sprites = new Map();
  let loaded = 0;
  onProgress(0, list.length);
  await Promise.all(list.map(async ({ key, url }) => {
    const image = await loadImage(url);
    sprites.set(key, { image, box: opaqueBox(image) });
    onProgress(++loaded, list.length);
  }));
  return sprites;
}
