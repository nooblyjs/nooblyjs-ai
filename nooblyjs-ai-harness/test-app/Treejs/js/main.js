// Space Miner: the three.js side of the game.
// The rules live in world.js, grid.js and mining.js. This file draws them and handles the mouse.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  WORLD_SIZE, generateWorld, DEPOT_DOCK, PROP_MODELS,
} from './world.js';
import { createGrid, findPath, findPathToTarget, isWalkable, key } from './grid.js';
import {
  createPlayer, createShip, stepMining, loadShip, shipFull, offload, quotaMet,
  CARGO_CAPACITY, SHIP_CAPACITY, QUOTA,
} from './mining.js';
import { heroPose, hitCount, createShake, addShake, stepShake } from './animation.js';
import {
  clampFocus, panFocus, edgePan, minimapToWorld, worldToMinimap, flightSeconds,
} from './view.js';
import { addGlow, MiningBeam, Particles, OreFlight, FloatingText } from './effects.js';
import { Sound } from './sound.js';

// The Kenney models sit in ui/Models; the space in the folder name becomes %20 in a web address.
const MODEL_DIR = 'ui/Models/GLTF%20format/';
const HERO_MODEL = 'astronautA';
const FLOOR_MODEL = 'terrain';
// Every model the game needs, loaded once at start-up.
const MODEL_NAMES = [...new Set([HERO_MODEL, FLOOR_MODEL, ...PROP_MODELS])];

const WALK_SPEED = 3.5; // tiles per second
const HERO_SCALE = 2;
const ROCK_SCALE = 1.1;
const PAN_SPEED = 14; // world units per second when scrolling with the keys or the screen edge
const MINIMAP_SCALE = 4; // pixels per tile on the minimap
const CAMERA_OFFSET = new THREE.Vector3(18, 18, 18); // the camera's fixed angle above and beside its focus
const SHIP_STATUS = {
  home: 'on its pad', outbound: 'flying to the depot', docked: 'unloading', inbound: 'flying home',
};
const VIEW_HALF_HEIGHT = 14; // how many world units the camera sees above and below its centre

const $ = (id) => document.getElementById(id);

// ---- World state ----------------------------------------------------------
const seed = Math.floor(Math.random() * 1_000_000) + 1;
const world = generateWorld(seed);
// The grid shares the same blocked Set as the world, so removing a rock frees its tile for walking.
const grid = createGrid(world.width, world.height, world.blocked);
const player = createPlayer();
const propById = new Map(world.props.map((p) => [p.id, p]));
const shipProp = world.props.find((p) => p.kind === 'ship');
const depotProp = world.props.find((p) => p.kind === 'depot');
const propGroups = new Map(); // prop id -> three.js group
const clickable = []; // groups the mouse can hit
let heroTile = { ...world.start };
let path = []; // tiles still to walk through; path[0] is the tile being walked to
let pending = null; // what to do when the walk ends: { type: 'mine', id } or { type: 'load' }
let activeMine = null; // the crystal node being mined right now
let hoveredId = null; // the crystal under the mouse, if any, so it can glow brighter
let swingTime = 0; // seconds of mining swing so far; restarts each time mining starts
let lastHits = 0; // how many pick hits we have already shown
let hero = null; // the astronaut's group
let rig = null; // the astronaut's named limbs, found once after loading
let won = false;

// The angles the astronaut is currently showing. They move towards the target pose each frame.
const pose = { bodyX: 0, bodyY: 0, armLeft: 0, armRight: 0, legLeft: 0, legRight: 0 };
let beam = null;
let particles = null;
let flight = null; // crystal pieces flying from the astronaut to the ship
let floats = null; // "+credits" text that pops up over the ship
const shake = createShake(); // the camera shake after each hit
const sound = new Sound(); // sound effects; the M key turns them on and off
const ship = createShip(); // the ship's hold: the astronaut loads it, the depot unloads it
let shipState = 'home'; // 'home', 'outbound', 'docked' (unloading at the depot) or 'inbound'
let shipTrip = null; // the ship's flight while it is moving: { t, duration, from, to }
// The camera looks at this point on the ground. It starts on the astronaut and can be scrolled away.
let focus = { x: world.start.col, z: world.start.row };
let followHero = true; // the camera follows the astronaut until the player scrolls
const keysDown = new Set(); // lowercase names of the keys being held (for scrolling)
let pointerClient = null; // the mouse position on the canvas, or null when it is outside
const minimap = $('minimap');
const minimapCtx = minimap.getContext('2d');

