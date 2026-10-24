// Tests for the sound module, using a fake audio context so nothing is played.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sound } from '../js/sound.js';

// Records every node the game asks the audio system to create.
function fakeContext() {
  const made = { oscillators: [], gains: [], sources: [] };
  const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, start() {}, stop() {}, gain: param(), frequency: param() });
  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    resume() { this.state = 'running'; },
    createOscillator() { const n = node(); made.oscillators.push(n); return n; },
    createGain() { const n = node(); made.gains.push(n); return n; },
    createBufferSource() { const n = node(); made.sources.push(n); return n; },
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; },
  };
  return { ctx, made };
}

test('no sound is made before the player has clicked', () => {
  let calls = 0;
  const sound = new Sound(() => { calls++; return null; });
  sound.strike();
  sound.deposit();
  assert.equal(calls, 0, 'the audio system is not opened until unlock()');
});

test('unlock opens the audio system once', () => {
  let calls = 0;
  const { ctx } = fakeContext();
  const sound = new Sound(() => { calls++; return ctx; });
  sound.unlock();
  sound.unlock();
  assert.equal(calls, 1);
});

test('a strike plays a crack and a thump', () => {
  const { ctx, made } = fakeContext();
  const sound = new Sound(() => ctx);
  sound.unlock();
  sound.strike();
  assert.equal(made.sources.length, 1, 'one noise burst');
  assert.equal(made.oscillators.length, 1, 'one tone');
});

test('toggling sound off silences the effects', () => {
  const { ctx, made } = fakeContext();
  const sound = new Sound(() => ctx);
  sound.unlock();
  assert.equal(sound.toggle(), false);
  sound.strike();
  sound.deposit();
  sound.blip();
  assert.equal(made.oscillators.length, 0);
  assert.equal(made.sources.length, 0);
  assert.equal(sound.toggle(), true);
});

test('the laser hum starts once, and stops when turned off', () => {
  const { ctx, made } = fakeContext();
  const sound = new Sound(() => ctx);
  sound.unlock();
  sound.setHum(true);
  sound.setHum(true); // calling it again must not start a second hum
  assert.equal(made.oscillators.length, 1);
  sound.setHum(false);
  assert.equal(sound.hum, null);
});

test('turning sound off also stops the hum', () => {
  const { ctx } = fakeContext();
  const sound = new Sound(() => ctx);
  sound.unlock();
  sound.setHum(true);
  sound.toggle();
  assert.equal(sound.hum, null);
});
