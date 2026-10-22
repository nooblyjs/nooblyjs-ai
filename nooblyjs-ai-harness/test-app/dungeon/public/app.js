// Phase 2: load the sprites, then let the player walk around.
// Phase 3: the floor comes from a level file, with a turn counter and a "Floor complete" message.
// The rules live in game.js; this file only turns the game state into moving pictures.
import {
  drawScene, visibleBounds, viewScale, cameraFocus, viewAt, ease, gridToScreen, walkingDrawable, LAYER,
} from './render.js';
import { loadSprites, spritesFor, characterSprites, characterKey, animationFrame } from './sprites.js';
import { createState, step, missingForExit, onExit } from './game.js';
import { loadLevel, levelUrl } from './levels.js';
import { createActionQueue, listenForKeys } from './input.js';

/** How long one step from tile to tile takes on screen. */
const STEP_MS = 250;

/** The camera aims at the player's chest rather than their feet, in unscaled scene pixels. */
const CAMERA_LIFT = 60;

/** The floor to play. Phase 7 adds the title screen and moving on to the next floor. */
const FIRST_LEVEL = 1;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const announcer = document.getElementById('announcer');
const css = getComputedStyle(document.documentElement);
const colours = {
  sand: css.getPropertyValue('--sand').trim(),
  ink: css.getPropertyValue('--ink').trim(),
  panel: css.getPropertyValue('--panel').trim(),
};

let level = null; // the loaded level (see levels.js)
let state = null;
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

/** Say something to screen reader users (the canvas itself has no text they can read). */
function announce(text) {
  announcer.textContent = text;
}

/** "a brass key" for "key:brass", for messages about what the exit needs. */
function describeItem(item) {
  return item.startsWith('key:') ? `the ${item.slice(4)} key` : item;
}

/** Take the next waiting action, if the player is free to act. */
function nextAction(now) {
  if (walk) return;
  const action = queue.take();
  if (!action) return;
  if (action.type === 'playAgain') {
    // Only once the floor is over, so a stray Enter cannot throw away a game in progress.
    if (state.status === 'complete') {
      state = createState(level);
      announce(`${level.name}. Find the stairs.`);
    }
    return;
  }
  const before = state;
  state = step(state, action);
  if (state.event === 'moved' && state !== before) walk = { from: before.player, to: state.player, start: now };
  if (state.status === 'complete' && before.status !== 'complete') {
    announce(`Floor complete in ${state.turn} turns (par ${level.par}). Press Enter to play again.`);
  } else if (state.event === 'moved' && onExit(state) && missingForExit(state).length) {
    announce(`The stairs are locked. You need ${missingForExit(state).map(describeItem).join(' and ')}.`);
  }
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
  if (state) nextAction(now);

  let moving = Boolean(walk);
  if (sprites && !error) {
    const player = playerDrawable(now);
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
function message(text, y, font = '16px system-ui, sans-serif') {
  ctx.fillStyle = colours.ink;
  ctx.font = font;
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

/** The floor's name and the turn count, top left. Phase 4 grows this into the full HUD. */
function drawHud() {
  ctx.fillStyle = colours.ink;
  ctx.textAlign = 'left';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText(`Floor ${level.id}: ${level.name}`, 16, 28);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(`Turn ${state.turn} · par ${level.par}`, 16, 48);
}

/** The "Floor complete" panel, in the middle of the screen. */
function drawComplete() {
  const { width, height } = viewport();
  const boxWidth = Math.min(360, width - 32);
  const boxHeight = 132;
  ctx.fillStyle = colours.panel;
  ctx.fillRect((width - boxWidth) / 2, (height - boxHeight) / 2, boxWidth, boxHeight);
  ctx.strokeStyle = colours.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect((width - boxWidth) / 2, (height - boxHeight) / 2, boxWidth, boxHeight);
  message('Floor complete', height / 2 - 22, 'bold 24px system-ui, sans-serif');
  message(`${state.turn} turns · par ${level.par}`, height / 2 + 8);
  message('Press Enter to play again', height / 2 + 38, '14px system-ui, sans-serif');
}

/** Paint one frame: the floor and the player, or the loading or error screen. */
function draw(view, player) {
  const { width, height } = viewport();
  ctx.fillStyle = colours.sand;
  ctx.fillRect(0, 0, width, height);
  if (error) {
    message('The dungeon could not be loaded.', height / 2 - 12);
    error.message.split('\n').forEach((line, index) => message(line, height / 2 + 14 + index * 20));
  } else if (!sprites) {
    drawLoading();
  } else {
    drawScene(ctx, [...level.items, player], sprites, view);
    drawHud();
    // Wait for the last step to finish, so the player is seen arriving on the stairs.
    if (state.status === 'complete' && !walk) drawComplete();
  }
}

/** Fetch a level file and check it. */
async function fetchLevel(id) {
  const response = await fetch(levelUrl(id));
  if (!response.ok) throw new Error(`Level ${id} is missing (${response.status})`);
  return loadLevel(await response.json());
}

/** Show an error instead of the game. */
function fail(failure) {
  error = failure;
  console.error(failure);
  canvas.setAttribute('aria-label', 'The dungeon could not be loaded');
  announce(`The dungeon could not be loaded. ${failure.message}`);
  requestFrame();
}

window.addEventListener('resize', resize);
resize();

fetchLevel(FIRST_LEVEL).then((loaded) => {
  level = loaded;
  return loadSprites([...spritesFor(level.items), ...characterSprites()], {
    onProgress(done, total) {
      progress = { loaded: done, total };
      requestFrame();
    },
  });
}).then((loaded) => {
  sprites = loaded;
  state = createState(level);
  levelBounds = visibleBounds(level.items, sprites);
  canvas.setAttribute('aria-label', `${level.name}, an isometric dungeon floor. Use the arrow keys or W, A, S and D to walk to the stairs.`);
  announce(`${level.name}. Find the stairs.`);
  listenForKeys(window, (action) => {
    queue.push(action);
    requestFrame();
  });
  requestFrame();
}).catch(fail);