// ---- Renderer, camera and light -------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Shadows are off by default in three.js. We turn them on so the astronaut and the ship cast shadows.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // softens the shadow edges a little
$('scene').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a14);
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x202838, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
// The sun aims at the middle of the map, so its shadow camera can cover the whole map.
const mapMiddle = (WORLD_SIZE - 1) / 2; // same spot as "center" below, which is declared later
// The sun sits on the other side from the camera's corner, so shadows fall to the side of each
// model where you can see them. A sun behind the camera hides them. It is also low, so shadows are
// long enough to notice: a high sun makes a shadow about as short as the model is tall.
sun.position.set(mapMiddle - 9, 5, mapMiddle + 5);
sun.target.position.set(mapMiddle, 0, mapMiddle);
scene.add(sun, sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -WORLD_SIZE / 2 - 4;
sun.shadow.camera.right = WORLD_SIZE / 2 + 4;
sun.shadow.camera.top = WORLD_SIZE / 2 + 4;
sun.shadow.camera.bottom = -WORLD_SIZE / 2 - 4;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0005; // stops the shadow from speckling the models that cast it
sun.shadow.normalBias = 0.02;

// An isometric view: an orthographic camera looking down at the map from above one corner.
const center = new THREE.Vector3((WORLD_SIZE - 1) / 2, 0, (WORLD_SIZE - 1) / 2);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
camera.position.copy(center).add(new THREE.Vector3(18, 18, 18));
camera.lookAt(center);

function resize() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -VIEW_HALF_HEIGHT * aspect;
  camera.right = VIEW_HALF_HEIGHT * aspect;
  camera.top = VIEW_HALF_HEIGHT;
  camera.bottom = -VIEW_HALF_HEIGHT;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---- Models -----------------------------------------------------------------
const templates = new Map();
const offsets = new Map(); // model name -> how far to shift a copy so its centre sits on the spot

/** Downloads every model once. Each placed object is a copy of one of these. */
async function loadModels() {
  const loader = new GLTFLoader();
  const gltfs = await Promise.all(
    MODEL_NAMES.map((name) => loader.loadAsync(`${MODEL_DIR}${name}.glb`)),
  );
  MODEL_NAMES.forEach((name, i) => templates.set(name, gltfs[i].scene));
}

/** Turns shadows on for every mesh inside a group: cast (makes a shadow) and/or receive (takes one). */
function setShadows(group, { cast = false, receive = false } = {}) {
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = cast;
    obj.receiveShadow = receive;
  });
  return group;
}

/**
 * Puts a copy of a model at (x, z) on the ground. The model is centred on that spot
 * and its base sits at height 0, whatever the file's own origin is.
 */
function place(name, x, z, { scale = 1, rotation = 0 } = {}) {
  const template = templates.get(name);
  // Work out each model's offset once, not once per copy: the map now has over 2,000 floor tiles.
  if (!offsets.has(name)) {
    template.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(template);
    offsets.set(name, new THREE.Vector3(
      -(box.min.x + box.max.x) / 2,
      -box.min.y,
      -(box.min.z + box.max.z) / 2,
    ));
  }
  const model = template.clone(true);
  model.position.copy(offsets.get(name));
  const holder = new THREE.Group();
  holder.add(model);
  holder.position.set(x, 0, z);
  holder.rotation.y = rotation * (Math.PI / 2); // quarter turns
  holder.scale.setScalar(scale);
  scene.add(holder);
  return holder;
}

