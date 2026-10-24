// Visual effects: the glow around crystals, the mining laser, the flying sparks,
// the ore that flies to the ship when you sell it, and the floating "+credits" text.
// These are three.js objects, drawn in the browser. The rules are in mining.js.

import * as THREE from 'three';
import { arcPoint } from './animation.js';

const UP = new THREE.Vector3(0, 1, 0);
const MAX_PARTICLES = 160; // old sparks are removed first, so the frame rate stays steady

let glowTextureCache = null;

/** A soft white dot that fades to nothing at its edge. Used by the glows and sparks. */
export function glowTexture() {
  if (!glowTextureCache) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    glowTextureCache = new THREE.CanvasTexture(canvas);
  }
  return glowTextureCache;
}

/** Adds a soft halo to a crystal. Returns the sprite so its brightness can be changed. */
export function addGlow(group, { color = 0x7ff7ff, height = 0.5, size = 1.8 } = {}) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending, // light adds up, so overlapping glows look brighter
    depthWrite: false,
  }));
  sprite.scale.setScalar(size);
  sprite.position.y = height;
  group.add(sprite);
  return sprite;
}

/**
 * The mining laser: a bright core, a flickering orange halo, a glow where the beam leaves
 * the astronaut's hand, and a hot spot on the crystal.
 */
export class MiningBeam {
  constructor(scene) {
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    this.core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0, ...additive }),
    );
    this.halo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 1, 14),
      new THREE.MeshBasicMaterial({ color: 0xff9a2e, opacity: 0.35, ...additive }),
    );
    this.handGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffd27a, ...additive,
    }));
    this.hotSpot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffb040, ...additive,
    }));
    this.group = new THREE.Group();
    this.group.add(this.core, this.halo, this.handGlow, this.hotSpot);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Draws the beam from one point to another, with a shimmer that depends on time. */
  show(from, to, time) {
    this.group.visible = true;
    const dir = new THREE.Vector3().subVectors(to, from);
    const length = dir.length();
    dir.normalize();
    const middle = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const flicker = 0.85 + 0.15 * Math.sin(time * 47);

    for (const part of [this.core, this.halo]) {
      part.position.copy(middle);
      part.quaternion.setFromUnitVectors(UP, dir);
      part.scale.set(1, length, 1);
    }
    this.halo.scale.set(flicker, length, flicker);
    this.halo.material.opacity = 0.3 + 0.15 * Math.sin(time * 30);

    this.handGlow.position.copy(from);
    this.handGlow.scale.setScalar(0.7 + 0.2 * Math.sin(time * 25));

    this.hotSpot.position.copy(to);
    this.hotSpot.scale.setScalar(0.6 + 0.25 * Math.abs(Math.sin(time * 18)));
  }

  hide() {
    this.group.visible = false;
  }
}

/** Small pieces that fly out when the pick hits: sparks and chunks of crystal. */
export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.materials = new Map();
  }

  material(color) {
    if (!this.materials.has(color)) {
      this.materials.set(color, new THREE.MeshBasicMaterial({ color }));
    }
    return this.materials.get(color);
  }

  /** Throws a few particles out from origin. */
  burst(origin, { count = 8, color = 0xffc040, speed = 2.5, life = 0.45, size = 0.06, gravity = 9 } = {}) {
    for (let i = 0; i < count; i++) {
      if (this.items.length >= MAX_PARTICLES) this.remove(this.items.shift());
      const mesh = new THREE.Mesh(this.geometry, this.material(color));
      mesh.position.copy(origin);
      mesh.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      const velocity = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.9 + 0.4, // mostly upward
        Math.random() - 0.5,
      ).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      this.scene.add(mesh);
      this.items.push({ mesh, velocity, life, maxLife: life, size, gravity });
    }
  }

  remove(item) {
    this.scene.remove(item.mesh);
  }

  /** Moves every particle on by dt seconds and drops the ones that have expired. */
  update(dt) {
    this.items = this.items.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        this.remove(p);
        return false;
      }
      p.velocity.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.mesh.position.y < 0) {
        // Bounce on the ground and lose some energy.
        p.mesh.position.y = 0;
        p.velocity.y *= -0.35;
        p.velocity.x *= 0.6;
        p.velocity.z *= 0.6;
      }
      const fade = p.life / p.maxLife;
      p.mesh.scale.setScalar(p.size * (0.4 + 0.6 * fade));
      return true;
    });
  }
}

/**
 * Crystal pieces that fly from the astronaut to the ship when ore is sold.
 * They start one after another, so it looks like a stream, not one blob.
 */
export class OreFlight {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial({ color: 0x7ff7ff });
  }

  /** Sends `count` pieces from `from` to `to`. onDone runs once the last piece lands. */
  launch(from, to, count, { onDone = null, duration = 0.7 } = {}) {
    const batch = { remaining: count, onDone };
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.scale.setScalar(0.16);
      mesh.visible = false;
      this.scene.add(mesh);
      this.items.push({
        mesh,
        from: from.clone(),
        to: to.clone(),
        t: -i * 0.07, // a negative time means "not started yet"
        duration,
        height: 2.2 + Math.random() * 1.5,
        batch,
      });
    }
  }

  update(dt) {
    this.items = this.items.filter((p) => {
      p.t += dt;
      if (p.t < 0) return true;
      const u = p.t / p.duration;
      if (u >= 1) {
        this.scene.remove(p.mesh);
        p.batch.remaining -= 1;
        if (p.batch.remaining === 0 && p.batch.onDone) p.batch.onDone();
        return false;
      }
      const point = arcPoint(p.from, p.to, u, p.height);
      p.mesh.visible = true;
      p.mesh.position.set(point.x, point.y, point.z);
      p.mesh.rotation.x += dt * 8;
      p.mesh.rotation.y += dt * 6;
      return true;
    });
  }
}

/** Words that float up from a point in the world, such as "+250 credits". */
export class FloatingText {
  constructor(camera, container = document.body) {
    this.camera = camera;
    this.container = container;
    this.items = [];
  }

  spawn(text, worldPos, { color = '#ffe27a' } = {}) {
    const el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.color = color;
    this.container.appendChild(el);
    this.items.push({ el, pos: worldPos.clone(), life: 1.4, maxLife: 1.4 });
  }

  update(dt) {
    this.items = this.items.filter((it) => {
      it.life -= dt;
      if (it.life <= 0) {
        it.el.remove();
        return false;
      }
      // Turn the world point into screen pixels, then lift it a little more over time.
      const v = it.pos.clone().project(this.camera);
      const x = ((v.x + 1) / 2) * window.innerWidth;
      const y = ((1 - v.y) / 2) * window.innerHeight - (1 - it.life / it.maxLife) * 60;
      it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      it.el.style.opacity = String(Math.min(1, it.life / (it.maxLife * 0.5)));
      return true;
    });
  }
}
