import { fromFen, colorOf, opposite, squareName, squareIndex, legalMoves, applyMove, inCheck, outcome, positionKey, notation } from './chess.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const board = $('board');
let state, human = 'w', flipped = false, selected = null, focused = 60;
let moves = [], records = [], snapshots = [], keys = [], promotionMoves = [];
let worker = null, aiTimer = null, generation = 0, thinking = false;
let animationFrame = 0, animationEnds = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function svg(tag, attributes = {}) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
function pieceImage(piece, x = 0, y = 0, width = 64, height = 88) {
  const use = svg('use', { href: `./pieces.svg#${names[piece.toLowerCase()]}`, x, y, width, height, class: `piece piece-${colorOf(piece) === 'w' ? 'white' : 'black'}` });
  return use;
}
function smallPiece(piece) {
  const image = svg('svg', { viewBox: '0 0 64 88', 'aria-hidden': 'true' });
  image.append(pieceImage(piece));
  return image;
}
function point(row, col) { return [480 + (col - row) * 53, 106 + (col + row) * 28]; }
function polygon(points, attributes = {}) { return svg('polygon', { points: points.map((p) => p.join(',')).join(' '), ...attributes }); }
function shownSquare(row, col) { return flipped ? 63 - (row * 8 + col) : row * 8 + col; }

// Where a real square is drawn: [row, col] on screen, honouring the flip.
function displayed(square) { const shown = flipped ? 63 - square : square; return [Math.floor(shown / 8), shown % 8]; }

// One upright piece: its floor shadow plus the artwork, grouped so they move together.
// data-depth (row + col on screen) decides the painting order: higher = nearer the viewer.
function pieceUnit(piece, square) {
  const [row, col] = displayed(square);
  const [x, y] = point(row, col);
  const unit = svg('g', { class: 'piece-unit', 'data-depth': row + col });
  unit.append(svg('ellipse', { cx: x + 2, cy: y + 31, rx: 20, ry: 8, fill: '#0b2527', opacity: .22, class: 'piece' }));
  const image = pieceImage(piece, x - 28, y - 40, 56, 77);
  image.setAttribute('data-piece-square', square);
  image.addEventListener('click', () => { focused = square; selectSquare(square); });
  unit.append(image);
  return unit;
}

function renderBoard(animation) {
  cancelAnimationFrame(animationFrame);
  const hadFocus = board.contains(document.activeElement);
  board.replaceChildren();
  const back = point(0, 0), right = point(0, 8), front = point(8, 8), left = point(8, 0);
  board.append(polygon([left, front, [front[0], front[1] + 22], [left[0], left[1] + 22]], { fill: '#253c3c', stroke: '#1c3032', 'stroke-width': 2 }));
  board.append(polygon([front, right, [right[0], right[1] + 22], [front[0], front[1] + 22]], { fill: '#152a2d', stroke: '#1c3032', 'stroke-width': 2 }));
  board.append(polygon([back, right, front, left], { fill: 'none', stroke: '#738479', 'stroke-width': 9, 'stroke-linejoin': 'round' }));
  const targets = moves.filter((m) => m.from === selected);
  const last = records.at(-1)?.move;
  const checkedKing = inCheck(state) ? state.board.indexOf(state.turn === 'w' ? 'K' : 'k') : -1;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = shownSquare(row, col), piece = state.board[square];
      const [x, y] = point(row, col);
      const isTarget = targets.some((m) => m.to === square);
      let fill = (row + col) % 2 ? '#5e7e76' : '#d4d4b6';
      if (last && (square === last.from || square === last.to)) fill = (row + col) % 2 ? '#a1975d' : '#d1c48a';
      if (square === selected) fill = '#d9b565';
      if (square === checkedKing) fill = '#ba6a60';
      const label = `${squareName(square)}${piece ? `, ${colorOf(piece) === 'w' ? 'white' : 'black'} ${names[piece.toLowerCase()]}` : ', empty'}${isTarget ? ', available move' : ''}`;
      const group = svg('g', { class: 'square', role: 'button', tabindex: square === focused ? 0 : -1, 'aria-label': label, 'aria-pressed': square === selected, 'data-square': square });
      group.append(polygon([[x,y],[x+53,y+28],[x,y+56],[x-53,y+28]], { fill, stroke: '#16333733', 'stroke-width': .8, class: 'tile' }));
      group.addEventListener('click', () => { focused = square; selectSquare(square); });
      group.addEventListener('keydown', (event) => keyboard(event, square));
      board.append(group);
      if (isTarget) {
        board.append(svg('ellipse', { cx: x, cy: y + 28, rx: piece ? 29 : 8, ry: piece ? 15 : 4.5, fill: piece ? 'none' : '#254f48', stroke: piece ? '#355a4b' : 'none', 'stroke-width': 3, opacity: .85, class: 'move-marker' }));
      }
    }
  }
  // Draw the upright artwork back-to-front, above the projected diamond tiles.
  const layer = svg('g', { class: 'pieces' });
  for (let depth = 0; depth <= 14; depth++) {
    for (let row = 0; row < 8; row++) {
      const col = depth - row;
      if (col < 0 || col >= 8) continue;
      const square = shownSquare(row, col), piece = state.board[square];
      if (piece) layer.append(pieceUnit(piece, square));
    }
  }
  board.append(layer);
  for (let i = 0; i < 8; i++) {
    const [fx, fy] = point(8, i + .5), [rx, ry] = point(i + .5, 8);
    const file = svg('text', { x: fx - 12, y: fy + 17, class: 'coordinate', 'text-anchor': 'middle' });
    file.textContent = flipped ? 'hgfedcba'[i] : 'abcdefgh'[i];
    const rank = svg('text', { x: rx + 15, y: ry + 17, class: 'coordinate', 'text-anchor': 'middle' });
    rank.textContent = flipped ? i + 1 : 8 - i;
    board.append(file, rank);
  }
  if (hadFocus) board.querySelector(`[data-square="${focused}"]`)?.focus({ preventScroll: true });
  if (animation && !reducedMotion.matches) animateMove(layer, animation);
}