// ---- Building the scene -----------------------------------------------------
function buildWorld() {
  // Floor: one terrain tile for every grid square.
  for (let row = 0; row < world.height; row++) {
    for (let col = 0; col < world.width; col++) {
      // The floor receives shadows, so the astronaut and the ship show up on it.
      setShadows(place(FLOOR_MODEL, col, row), { receive: true });
    }
  }

  hero = place(HERO_MODEL, world.start.col, world.start.row, { scale: HERO_SCALE });
  setShadows(hero, { cast: true });
  rig = {
    model: hero.children[0],
    baseY: hero.children[0].position.y,
    body: hero.getObjectByName('body'),
    armLeft: hero.getObjectByName('armLeft'),
    armRight: hero.getObjectByName('armRight'),
    legLeft: hero.getObjectByName('legLeft'),
    legRight: hero.getObjectByName('legRight'),
  };

  for (const prop of world.props) {
    const { cx, cz } = oreCentre(prop);
    const scale = prop.kind === 'asteroid' ? ROCK_SCALE : 1;
    const group = place(prop.model, cx, cz, { scale, rotation: prop.rotation });
    group.userData.propId = prop.id;
    propGroups.set(prop.id, group);
    if (prop.kind === 'ship') setShadows(group, { cast: true });
    group.userData.punch = 0; // counts down after a hit, so the crystal or the ship jumps
    if (prop.kind !== 'decor') clickable.push(group);
    if (prop.kind === 'ore') {
      group.userData.glow = addGlow(group, { color: 0x7ff7ff });
      group.userData.phase = Math.random() * Math.PI * 2; // so the glows do not pulse in step
    }
  }

  beam = new MiningBeam(scene);
  particles = new Particles(scene);
  flight = new OreFlight(scene);
  floats = new FloatingText(camera);
  addStars();
}

/** The middle of a prop's footprint, in world units. */
function oreCentre(prop) {
  return {
    cx: prop.footprint.reduce((sum, t) => sum + t.col, 0) / prop.footprint.length,
    cz: prop.footprint.reduce((sum, t) => sum + t.row, 0) / prop.footprint.length,
  };
}

// A few hundred background stars so the empty space looks like space.
function addStars() {
  const count = 400;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = center.x + (Math.random() - 0.5) * WORLD_SIZE * 4;
    positions[i * 3 + 1] = -5 + Math.random() * 80;
    positions[i * 3 + 2] = center.z + (Math.random() - 0.5) * WORLD_SIZE * 4;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35 })));
}

// ---- Mouse: working out what was clicked --------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const groundPoint = new THREE.Vector3();

/**
 * Finds what is under the mouse. Returns { type: 'prop', prop } for a rock, crystal or ship,
 * { type: 'ground', col, row } for the floor, or null.
 */
function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  // Objects first: a click on a rock should hit the rock, not the floor behind it.
  const hit = raycaster.intersectObjects(clickable, true)[0];
  if (hit) {
    let node = hit.object;
    while (node && node.userData.propId === undefined) node = node.parent;
    const prop = node && propById.get(node.userData.propId);
    if (prop && propGroups.has(prop.id)) return { type: 'prop', prop };
  }

  if (raycaster.ray.intersectPlane(groundPlane, groundPoint)) {
    return { type: 'ground', col: Math.round(groundPoint.x), row: Math.round(groundPoint.z) };
  }
  return null;
}

