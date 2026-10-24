// Browser side: reads the keyboard, runs the physics in a loop and draws the SVG.
import {
  FUEL_MAX,
  PLATFORMS,
  WORLD,
  buildTerrain,
  createGame,
  groundHeight,
  seededRandom,
  step,
} from './physics.js';

const SCALE = 4; // pixels per metre: the 250 m × 150 m world fills the 1000 × 600 viewBox
const VIEW_H = 600;
const STEP = 1 / 120; // physics runs in fixed small steps so it behaves the same at any frame rate

const px = (x) => x * SCALE;
const py = (y) => VIEW_H - y * SCALE; // SVG y grows downward; altitude grows upward

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const terrain = buildTerrain();
const world = { terrain, platforms: PLATFORMS, world: WORLD };
let game = createGame();

// --- Static scenery, drawn once ---
function drawScenery() {
  const random = seededRandom(42);
  for (let i = 0; i < 140; i++) {
    $('stars').append(el('circle', {
      cx: (random() * 1000).toFixed(1),
      cy: (random() * 560).toFixed(1),
      r: (random() * 1.2 + 0.2).toFixed(2),
      fill: '#fff',
      opacity: (random() * 0.6 + 0.3).toFixed(2),
    }));
  }

  const outline = terrain.map((p) => `${px(p.x)},${py(p.y)}`).join(' L');
  $('terrain').setAttribute('d', `M0,${VIEW_H} L${outline} L1000,${VIEW_H} Z`);

  for (const p of PLATFORMS) {
    const g = el('g', { id: `pad-${p.id}` });
    g.append(el('rect', {
      x: px(p.x), y: py(p.y) - 2, width: px(p.width), height: 6, fill: '#556', stroke: '#aab', 'stroke-width': 1,
    }));
    for (const x of [p.x + 0.6, p.x + p.width - 0.6]) {
      g.append(el('circle', { cx: px(x), cy: py(p.y) - 4, r: 2.5, class: 'pad-light', fill: '#ff5050' }));
    }
    const label = el('text', {
      x: px(p.x + p.width / 2), y: py(p.y) + 20, 'text-anchor': 'middle',
      'font-family': "'Courier New', monospace", 'font-size': 14, fill: '#ffd040',
    });
    label.textContent = `${p.id}`;
    g.append(label);
    $('platforms').append(g);
  }
}

// --- Keyboard ---
const keys = { left: false, right: false, thrust: false };
const KEY_MAP = { ArrowLeft: 'left', ArrowRight: 'right', ' ': 'thrust', Spacebar: 'thrust' };

addEventListener('keydown', (event) => {
  const name = KEY_MAP[event.key];
  if (name) {
    keys[name] = true;
    event.preventDefault(); // stop the page scrolling
  } else if (event.key === 'r' || event.key === 'R') {
    game = createGame();
  }
});
addEventListener('keyup', (event) => {
  const name = KEY_MAP[event.key];
  if (name) keys[name] = false;
});
addEventListener('blur', () => Object.assign(keys, { left: false, right: false, thrust: false }));

// --- Drawing each frame ---
function render() {
  const { lander, fuel, status } = game;
  const crashed = status === 'crashed';

  $('lander').setAttribute('transform', `translate(${px(lander.x)} ${py(lander.y)}) rotate(${lander.angle})`);
  $('lander').setAttribute('visibility', crashed ? 'hidden' : 'visible');
  $('explosion').setAttribute('visibility', crashed ? 'visible' : 'hidden');
  $('explosion').setAttribute('transform', `translate(${px(lander.x)} ${py(lander.y)})`);

  $('flame').setAttribute('visibility', game.thrusting ? 'visible' : 'hidden');
  if (game.thrusting) {
    const length = 26 + Math.random() * 10; // flicker
    $('flameShape').setAttribute('d', `M-4 13 L0 ${length} L4 13 Z`);
  }

  const share = fuel / FUEL_MAX;
  $('fuelBar').setAttribute('width', (164 * share).toFixed(1));
  $('fuelBar').setAttribute('fill', share > 0.5 ? '#3ddc84' : share > 0.2 ? '#ffc940' : '#ff5050');
  $('fuelText').textContent = `FUEL      ${fuel.toFixed(0).padStart(3)} / ${FUEL_MAX}`;
  const altitude = Math.max(0, lander.y - 3.6 - groundHeight(terrain, lander.x));
  $('altText').textContent = `ALTITUDE  ${altitude.toFixed(1).padStart(6)} m`;
  $('vxText').textContent = `H-SPEED   ${lander.vx.toFixed(1).padStart(6)} m/s`;
  $('vyText').textContent = `V-SPEED   ${lander.vy.toFixed(1).padStart(6)} m/s`;
  $('angleText').textContent = `ANGLE     ${lander.angle.toFixed(0).padStart(6)}°`;
  $('padsText').textContent = `PLATFORMS ${game.visited.length} / ${PLATFORMS.length} visited`;

  // Pad lights turn green once visited.
  for (const p of PLATFORMS) {
    const lit = game.visited.includes(p.id) ? '#3ddc84' : '#ff5050';
    for (const light of $(`pad-${p.id}`).querySelectorAll('.pad-light')) light.setAttribute('fill', lit);
  }

  $('message').textContent = game.message;
  $('message').setAttribute('fill', crashed ? '#ff7070' : status === 'won' ? '#3ddc84' : '#fff');
}

// --- Main loop ---
let last = performance.now();
let pending = 0;
function frame(now) {
  pending += Math.min(0.1, (now - last) / 1000); // cap, so a hidden tab doesn't jump ahead
  last = now;
  while (pending >= STEP) {
    game = step(game, keys, STEP, world);
    pending -= STEP;
  }
  render();
  requestAnimationFrame(frame);
}

drawScenery();
render();
requestAnimationFrame(frame);
