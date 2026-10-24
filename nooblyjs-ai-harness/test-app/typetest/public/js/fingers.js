// Which finger should press which key on a standard (US QWERTY) keyboard.
// Shared by the browser and the tests, so it has no DOM code.

export const LEFT_PINKY = 'left-pinky';
export const LEFT_RING = 'left-ring';
export const LEFT_MIDDLE = 'left-middle';
export const LEFT_INDEX = 'left-index';
export const RIGHT_INDEX = 'right-index';
export const RIGHT_MIDDLE = 'right-middle';
export const RIGHT_RING = 'right-ring';
export const RIGHT_PINKY = 'right-pinky';
export const THUMBS = 'thumbs';

// Each finger, where it rests on the "home row" (the middle row of letters), and what it reaches.
export const FINGERS = Object.freeze([
  {
    id: LEFT_PINKY, name: 'Left pinky', home: 'A',
    job: 'Reaches the far-left keys: Tab, Caps Lock, Shift, 1, ` , Q, A and Z. Also used to hold Shift for right-hand capitals.',
  },
  {
    id: LEFT_RING, name: 'Left ring finger', home: 'S',
    job: 'Reaches 2, W, S and X.',
  },
  {
    id: LEFT_MIDDLE, name: 'Left middle finger', home: 'D',
    job: 'Reaches 3, E, D and C.',
  },
  {
    id: LEFT_INDEX, name: 'Left index finger', home: 'F',
    job: 'Covers two columns: 4, 5, R, T, F, G, V and B. The F key has a small bump so you can feel your way back to home.',
  },
  {
    id: RIGHT_INDEX, name: 'Right index finger', home: 'J',
    job: 'Covers two columns: 6, 7, Y, U, H, J, N and M. The J key has a bump, like F.',
  },
  {
    id: RIGHT_MIDDLE, name: 'Right middle finger', home: 'K',
    job: 'Reaches 8, I, K and comma.',
  },
  {
    id: RIGHT_RING, name: 'Right ring finger', home: 'L',
    job: 'Reaches 9, O, L and full stop (period).',
  },
  {
    id: RIGHT_PINKY, name: 'Right pinky', home: ';',
    job: 'Reaches 0, -, =, P, [, ], \\, ;, \', /, Enter and Backspace. Also used to hold Shift for left-hand capitals.',
  },
  {
    id: THUMBS, name: 'Thumbs', home: 'Space',
    job: 'Both thumbs rest on the space bar. Use either one, and keep the other hand on home.',
  },
]);

const L = LEFT_PINKY, LR = LEFT_RING, LM = LEFT_MIDDLE, LI = LEFT_INDEX;
const RI = RIGHT_INDEX, RM = RIGHT_MIDDLE, RR = RIGHT_RING, RP = RIGHT_PINKY;

/** The keyboard, row by row. Each key is [label, finger]. */
export const KEY_ROWS = Object.freeze([
  [['`', L], ['1', L], ['2', LR], ['3', LM], ['4', LI], ['5', LI], ['6', RI], ['7', RI], ['8', RM], ['9', RR], ['0', RP], ['-', RP], ['=', RP]],
  [['q', L], ['w', LR], ['e', LM], ['r', LI], ['t', LI], ['y', RI], ['u', RI], ['i', RM], ['o', RR], ['p', RP], ['[', RP], [']', RP], ['\\', RP]],
  [['a', L], ['s', LR], ['d', LM], ['f', LI], ['g', LI], ['h', RI], ['j', RI], ['k', RM], ['l', RR], [';', RP], ["'", RP]],
  [['z', L], ['x', LR], ['c', LM], ['v', LI], ['b', LI], ['n', RI], ['m', RI], [',', RM], ['.', RR], ['/', RP]],
  [[' ', THUMBS]],
]);

/** Map from a key (lowercase letter, digit or symbol, or ' ') to the finger that presses it. */
export const KEY_FINGERS = new Map(KEY_ROWS.flat().map(([key, finger]) => [key, finger]));

/** Which hand a finger belongs to, or null for the thumbs. */
export function hand(finger) {
  if (finger?.startsWith('left')) return 'left';
  if (finger?.startsWith('right')) return 'right';
  return null;
}
