// Browser side of TypeTest: draws the keyboard, measures your typing and talks to the server.
// The maths lives in js/typing.js, so this file is mostly about showing things on screen.

import { FINGERS, KEY_ROWS } from './js/fingers.js';
import { baseKey, calcResult, fingerInfo, letterStates } from './js/typing.js';

const $ = (id) => document.getElementById(id);
const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const sentenceEl = $('sentence');
const typedEl = $('typed');
const keyboardEl = $('keyboard');
const fingersEl = $('fingers');
const hintEl = $('next-hint');

const keyEls = new Map();   // key ("a", "1", " ") -> its element on the keyboard
const fingerEls = new Map(); // finger id -> its guide card
const fingerNames = new Map(FINGERS.map((f) => [f.id, f.name]));

// State of the current sentence.
let sentence = '';
let startedAt = null;
let timer = null;
let keystrokes = 0;
let errors = 0;
let prevLength = 0;
let done = false;

// ---------- Drawing the keyboard and the finger guide ----------

function drawKeyboard() {
  for (const row of KEY_ROWS) {
    const rowEl = el('div', '', 'key-row');
    for (const [label, finger] of row) {
      const isSpace = label === ' ';
      const keyEl = el('div', isSpace ? 'space' : label, `key finger-${finger}`);
      keyEl.dataset.key = label;
      if (isSpace) keyEl.classList.add('space');
      if (label === 'f' || label === 'j') keyEl.classList.add('home');
      keyEls.set(label, keyEl);
      rowEl.append(keyEl);
    }
    keyboardEl.append(rowEl);
  }
}

function drawFingers() {
  for (const finger of FINGERS) {
    const keys = KEY_ROWS.flat()
      .filter(([, f]) => f === finger.id)
      .map(([label]) => (label === ' ' ? 'Space' : label));
    // The card gets the same colour as that finger's keys, via a border (see styles.css).
    const card = el('div', '', `finger-card guide-${finger.id}`);
    card.append(
      el('h3', finger.name),
      el('p', `Rests on: ${finger.home}`),
      el('p', finger.job),
      el('p', `Keys: ${keys.join('  ')}`, 'keys'),
    );
    fingerEls.set(finger.id, card);
    fingersEl.append(card);
  }
}

// Light up the key the player should press next, and the finger that should press it.
function showNextKey() {
  for (const keyEl of keyEls.values()) keyEl.classList.remove('next');
  for (const card of fingerEls.values()) card.classList.remove('active');

  const next = sentence[typedEl.value.length];
  if (next === undefined) {
    hintEl.textContent = '';
    return;
  }
  const info = fingerInfo(next);
  keyEls.get(info.key)?.classList.add('next');
  fingerEls.get(info.finger)?.classList.add('active');

  const shiftText = info.shiftFinger
    ? ` Hold Shift with your ${fingerNames.get(info.shiftFinger).toLowerCase()}.`
    : '';
  const name = next === ' ' ? 'Space' : `"${next}"`;
  hintEl.textContent = `Next: ${name} with your ${fingerNames.get(info.finger)?.toLowerCase() ?? 'thumb'}.${shiftText}`;
}

// ---------- Showing the sentence and the stats ----------

function drawSentence() {
  const typed = typedEl.value;
  const states = letterStates(sentence, typed);
  sentenceEl.replaceChildren(
    ...sentence.split('').map((ch, i) =>
      el('span', ch === ' ' ? '\u00a0' : ch, states[i]),
    ),
  );
}

function currentSeconds() {
  return startedAt === null ? 0 : (performance.now() - startedAt) / 1000;
}

function drawStats() {
  const result = calcResult({
    sentence,
    typed: typedEl.value,
    keystrokes,
    errors,
    seconds: currentSeconds(),
  });
  $('time').textContent = `${result.seconds.toFixed(1)}s`;
  $('wpm').textContent = result.wpm;
  $('accuracy').textContent = `${result.accuracy}%`;
  $('errors').textContent = errors;
}

function refresh() {
  drawSentence();
  drawStats();
  showNextKey();
}

// ---------- Timing and finishing a sentence ----------