// Put a moving unit back into the painting order for its current (fractional) depth:
// just before the first standing piece that is nearer the viewer.
function placeByDepth(layer, unit, depth, moving) {
  const next = [...layer.children].find((other) => !moving.includes(other) && Number(other.dataset.depth) > depth) || null;
  if (unit.nextSibling !== next) layer.insertBefore(unit, next);
}

// The board is already drawn in the new position; slide the moved piece(s) from where they came from.
function animateMove(layer, { move, captured, piece }) {
  const find = (square) => layer.querySelector(`[data-piece-square="${square}"]`)?.closest('.piece-unit');
  const tracks = [{ unit: find(move.to), from: move.from, to: move.to, hop: piece.toLowerCase() === 'n' }];
  if (move.castle) {
    const rookFrom = move.from + (move.castle === 'K' ? 3 : -4), rookTo = move.from + (move.castle === 'K' ? 1 : -1);
    tracks.push({ unit: find(rookTo), from: rookFrom, to: rookTo });
  }
  if (!tracks[0].unit) return;
  const image = tracks[0].unit.querySelector('use');
  const finalHref = image.getAttribute('href');
  if (move.promotion) image.setAttribute('href', './pieces.svg#pawn'); // arrive as a pawn, then promote

  // The captured piece stays on its square until the attacker reaches it, then fades away.
  let ghost = null;
  if (captured) {
    const square = move.enPassant ? move.to + (colorOf(piece) === 'w' ? 8 : -8) : move.to;
    ghost = pieceUnit(captured, square);
    ghost.style.pointerEvents = 'none';
    placeByDepth(layer, ghost, Number(ghost.dataset.depth) - .01, []);
  }

  const moving = tracks.map((track) => track.unit);
  for (const track of tracks) { track.start = displayed(track.from); track.end = displayed(track.to); }
  const distance = Math.max(...tracks.map(({ start, end }) => Math.hypot(end[0] - start[0], end[1] - start[1])));
  const duration = Math.min(520, 200 + distance * 55);
  const began = performance.now();
  animationEnds = Date.now() + duration;
  const ease = (t) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

  function frame(now) {
    const t = Math.min(1, (now - began) / duration), e = ease(t);
    for (const { unit, start, end, hop } of tracks) {
      const row = start[0] + (end[0] - start[0]) * e, col = start[1] + (end[1] - start[1]) * e;
      const [x, y] = point(row, col), [tx, ty] = point(...end);
      unit.setAttribute('transform', `translate(${x - tx} ${y - ty})`);
      // Knights jump: lift the artwork, leave the shadow on the board.
      if (hop) unit.querySelector('use').setAttribute('transform', `translate(0 ${-Math.sin(Math.PI * e) * 34})`);
      placeByDepth(layer, unit, row + col, moving);
    }
    if (ghost) ghost.style.opacity = String(Math.max(0, 1 - Math.max(0, e - .6) / .4));
    if (t < 1) { animationFrame = requestAnimationFrame(frame); return; }
    for (const { unit } of tracks) { unit.removeAttribute('transform'); unit.querySelector('use').removeAttribute('transform'); }
    image.setAttribute('href', finalHref);
    ghost?.remove();
  }
  animationFrame = requestAnimationFrame(frame);
}

