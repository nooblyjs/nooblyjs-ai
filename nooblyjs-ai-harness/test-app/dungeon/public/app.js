// Phase 2: load the sprites, then let the player walk around the test room.
// The rules live in game.js; this file only turns the game state into moving pictures.
import {
  drawScene, visibleBounds, viewScale, cameraFocus, viewAt, ease, gridToScreen, walkingDrawable, LAYER,
} from './render.js';
import { loadSprites, spritesFor, characterSprites, characterKey, animationFrame } from './sprites.js';
import { createState, step } from './game.js';
import { createActionQueue, listenForKeys } from './input.js';
import { testLevel } from './room.js';

/** How long one step from tile to tile takes on screen. */
const STEP_MS = 250;

/** The camera aims at the player's chest rather than their feet, in unscaled scene pixels. */
const CAMERA_LIFT = 60;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const css = getComputedStyle(document.documentElement);
const colours = {
  sand: css.getPropertyValue('--sand').trim(),
  ink: css.getPropertyValue('--ink').trim(),
};

const level = testLevel();
let state = createState(level);
const queue = createActionQueue();

let sprites = null; // a Map once loaded
let progress = { loaded: 0, total: 1 };
let error = null;
let levelBounds = null; // the scene area to keep in view, worked out once the sprites are loaded

let walk = null; // { from, to, start } while the player is walking between tiles
let camera = null; // the scene position the camera points at
let lastFrame = 0;
let frameRequested = false;

/** The canvas size in CSS pixels. */
function viewport() {
  return { width: canvas.clientWidth, height: canvas.clientHeight };
}

/** Match the canvas's pixel size to its on-screen size, so drawing stays sharp on high-DPI screens. */
function resize() {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  // Draw in CSS pixels from now on; the browser scales them up by `ratio`.
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  camera = null; // jump straight to the right place after a resize, rather than gliding
  requestFrame();
}

/** Ask for a frame to be drawn (at most one is waiting at a time). */
function requestFrame() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(frame);
}

/** Take the next waiting action, if the player is free to act. */
function nextAction(now) {
  if (walk) return;
  const action = queue.take();
  if (!action) return;
  const before = state.player;
  state = step(state, action);
  if (state.event === 'moved') walk = { from: before, to: state.player, start: now };
}

/** How far through the current step the player is (0 to 1), or null when standing still. */
function walkProgress(now) {
  return walk ? Math.min(1, (now - walk.start) / STEP_MS) : null;
}

/** The player as a drawable: the run cycle while walking, otherwise standing still. */
function playerDrawable(now) {
  const { facing } = state.player;
  const t = walkProgress(now);
  if (t === null) {
    return { key: characterKey(facing, 'Idle'), col: state.player.col, row: state.player.row, layer: LAYER.character };
  }
  return walkingDrawable({ ...walk, progress: t, key: characterKey(facing, 'Run', animationFrame('Run', t)) });
}

/** One animation frame: advance the walk and the camera, draw, and ask for another frame if still moving. */
function frame(now) {
  frameRequested = false;
  const elapsed = lastFrame ? now - lastFrame : 0;
  lastFrame = now;

  if (walk && walkProgress(now) >= 1) walk = null;
  nextAction(now);

  let moving = Boolean(walk);
  let player = null;
  if (sprites && !error) {
    player = playerDrawable(now);
    const scale = viewScale(levelBounds, viewport());
    const feet = gridToScreen(player.col, player.row);
    const target = cameraFocus({ x: feet.x, y: feet.y - CAMERA_LIFT }, levelBounds, viewport(), scale);
    camera = camera ? ease(camera, target, elapsed) : target;
    if (Math.abs(camera.x - target.x) > 0.5 || Math.abs(camera.y - target.y) > 0.5) moving = true;
    else camera = target;
    draw(viewAt(camera, viewport(), scale), player);
  } else {
    draw(null, null);
  }
  if (moving) requestFrame();
  else lastFrame = 0; // the next frame after a pause should not think lots of time has passed
}

/** A centred line of text, for loading and error messages. */
function message(text, y) {
  ctx.fillStyle = colours.ink;
  ctx.font = '16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, viewport().width / 2, y);
}

/** A simple loading bar while the sprites download. */
function drawLoading() {
  const { width, height } = viewport();
  const barWidth = Math.min(320, width - 48);
  const x = (width - barWidth) / 2;
  const y = height / 2;
  message('Loading the dungeon…', y - 16);
  ctx.strokeStyle = colours.ink;
  ctx.strokeRect(x, y, barWidth, 12);
  ctx.fillStyle = colours.ink;
  ctx.fillRect(x + 2, y + 2, (barWidth - 4) * (progress.loaded / progress.total), 8);
}

/** Paint one frame: the room and the player, or the loading or error screen. */
function draw(view, player) {
  const { width, height } = viewport();
  ctx.fillStyle = colours.sand;
  ctx.fillRect(0, 0, width, height);
  if (error) {
    message('The dungeon could not be loaded.', height / 2 - 12);
    message(error.message, height / 2 + 14);
  } else if (!sprites) {
    drawLoading();
  } else {
    drawScene(ctx, [...level.items, player], sprites, view);
  }
}

window.addEventListener('resize', resize);
resize();

loadSprites([...spritesFor(level.items), ...characterSprites()], {
  onProgress(loaded, total) {
    progress = { loaded, total };
    requestFrame();
  },
}).then((loaded) => {
  sprites = loaded;
  levelBounds = visibleBounds(level.items, sprites);
  canvas.setAttribute('aria-label', 'An isometric dungeon room. Use the arrow keys or W, A, S and D to walk.');
  listenForKeys(window, (action) => {
    queue.push(action);
    requestFrame();
  });
  requestFrame();
}, (failure) => {
  error = failure;
  canvas.setAttribute('aria-label', 'The dungeon could not be loaded');
  requestFrame();
});