function startTimer() {
  startedAt = performance.now();
  timer = setInterval(drawStats, 100);
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

async function finish() {
  if (done) return;
  done = true;
  stopTimer();
  typedEl.readOnly = true;
  hintEl.textContent = '';

  const result = calcResult({
    sentence,
    typed: typedEl.value,
    keystrokes,
    errors,
    seconds: currentSeconds(),
  });
  drawStats();
  $('result').textContent = `Done! ${result.wpm} WPM, ${result.accuracy}% accuracy.`;

  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...result, sentence }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    $('result').textContent += ` Score ${body.saved.score}. Saved.`;
    drawSummary(body.summary);
    await loadScores();
  } catch (err) {
    $('result').textContent += ` (Could not save: ${err.message})`;
  }
}

// ---------- Keyboard and typing input ----------

// Light up each key while it is held, for the keyboard view.
window.addEventListener('keydown', (event) => {
  if (event.key.length !== 1) return; // skip Shift, Enter, Backspace and so on
  keyEls.get(baseKey(event.key))?.classList.add('pressed');
});
window.addEventListener('keyup', (event) => {
  if (event.key.length !== 1) return;
  keyEls.get(baseKey(event.key))?.classList.remove('pressed');
});

// Pasting would skip the typing, so block it.
typedEl.addEventListener('paste', (event) => event.preventDefault());

typedEl.addEventListener('input', () => {
  if (done) return;

  // Never let the player type past the end of the sentence.
  if (typedEl.value.length > sentence.length) {
    typedEl.value = typedEl.value.slice(0, sentence.length);
  }
  const value = typedEl.value;

  if (startedAt === null && value.length > 0) startTimer();

  // Count each new character: every keystroke counts, and wrong ones are errors.
  // Backspace removes a letter but does not undo the error, which is the honest measure.
  for (let i = prevLength; i < value.length; i++) {
    keystrokes++;
    if (value[i] !== sentence[i]) errors++;
  }
  prevLength = value.length;

  refresh();
  if (value === sentence) finish();
});

// Keep the typing box focused, so you can start typing straight away.
document.addEventListener('click', () => typedEl.focus());

// ---------- Starting sentences ----------

async function nextSentence() {
  stopTimer();
  const avoid = encodeURIComponent(sentence);
  const res = await fetch(`/api/sentence?avoid=${avoid}`);
  sentence = (await res.json()).text;

  typedEl.value = '';
  typedEl.readOnly = false;
  prevLength = 0;
  keystrokes = 0;
  errors = 0;
  startedAt = null;
  done = false;
  $('result').textContent = '';
  refresh();
  typedEl.focus();
}

$('next').addEventListener('click', nextSentence);

// ---------- Progress ----------

function drawSummary(summary) {
  const box = $('summary');
  box.replaceChildren();
  if (!summary || summary.runs === 0) {
    box.textContent = 'No runs yet. Finish a sentence and your progress will appear here.';
    return;
  }

  box.append(
    `You have ${summary.runs} run${summary.runs === 1 ? '' : 's'}. Best: `,
    el('strong', `${summary.best.wpm} WPM`),
    ` at ${summary.best.accuracy}% accuracy (score ${summary.best.score}). Average: ${summary.averageWpm} WPM, ${summary.averageAccuracy}% accuracy.`,
  );

  if (summary.wpmChange !== null) {
    const change = summary.wpmChange;
    const sign = change > 0 ? '+' : '';
    const trend = el('p', '', change >= 0 ? 'up' : 'down');
    trend.textContent = `Speed: ${summary.earlyWpm} WPM at the start, ${summary.recentWpm} WPM lately (${sign}${change} WPM). ` +
      `Accuracy change: ${summary.accuracyChange > 0 ? '+' : ''}${summary.accuracyChange}%.`;
    box.append(trend);
  }
}

async function loadScores() {
  const res = await fetch('/api/scores');
  const { scores, summary } = await res.json();
  drawSummary(summary);

  const rows = [...scores].reverse().slice(0, 10).map((run) => {
    const tr = el('tr');
    const when = new Date(run.at).toLocaleString();
    tr.append(
      el('td', when),
      el('td', String(run.wpm)),
      el('td', `${run.accuracy}%`),
      el('td', String(run.errors)),
      el('td', String(run.score)),
    );
    return tr;
  });
  $('history').replaceChildren(...rows);
}

// ---------- Start ----------

drawKeyboard();
drawFingers();
nextSentence();
loadScores();
