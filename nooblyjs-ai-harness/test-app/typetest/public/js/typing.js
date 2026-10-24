// Pure typing logic: which letters are right, and how fast and accurate a run was.
// No DOM here, so the tests can check it directly.

import { KEY_FINGERS, LEFT_PINKY, RIGHT_PINKY, hand } from './fingers.js';

// Shifted symbols and the key they sit on, e.g. "!" is Shift + 1.
const SHIFTED = {
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`',
};

/** The key you press to get a character, e.g. "A" -> "a" and "!" -> "1". */
export function baseKey(ch) {
  if (ch === ' ') return ' ';
  if (ch.length !== 1) return ch; // named keys such as "Shift" or "Backspace"
  if (/[A-Z]/.test(ch)) return ch.toLowerCase();
  return Object.hasOwn(SHIFTED, ch) ? SHIFTED[ch] : ch;
}

/** True when a character needs Shift held down (capitals and shifted symbols). */
export function needsShift(ch) {
  return ch.length === 1 && (/[A-Z]/.test(ch) || Object.hasOwn(SHIFTED, ch));
}

/**
 * Which finger types a character, and which pinky holds Shift for it.
 * Shift is always held by the opposite hand, so the other pinky does the work.
 */
export function fingerInfo(ch) {
  const key = baseKey(ch);
  const finger = KEY_FINGERS.get(key) ?? null;
  let shiftFinger = null;
  if (needsShift(ch) && finger) {
    shiftFinger = hand(finger) === 'left' ? RIGHT_PINKY : LEFT_PINKY;
  }
  return { key, finger, shiftFinger };
}

/**
 * The state of each letter of the sentence, for colouring:
 * 'correct', 'wrong', 'current' (the next one to type) or 'pending'.
 */
export function letterStates(sentence, typed) {
  return sentence.split('').map((ch, i) => {
    if (i < typed.length) return typed[i] === ch ? 'correct' : 'wrong';
    return i === typed.length ? 'current' : 'pending';
  });
}

/** How many letters at the start of `typed` match the sentence. */
export function countCorrect(sentence, typed) {
  let count = 0;
  const limit = Math.min(sentence.length, typed.length);
  for (let i = 0; i < limit; i++) {
    if (typed[i] === sentence[i]) count++;
  }
  return count;
}

/**
 * Turn one finished run into numbers.
 * WPM uses the standard "5 characters = 1 word" rule, counting only correct letters.
 * Accuracy is the share of keystrokes that were not mistakes.
 * Errors counts every wrong keystroke, even if you fixed it with Backspace.
 */
export function calcResult({ sentence, typed, keystrokes, errors, seconds }) {
  const minutes = Math.max(seconds, 1) / 60; // at least one second, so a fast start can't divide by ~0
  const correct = countCorrect(sentence, typed);
  const wpm = Math.round(correct / 5 / minutes);
  const accuracy = keystrokes > 0
    ? Math.max(0, Math.round(((keystrokes - errors) / keystrokes) * 100))
    : 100;
  return { wpm, accuracy, errors, keystrokes, seconds: Math.round(seconds * 10) / 10 };
}
