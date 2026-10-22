import test from 'node:test';
import assert from 'node:assert/strict';
import { keyToAction, createActionQueue, listenForKeys } from '../public/input.js';

const key = (name, extra = {}) => ({ key: name, ...extra });

test('arrow keys and WASD move along the grid direction nearest to them on screen', () => {
  assert.deepEqual(keyToAction(key('ArrowUp')), { type: 'move', direction: 0 });
  assert.deepEqual(keyToAction(key('ArrowRight')), { type: 'move', direction: 2 });
  assert.deepEqual(keyToAction(key('ArrowDown')), { type: 'move', direction: 4 });
  assert.deepEqual(keyToAction(key('ArrowLeft')), { type: 'move', direction: 6 });
  assert.deepEqual(keyToAction(key('w')), keyToAction(key('ArrowUp')));
  assert.deepEqual(keyToAction(key('D')), keyToAction(key('ArrowRight'))); // Caps Lock or Shift
  assert.deepEqual(keyToAction(key('s')), keyToAction(key('ArrowDown')));
  assert.deepEqual(keyToAction(key('a')), keyToAction(key('ArrowLeft')));
});

test('Z waits', () => {
  assert.deepEqual(keyToAction(key('z')), { type: 'wait' });
});

test('other keys and browser shortcuts are ignored', () => {
  assert.equal(keyToAction(key('q')), null);
  assert.equal(keyToAction(key('Enter')), null);
  assert.equal(keyToAction(key('s', { ctrlKey: true })), null); // Ctrl+S saves the page, not a move
  assert.equal(keyToAction(key('a', { metaKey: true })), null);
});

test('the queue holds one action, and a newer one replaces it', () => {
  const queue = createActionQueue();
  assert.equal(queue.take(), null);
  queue.push({ type: 'wait' });
  queue.push({ type: 'move', direction: 2 });
  assert.equal(queue.size, 1);
  assert.deepEqual(queue.take(), { type: 'move', direction: 2 });
  assert.equal(queue.take(), null);
});

test('listenForKeys passes game keys on, stops them scrolling the page, and can be removed', () => {
  const listeners = new Map();
  const target = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const actions = [];
  const stop = listenForKeys(target, (action) => actions.push(action));
  let prevented = 0;
  listeners.get('keydown')({ key: 'ArrowUp', preventDefault: () => prevented++ });
  listeners.get('keydown')({ key: 'Tab', preventDefault: () => prevented++ });
  assert.deepEqual(actions, [{ type: 'move', direction: 0 }]);
  assert.equal(prevented, 1, 'Tab must still move focus');
  stop();
  assert.equal(listeners.size, 0);
});