function onClick(event) {
  // The first click unlocks sound: browsers only allow audio after a click.
  sound.unlock();
  const target = pick(event);
  if (!target) return;
  sound.blip();

  if (target.type === 'ground') {
    if (!isWalkable(grid, target.col, target.row)) {
      if (target.col >= 0 && target.row >= 0 && target.col < world.width && target.row < world.height) {
        say('Solid rock. Click a crystal to mine it.');
      }
      return;
    }
    const goal = { col: target.col, row: target.row };
    cancelMining();
    walk((from) => {
      const steps = findPath(grid, from, goal);
      return steps && { path: steps };
    }, null);
    return;
  }

  const { prop } = target;
  if (prop.kind === 'ship') {
    if (shipState !== 'home') {
      say('Your ship is away on a trip. Wait for it to land.');
      return;
    }
    cancelMining();
    walk((from) => findPathToTarget(grid, from, prop.footprint), { type: 'load' });
  } else if (prop.kind === 'depot') {
    driveShip();
  } else if (prop.kind === 'ore') {
    cancelMining();
    walk((from) => findPathToTarget(grid, from, prop.footprint), { type: 'mine', id: prop.id });
  } else if (prop.kind === 'asteroid') {
    say('Too much rock to dig out. Look for the glowing crystals.');
  }
}

function onHover(event) {
  pointerClient = { x: event.clientX, y: event.clientY };
  const target = pick(event);
  renderer.domElement.style.cursor = target && target.type === 'prop' ? 'pointer' : 'default';
  hoveredId = target && target.type === 'prop' && target.prop.kind === 'ore' ? target.prop.id : null;
}

// ---- Walking ----------------------------------------------------------------
/**
 * Starts a walk. plan(from) returns { path } (tiles to walk, not including from) or null.
 * action runs when the walk ends. If the hero is already walking, the new route
 * starts from the tile it is heading to, so it turns smoothly.
 */
function walk(plan, action) {
  const moving = path.length > 0;
  const from = moving ? path[0] : heroTile;
  const route = plan(from);
  if (!route) {
    say('No route there.');
    return;
  }
  path = moving ? [from, ...route.path] : [...route.path];
  pending = action;
  if (path.length === 0) arrive(); // already standing next to the target
}

/** Runs when the hero reaches the end of a walk. */
function arrive() {
  const action = pending;
  pending = null;
  if (!action) return;

  if (action.type === 'load') {
    loadTheShip();
  } else if (action.type === 'mine') {
    const prop = propById.get(action.id);
    if (!prop || !propGroups.has(prop.id)) {
      say('That crystal is already gone.');
    } else if (player.cargo >= CARGO_CAPACITY) {
      say('Your cargo is full. Carry it to the ship.');
    } else {
      activeMine = prop;
      swingTime = 0;
      lastHits = 0;
      say('Mining...');
    }
  }
}

// ---- Loading the ship and flying it to the depot -----------------------------
/** The astronaut tips its cargo into the ship's hold, as much as the hold can take. */
function loadTheShip() {
  if (shipState !== 'home') {
    say('Your ship is away on a trip. Wait for it to land.');
    return;
  }
  const moved = loadShip(player, ship);
  if (moved === 0) {
    say(player.cargo === 0
      ? 'Your cargo is empty. Mine some crystal first.'
      : 'The ship is full. Click the depot to drive it there.');
    return;
  }
  say(shipFull(ship)
    ? `The ship is full (${ship.hold} of ${ship.capacity}). Click the depot to drive it there.`
    : `Loaded ${moved} ore into the ship: ${ship.hold} of ${ship.capacity}.`);
  sendOreToShip(moved);
}

/**
 * Ore leaves the astronaut's hand in a stream and lands on the ship.
 * The ship bounces, sparkles and a "+N ore" label shows the new hold level.
 */
function sendOreToShip(count) {
  const { cx, cz } = oreCentre(shipProp);
  const from = new THREE.Vector3(hero.position.x, 1.0, hero.position.z);
  const to = new THREE.Vector3(cx, 0.8, cz);
  flight.launch(from, to, Math.min(count, 12), {
    onDone: () => {
      const group = propGroups.get(shipProp.id);
      if (group) group.userData.punch = 1;
      particles.burst(to, { count: 14, color: 0x7ff7ff, speed: 3, life: 0.6, size: 0.08 });
      sound.deposit();
      floats.spawn(`+${count} ore (hold ${ship.hold}/${ship.capacity})`, new THREE.Vector3(cx, 2.4, cz));
    },
  });
}

