// Phase 2: turn key presses into game actions.
// The grid is turned 45° on screen, so each arrow key moves along the grid direction nearest to it,
// turned clockwise: Up goes up-right, Right goes down-right, Down goes down-left, Left goes up-left.

/** Keys (event.key, lower-cased) and the action each one makes. */
export const KEY_ACTIONS = Object.freeze({
  arrowup: { type: 'move', direction: 0 },
  w: { type: 'move', direction: 0 },
  arrowright: { type: 'move', direction: 2 },
  d: { type: 'move', direction: 2 },
  arrowdown: { type: 'move', direction: 4 },
  s: { type: 'move', direction: 4 },
  arrowleft: { type: 'move', direction: 6 },
  a: { type: 'move', direction: 6 },
  z: { type: 'wait' },
});

/** The action for a keyboard event, or null if the key does nothing (or is part of a shortcut like Ctrl+S). */
export function keyToAction(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return KEY_ACTIONS[event.key.toLowerCase()] ?? null;
}

/**
 * A queue that holds at most one action.
 * While the player is still walking to the next tile, a new key press is remembered rather than lost,
 * but holding a key down cannot pile up a long list of moves that carry on after you let go.
 * A newer action replaces the waiting one.
 */
export function createActionQueue() {
  let waiting = null;
  return {
    push(action) { waiting = action; },
    take() {
      const action = waiting;
      waiting = null;
      return action;
    },
    get size() { return waiting ? 1 : 0; },
  };
}

/** Listen for game keys on `target` (usually window) and pass each action to `onAction`. Returns a function that stops listening. */
export function listenForKeys(target, onAction) {
  const handler = (event) => {
    const action = keyToAction(event);
    if (!action) return;
    event.preventDefault(); // stop arrow keys and Space scrolling the page
    onAction(action);
  };
  target.addEventListener('keydown', handler);
  return () => target.removeEventListener('keydown', handler);
}
