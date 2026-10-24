import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINGERS, KEY_FINGERS, KEY_ROWS, hand } from '../public/js/fingers.js';
import { baseKey, calcResult, countCorrect, fingerInfo, letterStates, needsShift } from '../public/js/typing.js';

test('every key on the keyboard has a finger', () => {
  for (const row of KEY_ROWS) {
    for (const [label, finger] of row) {
      assert.ok(FINGERS.some((f) => f.id === finger), `${label} has an unknown finger ${finger}`);
    }
  }
});

test('home row keys are pressed by the fingers that rest on them', () => {
  assert.equal(KEY_FINGERS.get('a'), 'left-pinky');
  assert.equal(KEY_FINGERS.get('s'), 'left-ring');
  assert.equal(KEY_FINGERS.get('d'), 'left-middle');
  assert.equal(KEY_FINGERS.get('f'), 'left-index');
  assert.equal(KEY_FINGERS.get('j'), 'right-index');
  assert.equal(KEY_FINGERS.get('k'), 'right-middle');
  assert.equal(KEY_FINGERS.get('l'), 'right-ring');
  assert.equal(KEY_FINGERS.get(';'), 'right-pinky');
});

test('the space bar belongs to the thumbs', () => {
  assert.equal(KEY_FINGERS.get(' '), 'thumbs');
});

test('the index fingers cover two columns each', () => {
  assert.equal(KEY_FINGERS.get('g'), 'left-index');
  assert.equal(KEY_FINGERS.get('b'), 'left-index');
  assert.equal(KEY_FINGERS.get('h'), 'right-index');
  assert.equal(KEY_FINGERS.get('n'), 'right-index');
});

test('hand() says which hand a finger is on', () => {
  assert.equal(hand('left-ring'), 'left');
  assert.equal(hand('right-pinky'), 'right');
  assert.equal(hand('thumbs'), null);
});

test('capitals and shifted symbols map back to their base key', () => {
  assert.equal(baseKey('A'), 'a');
  assert.equal(baseKey('!'), '1');
  assert.equal(baseKey('?'), '/');
  assert.equal(baseKey(' '), ' ');
  assert.equal(baseKey('Shift'), 'Shift');
});

test('needsShift is true for capitals and shifted symbols only', () => {
  assert.equal(needsShift('G'), true);
  assert.equal(needsShift('?'), true);
  assert.equal(needsShift('g'), false);
  assert.equal(needsShift('7'), false);
});

test('fingerInfo tells you the finger and the Shift finger on the other hand', () => {
  assert.deepEqual(fingerInfo('f'), { key: 'f', finger: 'left-index', shiftFinger: null });
  assert.deepEqual(fingerInfo('F'), { key: 'f', finger: 'left-index', shiftFinger: 'right-pinky' });
  assert.deepEqual(fingerInfo('J'), { key: 'j', finger: 'right-index', shiftFinger: 'left-pinky' });
});

test('letterStates marks correct, wrong, the current letter and pending letters', () => {
  assert.deepEqual(letterStates('abc', ''), ['current', 'pending', 'pending']);
  assert.deepEqual(letterStates('abc', 'a'), ['correct', 'current', 'pending']);
  assert.deepEqual(letterStates('abc', 'ax'), ['correct', 'wrong', 'current']);
  assert.deepEqual(letterStates('abc', 'abc'), ['correct', 'correct', 'correct']);
});

test('countCorrect only counts matching letters in order', () => {
  assert.equal(countCorrect('hello', 'hxllo'), 4);
  assert.equal(countCorrect('hello', 'he'), 2);
  assert.equal(countCorrect('hi', ''), 0);
});

test('calcResult works out WPM from correct letters (5 letters = 1 word)', () => {
  // 25 correct letters in 30 seconds = 5 words in half a minute = 10 WPM.
  const sentence = 'a'.repeat(25);
  const result = calcResult({ sentence, typed: sentence, keystrokes: 25, errors: 0, seconds: 30 });
  assert.equal(result.wpm, 10);
  assert.equal(result.accuracy, 100);
});

test('calcResult counts accuracy from keystrokes and errors', () => {
  const result = calcResult({ sentence: 'abcd', typed: 'abcd', keystrokes: 8, errors: 2, seconds: 60 });
  assert.equal(result.accuracy, 75);
  assert.equal(result.errors, 2);
});

test('calcResult does not divide by zero on a very fast start', () => {
  const result = calcResult({ sentence: 'hi', typed: 'hi', keystrokes: 2, errors: 0, seconds: 0 });
  assert.ok(Number.isFinite(result.wpm));
});

test('calcResult gives 100% accuracy when nothing was typed', () => {
  const result = calcResult({ sentence: 'hi', typed: '', keystrokes: 0, errors: 0, seconds: 5 });
  assert.equal(result.accuracy, 100);
});