/** Clicking the depot: a full ship flies there. A part-full ship stays put. */
function driveShip() {
  if (shipState !== 'home') {
    say('Your ship is already on a trip.');
    return;
  }
  if (!shipFull(ship)) {
    say(`The ship's hold has ${ship.hold} of ${ship.capacity}. Fill it before driving to the depot.`);
    return;
  }
  setShipOnPad(false);
  startTrip(shipHome(), DEPOT_DOCK, 'outbound');
  say('Driving the full ship to the depot...');
}

/** The ship's parking spot on its pad, as { x, z } in world units. */
function shipHome() {
  const { cx, cz } = oreCentre(shipProp);
  return { x: cx, z: cz };
}

/** Starts the ship moving. delay (seconds) holds it still first. */
function startTrip(from, to, state, delay = 0) {
  shipState = state;
  shipTrip = { t: -delay, duration: flightSeconds(from, to), from, to };
  // Turn the ship's nose to face the way it is flying.
  propGroups.get(shipProp.id).rotation.y = Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** Moves the ship along its trip, lifting it off the ground in the middle of the flight. */
function updateShipTrip(dt) {
  if (!shipTrip) return;
  shipTrip.t += dt;
  if (shipTrip.t < 0) return; // still waiting before take-off
  const u = Math.min(1, shipTrip.t / shipTrip.duration);
  const eased = u * u * (3 - 2 * u);
  const { from, to } = shipTrip;
  propGroups.get(shipProp.id).position.set(
    from.x + (to.x - from.x) * eased,
    Math.sin(Math.PI * u) * 1.5, // climbs, flies, then settles
    from.z + (to.z - from.z) * eased,
  );
  if (u < 1) return;
  if (shipState === 'outbound') {
    shipTrip = null;
    arriveAtDepot();
  } else if (shipState === 'inbound' && padClear()) {
    shipTrip = null;
    arriveHome();
  }
}

/** The ship has landed at the depot: its load flies off into the depot and the credits pop up. */
function arriveAtDepot() {
  shipState = 'docked';
  const { cx, cz } = oreCentre(depotProp);
  const to = new THREE.Vector3(cx, 1.4, cz);
  const at = propGroups.get(shipProp.id).position;
  const count = Math.min(ship.hold, 12);
  say('Unloading the ship at the depot...');
  flight.launch(new THREE.Vector3(at.x, 1.4, at.z), to, count, {
    onDone: () => {
      const sold = offload(player, ship);
      particles.burst(to, { count: 14, color: 0xffd27a, speed: 3, life: 0.6, size: 0.08 });
      sound.deposit();
      floats.spawn(`+${sold.credits} credits`, new THREE.Vector3(cx, 2.6, cz));
      say(`Sold ${sold.ore} ore for ${sold.credits} credits.`);
      if (quotaMet(player) && !won) {
        won = true;
        say('Quota complete! Keep mining for more credits.');
      }
      startTrip(DEPOT_DOCK, shipHome(), 'inbound', 0.8);
    },
  });
}

/** The ship is back on its pad, ready to be loaded again. */
function arriveHome() {
  shipState = 'home';
  const { cx, cz } = oreCentre(shipProp);
  const group = propGroups.get(shipProp.id);
  group.position.set(cx, 0, cz);
  group.rotation.y = 0;
  setShipOnPad(true);
  say('The ship is back on its pad. Load it up again.');
}

/** True when the astronaut is not standing on or walking across the ship's pad. */
function padClear() {
  const onPad = (t) => shipProp.footprint.some((p) => p.col === t.col && p.row === t.row);
  return !onPad(heroTile) && !path.some(onPad);
}

/** The ship's tiles block walking while it is parked, and are open while it is away. */
function setShipOnPad(parked) {
  for (const { col, row } of shipProp.footprint) {
    if (parked) grid.blocked.add(key(col, row));
    else grid.blocked.delete(key(col, row));
  }
}

function cancelMining() {
  activeMine = null;
  pending = null;
}

/** Takes a crystal node out of the game: its model goes and its tiles open up. */
function removeProp(prop) {
  const group = propGroups.get(prop.id);
  if (group) {
    scene.remove(group);
    const index = clickable.indexOf(group);
    if (index !== -1) clickable.splice(index, 1);
    propGroups.delete(prop.id);
  }
  for (const { col, row } of prop.footprint) grid.blocked.delete(key(col, row));
  if (activeMine === prop) activeMine = null;
}

function moveHero(dt) {
  const next = path[0];
  const dx = next.col - hero.position.x;
  const dz = next.row - hero.position.z;
  const dist = Math.hypot(dx, dz);
  const step = WALK_SPEED * dt;
  // The Kenney astronaut's face points along its -z side, so turn -z toward the walk direction.
  if (dist > 0.0001) hero.rotation.y = Math.atan2(-dx, -dz);

  if (dist <= step) {
    hero.position.set(next.col, 0, next.row);
    heroTile = { col: next.col, row: next.row };
    path.shift();
    if (path.length === 0) arrive();
  } else {
    hero.position.x += (dx / dist) * step;
    hero.position.z += (dz / dist) * step;
  }
}

/** Turns the astronaut to face the crystal it is mining. */
function faceOre(prop) {
  const { cx, cz } = oreCentre(prop);
  const dx = cx - hero.position.x;
  const dz = cz - hero.position.z;
  if (Math.hypot(dx, dz) > 0.01) hero.rotation.y = Math.atan2(-dx, -dz);
}

/** Moves the limbs towards the target pose a little each frame, so changes look smooth. */
function applyPose(dt, target) {
  const k = 1 - Math.exp(-dt * 14);
  for (const name of Object.keys(pose)) {
    pose[name] += (target[name] - pose[name]) * k;
  }
  rig.body.rotation.x = pose.bodyX;
  rig.armLeft.rotation.x = pose.armLeft;
  rig.armRight.rotation.x = pose.armRight;
  rig.legLeft.rotation.x = pose.legLeft;
  rig.legRight.rotation.x = pose.legRight;
  rig.model.position.y = rig.baseY + pose.bodyY;
}

/** A hit on the rock: the crystal jumps, and sparks and chunks fly out. */
function strikeOre(prop) {
  addShake(shake, 0.12);
  sound.strike();
  const group = propGroups.get(prop.id);
  if (group) group.userData.punch = 1;
  const { cx, cz } = oreCentre(prop);
  const at = new THREE.Vector3(cx, 0.45, cz);
  particles.burst(at, { count: 8, color: 0xffc040, speed: 2.5, life: 0.45, size: 0.06 });
  particles.burst(at, { count: 3, color: 0x9ff3ff, speed: 1.6, life: 1.1, size: 0.12 });
}

// ---- Frame loop -------------------------------------------------------------
function update(dt, time) {
  const walking = path.length > 0;
  if (walking) moveHero(dt);
  const mining = Boolean(activeMine) && !walking;

  if (mining) {
    const result = stepMining(player, activeMine, dt);
    swingTime += dt;
    const hits = hitCount(swingTime);
    if (hits > lastHits) {
      lastHits = hits;
      strikeOre(activeMine);
    }
    if (result.status === 'depleted') {
      say('The crystal is empty.');
      sound.empty();
      removeProp(activeMine);
    } else if (result.status === 'full') {
      say('Your cargo is full. Carry it to the ship.');
      activeMine = null;
    }
  }

  const mode = walking ? 'walk' : (mining || activeMine) ? 'mine' : 'idle';
  if (mode === 'mine' && activeMine) faceOre(activeMine);
  applyPose(dt, heroPose(mode, time, swingTime));

  updateBeam(time, mining);
  sound.setHum(mining);
  updateOreGlow(dt, time);
  updateShipTrip(dt);
  updateShip(dt);
  particles.update(dt);
  flight.update(dt);
  floats.update(dt);
  updateHud();
}

/** Draws the laser from the astronaut's hand to the crystal while mining. */
function updateBeam(time, mining) {
  if (!mining || !activeMine) {
    beam.hide();
    return;
  }
  const { cx, cz } = oreCentre(activeMine);
  const dx = cx - hero.position.x;
  const dz = cz - hero.position.z;
  const dist = Math.hypot(dx, dz) || 1;
  const from = new THREE.Vector3(hero.position.x + (dx / dist) * 0.45, 0.9, hero.position.z + (dz / dist) * 0.45);
  const to = new THREE.Vector3(cx, 0.45, cz);
  beam.show(from, to, time);
}

/** Crystals glow softly, glow brighter under the mouse or while being mined, and jump on a hit. */
function updateOreGlow(dt, time) {
  const k = 1 - Math.exp(-dt * 6);
  for (const prop of world.props) {
    if (prop.kind !== 'ore') continue;
    const group = propGroups.get(prop.id);
    if (!group) continue;
    const { glow, phase } = group.userData;
    const target = prop.id === hoveredId ? 1 : activeMine === prop ? 0.8 : 0.4;
    const wanted = target + Math.sin(time * 2.5 + phase) * 0.08;
    glow.material.opacity += (wanted - glow.material.opacity) * k;

    const punch = group.userData.punch;
    group.scale.setScalar(1 + 0.18 * punch);
    group.userData.punch = Math.max(0, punch - dt * 5);
  }
}

/** The ship bounces a little each time ore lands on it. */
function updateShip(dt) {
  const group = propGroups.get(shipProp.id);
  if (!group) return;
  const punch = group.userData.punch;
  group.scale.setScalar(1 + 0.1 * punch);
  group.userData.punch = Math.max(0, punch - dt * 4);
}

function updateHud() {
  $('cargo').textContent = player.cargo;
  $('hold').textContent = ship.hold;
  $('holdFill').style.width = `${(ship.hold / ship.capacity) * 100}%`;
  $('shipStatus').textContent = SHIP_STATUS[shipState];
  $('credits').textContent = player.credits;
  $('delivered').textContent = player.delivered;
}

function say(text) {
  $('message').textContent = text;
}

// ---- Camera: scrolling, following and the minimap --------------------------
// Arrow keys and WASD scroll the view. Lowercase key names, mapped to a screen direction.
const PAN_KEYS = {
  arrowleft: { right: -1 }, a: { right: -1 },
  arrowright: { right: 1 }, d: { right: 1 },
  arrowup: { up: 1 }, w: { up: 1 },
  arrowdown: { up: -1 }, s: { up: -1 },
};
const MINIMAP_COLOURS = {
  floor: '#1c2a4a', asteroid: '#6b5a48', ore: '#7ff7ff', depot: '#ffd27a', ship: '#dfeaff',
};

/**
 * Moves the focus point: scrolls with the keys or the mouse at the screen edge, or
 * glides towards the astronaut when following. Any scrolling turns following off.
 */
function updateCamera(dt) {
  const pan = { right: 0, up: 0 };
  for (const name of keysDown) {
    const direction = PAN_KEYS[name];
    if (direction) {
      pan.right += direction.right || 0;
      pan.up += direction.up || 0;
    }
  }
  if (pointerClient) {
    const edge = edgePan(pointerClient.x, pointerClient.y, renderer.domElement.getBoundingClientRect());
    pan.right += edge.right;
    pan.up += edge.up;
  }

  if (pan.right !== 0 || pan.up !== 0) {
    followHero = false;
    focus = panFocus(focus, pan, PAN_SPEED, dt, WORLD_SIZE);
  } else if (followHero) {
    const k = 1 - Math.exp(-dt * 3); // a soft glide, so the view does not jerk
    focus = clampFocus({
      x: focus.x + (hero.position.x - focus.x) * k,
      z: focus.z + (hero.position.z - focus.z) * k,
    }, WORLD_SIZE);
  }
}

/** A click on the minimap jumps the view there. */
function onMinimapClick(event) {
  const rect = minimap.getBoundingClientRect();
  focus = clampFocus(minimapToWorld(event.clientX - rect.left, event.clientY - rect.top, MINIMAP_SCALE), WORLD_SIZE);
  followHero = false;
}

/** Redraws the minimap: the map, crystals, the depot, the ship, the astronaut and the visible area. */
function drawMinimap() {
  const S = MINIMAP_SCALE;
  const ctx = minimapCtx;
  ctx.fillStyle = MINIMAP_COLOURS.floor;
  ctx.fillRect(0, 0, minimap.width, minimap.height);

  // Each tile is a square; a prop that was mined out is no longer in propGroups, so it is not drawn.
  for (const prop of world.props) {
    if (prop.kind === 'decor' || prop.kind === 'ship' || !propGroups.has(prop.id)) continue;
    ctx.fillStyle = MINIMAP_COLOURS[prop.kind];
    for (const { col, row } of prop.footprint) ctx.fillRect(col * S, row * S, S, S);
  }

  // The ship moves, so it is drawn at its real position: a 2 x 2 block centred on it.
  const shipAt = propGroups.get(shipProp.id).position;
  const s = worldToMinimap(shipAt.x, shipAt.z, S);
  ctx.fillStyle = MINIMAP_COLOURS.ship;
  ctx.fillRect(s.px - S, s.py - S, 2 * S, 2 * S);

  const h = worldToMinimap(hero.position.x, hero.position.z, S);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(h.px, h.py, 3, 0, Math.PI * 2);
  ctx.fill();

  // The visible area: where the four corners of the screen meet the ground.
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, hit)
      ? worldToMinimap(hit.x, hit.z, S)
      : null;
  });
  if (corners.every(Boolean)) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.px, c.py) : ctx.lineTo(c.px, c.py)));
    ctx.closePath();
    ctx.stroke();
  }
}