function keyboard(event, square) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    selectSquare(square);
    return;
  }
  if (event.key === 'Escape') { selected = null; renderBoard(); return; }
  const offsets = { ArrowUp: [-1,0], ArrowDown: [1,0], ArrowLeft: [0,-1], ArrowRight: [0,1] };
  const offset = offsets[event.key];
  if (!offset) return;
  event.preventDefault();
  const displayed = flipped ? 63 - square : square;
  const row = Math.floor(displayed / 8) + offset[0], col = displayed % 8 + offset[1];
  if (row < 0 || row > 7 || col < 0 || col > 7) return;
  focused = shownSquare(row, col);
  board.querySelectorAll('.square').forEach((el) => el.setAttribute('tabindex', Number(el.dataset.square) === focused ? '0' : '-1'));
  board.querySelector(`[data-square="${focused}"]`).focus({ preventScroll: true });
}

function selectSquare(square) {
  if (thinking || state.turn !== human || outcome(state, keys, moves).over || $('promotion').open) return;
  const candidates = moves.filter((m) => m.from === selected && m.to === square);
  if (candidates.length) {
    if (candidates[0].promotion) {
      promotionMoves = candidates;
      $('promotion-options').replaceChildren();
      for (const move of candidates) {
        const button = document.createElement('button');
        button.type = 'button';
        button.append(smallPiece(human === 'w' ? move.promotion.toUpperCase() : move.promotion), names[move.promotion]);
        button.addEventListener('click', () => { $('promotion').close(); promotionMoves = []; play(move); });
        $('promotion-options').append(button);
      }
      $('promotion').showModal();
    } else play(candidates[0]);
    return;
  }
  selected = square === selected ? null : colorOf(state.board[square]) === human ? square : null;
  renderBoard();
}

function play(move) {
  snapshots.push(state);
  const captured = state.board[move.to] || (move.enPassant ? (state.turn === 'w' ? 'p' : 'P') : null);
  const piece = state.board[move.from];
  records.push({ move, text: notation(state, move, moves), color: state.turn, captured });
  state = applyMove(state, move);
  keys.push(positionKey(state));
  selected = null;
  moves = legalMoves(state);
  render({ move, captured, piece });
  startComputer();
}

function cancelComputer() {
  generation++;
  worker?.terminate();
  worker = null;
  clearTimeout(aiTimer);
  thinking = false;
}
function startComputer() {
  if (state.turn === human || outcome(state, keys, moves).over) return;
  cancelComputer();
  thinking = true;
  renderStatus();
  const ticket = generation;
  const started = Date.now();
  function finish(data) {
    if (ticket !== generation) return;
    worker?.terminate();
    worker = null;
    // Fall back to a legal move if worker support is unavailable.
    const move = !data.error && moves.find((m) => m.from === data.move?.from && m.to === data.move?.to && m.promotion === data.move?.promotion) || moves[Math.floor(Math.random() * moves.length)];
    aiTimer = setTimeout(() => {
      if (ticket !== generation) return;
      thinking = false;
      if (move) play(move);
      if (data.error) $('status-detail').textContent = 'The search engine was unavailable, so the computer made a random legal move.';
    }, Math.max(0, 400 - (Date.now() - started), animationEnds - Date.now() + 60)); // let the last move land first
  }
  try {
    worker = new Worker('./ai-worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => finish(data);
    worker.onerror = (event) => { event.preventDefault(); finish({ error: 'Worker unavailable' }); };
    worker.postMessage({ state, difficulty: $('difficulty').value, history: keys });
  } catch (error) { finish({ error: error.message }); }
}

function renderStatus() {
  const result = outcome(state, keys, moves);
  document.body.classList.toggle('thinking', thinking);
  let title = thinking ? 'Considering…' : 'Your move.';
  let detail = thinking ? 'A moment to find a little possibility in the position.' : selected === null ? 'Select a piece. The highlighted squares show your options.' : 'Choose a highlighted square to make your move.';
  if (!records.length && human === 'w') detail = 'You’re playing white. Open with a little ambition.';
  if (result.reason === 'Check') {
    title = thinking ? 'Computer in check.' : 'You’re in check.';
    detail = thinking ? 'The engine is looking for a way out.' : 'Protect your king: move, block, or capture the attacker.';
  }
  if (result.over) {
    title = result.winner ? (result.winner === human ? 'Beautifully played.' : 'A lesson in strategy.') : 'An even finish.';
    detail = `${result.reason}. ${result.winner ? (result.winner === human ? 'You win!' : 'The computer wins.') : 'The game is a draw.'} Start a new game for another perspective.`;
  }
  $('status').textContent = title;
  $('status-detail').textContent = detail;
  $('move-number').textContent = `MOVE ${String(state.fullmove).padStart(2, '0')}`;
  $('turn-color').textContent = result.over ? 'GAME COMPLETE' : `${state.turn === 'w' ? 'WHITE' : 'BLACK'} TO PLAY`;
  $('thinking').textContent = thinking ? 'THINKING…' : result.over ? 'FINISHED' : 'READY';
  $('thinking').classList.toggle('active', thinking);
  $('human-tag').textContent = result.over ? 'FINISHED' : state.turn === human ? 'YOUR TURN' : 'WAITING';
  $('human-tag').classList.toggle('active', !result.over && state.turn === human);
  $('undo').disabled = !records.some((r) => r.color === human);
}

function renderHistory() {
  const list = $('move-list');
  list.replaceChildren();
  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-history';
    empty.textContent = 'Every good game starts with one small move.';
    list.append(empty);
  }
  for (let i = 0; i < records.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const number = document.createElement('span');
    number.textContent = String(i / 2 + 1).padStart(2, '0');
    row.append(number);
    for (const index of [i, i + 1]) {
      const span = document.createElement('span');
      const target = rewindPoint(index);
      if (!records[index]) span.textContent = '—';
      else if (target === null) span.textContent = records[index].text;
      else {
        // Clicking a move rewinds to the moment it is your turn at that point in the game.
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-move';
        button.textContent = records[index].text;
        button.title = records[index].color === human ? 'Take back this move and everything after it' : 'Go back to just after this move';
        button.addEventListener('click', () => rewindTo(target));
        span.append(button);
      }
      row.append(span);
    }
    list.append(row);
  }
  list.scrollTop = list.scrollHeight;
  $('human-captures').replaceChildren();
  $('computer-captures').replaceChildren();
  for (const record of records) {
    if (record.captured) $(record.color === human ? 'human-captures' : 'computer-captures').append(smallPiece(record.captured));
  }
}
function render(animation) { renderBoard(animation); renderStatus(); renderHistory(); }
function newGame() {
  cancelComputer();
  $('promotion').close();
  $('restart').close();
  human = $('side').value;
  flipped = human === 'b';
  state = fromFen();
  moves = legalMoves(state);
  keys = [positionKey(state)];
  records = []; snapshots = []; promotionMoves = []; selected = null;
  focused = squareIndex(human === 'w' ? 'e2' : 'e7');
  $('human-label').textContent = human === 'w' ? 'White pieces · you move first' : 'Black pieces · the computer opens';
  $('computer-label').textContent = `Computer · ${human === 'w' ? 'black' : 'white'} pieces`;
  render();
  startComputer();
}

