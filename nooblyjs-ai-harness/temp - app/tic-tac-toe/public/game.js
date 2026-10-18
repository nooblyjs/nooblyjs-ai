// Browser side: draws the board, handles clicks, and asks the server for the AI's move.

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const difficultyEl = document.getElementById('difficulty');
const scoreEls = {
  X: document.getElementById('score-x'),
  O: document.getElementById('score-o'),
  draw: document.getElementById('score-draw'),
};

const CELL_NAMES = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
const scores = JSON.parse(localStorage.getItem('neon-grid-scores') || '{"X":0,"O":0,"draw":0}');

const TAUNTS = {
  win: ['ICE BREACHED. YOU FLATLINED THE AI.', 'SYSTEM OVERRIDE SUCCESSFUL, CHOOM.', 'NEURAL CORE CORRUPTED. NICE RUN.'],
  lose: ['YOU GOT FLATLINED, RUNNER.', 'K4-T3: "PREDICTABLE. MEAT IS SO PREDICTABLE."', 'CONNECTION TERMINATED BY HOSTILE AI.'],
  draw: ['STALEMATE. THE GRID HOLDS.', 'K4-T3: "WE ARE... EVENLY MATCHED."', 'NO DATA EXTRACTED. TRY AGAIN.'],
};

let board = Array(9).fill(null);
let locked = false;

const cells = CELL_NAMES.map((name, i) => {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.setAttribute('role', 'gridcell');
  cell.setAttribute('aria-label', name);
  cell.tabIndex = 0;
  cell.addEventListener('click', () => play(i));
  cell.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(i); }
  });
  boardEl.appendChild(cell);
  return cell;
});

function render(winLine = []) {
  board.forEach((value, i) => {
    const cell = cells[i];
    cell.textContent = value ?? '';
    cell.className = 'cell' + (value ? ` taken ${value.toLowerCase()}` : '') + (winLine.includes(i) ? ' win-cell' : '');
  });
  boardEl.classList.toggle('locked', locked);
  Object.entries(scoreEls).forEach(([key, el]) => (el.textContent = scores[key]));
}

function setStatus(text, mood = '') {
  statusEl.textContent = '> ' + text;
  statusEl.className = 'status ' + mood;
}

function log(line) {
  const time = new Date().toLocaleTimeString('en-GB');
  logEl.textContent += `[${time}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function play(i) {
  if (locked || board[i]) return;

  board[i] = 'X';
  log(`RUNNER >> injected X at ${CELL_NAMES[i]}`);
  locked = true;
  render();

  setStatus('K4-T3 COMPUTING COUNTERMEASURES...');
  boardEl.classList.add('thinking');

  try {
    // Ask the server for the AI's reply, with a short dramatic pause.
    const [response] = await Promise.all([
      fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, difficulty: difficultyEl.value }),
      }),
      sleep(450),
    ]);
    if (!response.ok) throw new Error(`server said ${response.status}`);
    const data = await response.json();

    board = data.board;
    if (data.move !== null) log(`K4-T3  >> deployed O at ${CELL_NAMES[data.move]}`);
    finishTurn(data.result);
  } catch (err) {
    log(`!! UPLINK FAILURE: ${err.message}`);
    setStatus('UPLINK FAILURE. IS THE SERVER RUNNING?', 'lose');
    board[i] = null;
    locked = false;
    render();
  } finally {
    boardEl.classList.remove('thinking');
  }
}

function finishTurn(result) {
  if (!result) {
    locked = false;
    setStatus('YOUR MOVE, RUNNER_');
    render();
    return;
  }

  locked = true;
  if (result.winner === 'X') {
    scores.X++;
    setStatus(pick(TAUNTS.win), 'win');
    log('*** BREACH COMPLETE — RUNNER WINS ***');
  } else if (result.winner === 'O') {
    scores.O++;
    setStatus(pick(TAUNTS.lose), 'lose');
    log('*** FLATLINE — AI WINS ***');
  } else {
    scores.draw++;
    setStatus(pick(TAUNTS.draw));
    log('*** STALEMATE ***');
  }
  localStorage.setItem('neon-grid-scores', JSON.stringify(scores));
  render(result.line ?? []);
}

function reset() {
  board = Array(9).fill(null);
  locked = false;
  setStatus('GRID REBOOTED. YOUR MOVE, RUNNER_');
  log(`-- new session // threat level: ${difficultyEl.value.toUpperCase()} --`);
  render();
}

document.getElementById('reset').addEventListener('click', reset);
difficultyEl.addEventListener('change', reset);

log('K4-T3 NEURAL CORE ONLINE. AWAITING INTRUDER...');
render();