// ---- Start-up ---------------------------------------------------------------
async function main() {
  $('capacity').textContent = CARGO_CAPACITY;
  $('holdCap').textContent = SHIP_CAPACITY;
  $('quota').textContent = QUOTA;
  resize();
  try {
    await loadModels();
  } catch (err) {
    console.error(err);
    say('Could not load the models. Serve this folder over http (see README).');
    return;
  }

  buildWorld();
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (event) => {
    const name = event.key.toLowerCase();
    if (name === 'm') $('sound').textContent = sound.toggle() ? 'on' : 'off';
    if (name === 'f') followHero = true;
    // Stop the arrow keys and space from scrolling the page itself.
    if (PAN_KEYS[name] || name === ' ') event.preventDefault();
    keysDown.add(name);
  });
  window.addEventListener('keyup', (event) => keysDown.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => keysDown.clear());
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.addEventListener('pointermove', onHover);
  renderer.domElement.addEventListener('pointerleave', () => { pointerClient = null; });
  minimap.width = WORLD_SIZE * MINIMAP_SCALE;
  minimap.height = WORLD_SIZE * MINIMAP_SCALE;
  minimap.addEventListener('click', onMinimapClick);
  say('Mine a crystal, load the ship, then click the depot when the ship is full.');

  // Each frame: move the focus, then place the camera at its fixed angle around the focus.
  // The shake nudges the aim point a little, so the whole view jolts.
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    update(dt, clock.elapsedTime);
    updateCamera(dt);
    const jolt = stepShake(shake, dt);
    const aim = new THREE.Vector3(focus.x, 0, focus.z).add(new THREE.Vector3(jolt.x, jolt.y, jolt.z));
    camera.position.copy(aim).add(CAMERA_OFFSET);
    camera.lookAt(aim);
    renderer.render(scene, camera);
    drawMinimap();
  });
}

main();