$('flip').addEventListener('click', () => { flipped = !flipped; renderBoard(); });
$('new-game').addEventListener('click', () => {
  if (records.length && !outcome(state, keys, moves).over) $('restart').showModal();
  else newGame();
});
$('cancel-restart').addEventListener('click', () => $('restart').close());
$('confirm-restart').addEventListener('click', newGame);
$('difficulty').addEventListener('change', () => { if (thinking) startComputer(); });
$('promotion').addEventListener('cancel', () => { promotionMoves = []; selected = null; renderBoard(); });
// Where clicking history entry `index` takes you: the number of moves to keep.
// Your own move: back to just before you played it. A computer move: back to just after it.
// Returns null when that would change nothing (or leave the computer to move).
function rewindPoint(index) {
  const record = records[index];
  if (!record) return null;
  const keep = record.color === human ? index : index + 1;
  return keep < records.length && keep <= lastHumanMove() ? keep : null;
}
function lastHumanMove() {
  let index = records.length - 1;
  while (index >= 0 && records[index].color !== human) index--;
  return index;
}
// Restore the game to how it was after the first `keep` moves (snapshots[i] is the position before move i).
function rewindTo(keep) {
  if (keep < 0 || keep >= records.length) return;
  cancelComputer();
  $('promotion').close();
  state = snapshots[keep];
  snapshots.length = keep;
  records.length = keep;
  keys.length = keep + 1;
  moves = legalMoves(state);
  selected = null; promotionMoves = [];
  render();
}
function undo() { const index = lastHumanMove(); if (index >= 0) rewindTo(index); }
$('undo').addEventListener('click', undo);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !event.target.closest?.('input, select, textarea')) {
    event.preventDefault();
    undo();
  }
});
$('download').addEventListener('click', () => {
  const result = outcome(state, keys, moves);
  const score = !result.over ? '*' : result.winner === 'w' ? '1-0' : result.winner === 'b' ? '0-1' : '1/2-1/2';
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
  let pgn = `[Event "Oblique local game"]\n[Site "Local"]\n[Date "${date}"]\n[Round "-"]\n[White "${human === 'w' ? 'You' : 'Oblique engine'}"]\n[Black "${human === 'b' ? 'You' : 'Oblique engine'}"]\n[Result "${score}"]\n\n`;
  for (let i = 0; i < records.length; i++) pgn += `${i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ` : ''}${records[i].text} `;
  pgn += score + '\n';
  const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'oblique-game.pgn';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
newGame();
