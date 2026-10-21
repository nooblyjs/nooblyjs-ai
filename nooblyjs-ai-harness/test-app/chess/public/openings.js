// The opening book: well-known main lines, each move with a short note on its purpose.
// Moves are written in standard algebraic notation (SAN), the same text the move history shows.
// Shared by the browser and the Node tests.
import { legalMoves, notation } from './chess.js';

const line = (text, notes) => text.split(' ').map((san, index) => ({ san, note: notes[index] }));

export const OPENINGS = [
  {
    id: 'italian', name: 'Italian Game (Giuoco Piano)', eco: 'C53', group: '1.e4 e5 — Open Games',
    summary: 'One of the oldest openings. Both sides develop quickly, aim bishops at the weak f-pawns, and castle early. A calm, classical way to learn the basics.',
    plans: {
      w: 'Prepare d4 with c3 to build a big pawn centre; keep the bishop on the a2–g8 diagonal pointing at f7.',
      b: 'Mirror White: develop, castle, and hit back in the centre with ...d5 or ...d6 when ready.',
    },
    moves: line('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O', [
      'Takes the centre and opens lines for the queen and the light-squared bishop.',
      'Black claims an equal share of the centre.',
      'Develops a knight and attacks the e5 pawn.',
      'Defends e5 while developing.',
      'The bishop eyes f7, the square only the king protects.',
      'Black copies the idea: the bishop eyes f2.',
      'Prepares d4 to build a full pawn centre.',
      'Develops and counter-attacks the e4 pawn.',
      'The quiet "Giuoco Pianissimo": e4 is solidly protected, no early fight.',
      'Black also protects e5 and opens a path for the c8 bishop.',
      'King to safety; the rook comes towards the centre.',
      'Black castles too. Both sides now manoeuvre slowly.',
    ]),
  },
  {
    id: 'ruy-lopez', name: 'Ruy Lopez (Spanish Game)', eco: 'C84', group: '1.e4 e5 — Open Games',
    summary: 'Named after a 16th-century Spanish priest, it is the most deeply studied open game. White pressures the knight that defends e5 and plays for a long, slow edge.',
    plans: {
      w: 'Castle, play Re1 and c3, then d4. The bishop retreats to b3 and keeps aiming at f7.',
      b: 'Kick the bishop with ...a6 and ...b5, develop solidly with ...Be7 and ...d6, and castle.',
    },
    moves: line('e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O', [
      'Takes the centre and frees the bishop and queen.',
      'Black takes an equal share of the centre.',
      'Develops and attacks e5.',
      'Defends e5.',
      'Pins nothing yet, but pressures the knight that defends e5.',
      'The Morphy Defence: asks the bishop what it wants to do.',
      'Keeps the pressure on the knight rather than trading it.',
      'Develops and attacks e4.',
      'White castles, trusting that e4 is safe for now (tactics favour White if Black grabs it).',
      'Black prepares to castle.',
      'The rook protects e4 and supports a later d4.',
      'Gains space and pushes the bishop away.',
      'The bishop retreats but stays on the diagonal aiming at f7.',
      'Solidly protects e5 and opens the c8 bishop.',
      'Prepares d4 and gives the bishop a retreat square on c2.',
      'Black castles: the "Closed Ruy Lopez", a long strategic battle.',
    ]),
  },
  {
    id: 'scotch', name: 'Scotch Game', eco: 'C45', group: '1.e4 e5 — Open Games',
    summary: 'White opens the centre at once with d4. Play is direct and open, so it is a good way to practise active piece play.',
    plans: {
      w: 'Use the open centre and a space advantage from e5; aim pieces at Black\'s weakened queenside pawns.',
      b: 'Develop fast, hit back with ...d5 or ...d6, and use the half-open b-file after ...bxc6.',
    },
    moves: line('e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4', [
      'Takes the centre.',
      'Black claims an equal share.',
      'Develops and attacks e5.',
      'Defends e5.',
      'Strikes in the centre straight away.',
      'Black takes: holding e5 is not possible for long.',
      'The knight recaptures on a strong central square.',
      'Develops and attacks e4 (the Mieses line).',
      'Trades knights to double Black\'s pawns.',
      'Black recaptures towards the centre; the b-file opens.',
      'Kicks the f6 knight and gains space.',
      'Pins the e5 pawn to the king\'s file and attacks it.',
      'Defends e5 and unpins.',
      'The knight finds a fine central square.',
      'Drives the knight away and grabs more space.',
    ]),
  },
  {
    id: 'kings-gambit', name: 'King\'s Gambit', eco: 'C39', group: '1.e4 e5 — Open Games',
    summary: 'A romantic 19th-century favourite. White offers a pawn to open the f-file and attack. Sharp and risky for both sides.',
    plans: {
      w: 'Win the centre with d4, open the f-file, and attack f7 before Black consolidates.',
      b: 'Keep the extra pawn with ...g5, or give it back at the right moment to catch up in development.',
    },
    moves: line('e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6', [
      'Takes the centre.',
      'Black claims an equal share.',
      'The gambit: offers a pawn to deflect e5 and open the f-file.',
      'Black accepts the pawn.',
      'Develops and stops ...Qh4+.',
      'Black protects the extra pawn on f4.',
      'Undermines the g5 pawn at once.',
      'Black pushes past, attacking the knight.',
      'The Kieseritzky Gambit: the knight jumps to a central square, eyeing f7 and g4.',
      'Develops and counter-attacks e4.',
    ]),
  },
  {
    id: 'sicilian', name: 'Sicilian Defence (Najdorf)', eco: 'B90', group: '1.e4 — Semi-open Games',
    summary: 'The most popular reply to 1.e4. Black fights for the centre from the side, creating unbalanced positions where both players can play to win.',
    plans: {
      w: 'Use your lead in development and space; attack on the kingside, often with f4 or f3, g4.',
      b: 'Use the half-open c-file and the extra central pawn; counter-attack on the queenside with ...b5.',
    },
    moves: line('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', [
      'Takes the centre.',
      'Controls d4 from the side and avoids a symmetrical game.',
      'Develops and prepares d4.',
      'Protects e5 and opens the c8 bishop.',
      'Opens the centre.',
      'Trades a side pawn for White\'s central d-pawn.',
      'The knight recaptures on a central square.',
      'Develops and attacks e4.',
      'Protects e4 while developing.',
      'The Najdorf: stops Nb5 and Bb5, and prepares ...e5 or ...b5.',
    ]),
  },
  {
    id: 'french', name: 'French Defence (Advance)', eco: 'C02', group: '1.e4 — Semi-open Games',
    summary: 'Black builds a solid pawn chain and challenges the centre later. White grabs space; Black attacks the base of White\'s pawn chain.',
    plans: {
      w: 'Hold the d4–e5 chain with c3 and Nf3, and use the extra kingside space.',
      b: 'Pressure d4 with ...c5, ...Nc6 and ...Qb6; the light-squared bishop is Black\'s problem piece.',
    },
    moves: line('e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6', [
      'Takes the centre.',
      'Prepares ...d5 behind a solid wall.',
      'A second central pawn.',
      'Challenges e4 at once.',
      'The Advance Variation: grabs space and locks the centre.',
      'Strikes at d4, the base of White\'s chain.',
      'Supports d4 with another pawn.',
      'More pressure on d4.',
      'Defends d4 and develops.',
      'A third attacker on d4, and it also eyes b2.',
    ]),
  },
  {
    id: 'caro-kann', name: 'Caro-Kann Defence (Classical)', eco: 'B18', group: '1.e4 — Semi-open Games',
    summary: 'A rock-solid defence. Black supports ...d5 with the c-pawn so the light-squared bishop can get out before ...e6.',
    plans: {
      w: 'Use your space; gain time by chasing the bishop with h4 and Nf3–e5.',
      b: 'Develop the bishop first, then ...e6, ...Nd7 and ...Ngf6; a sound, solid position.',
    },
    moves: line('e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7', [
      'Takes the centre.',
      'Prepares ...d5 with pawn support.',
      'A second central pawn.',
      'Challenges e4.',
      'Defends e4 by developing.',
      'Black takes, giving up the centre for easy development.',
      'The knight recaptures on a central square.',
      'The bishop gets out before ...e6 locks it in, and hits the knight.',
      'Gains time by attacking the bishop.',
      'The bishop retreats but stays on its good diagonal.',
      'Threatens h5 to trap the bishop.',
      'Gives the bishop a retreat square on h7.',
      'Develops, eyeing e5.',
      'Develops and stops Ne5.',
    ]),
  },
  {
    id: 'scandinavian', name: 'Scandinavian Defence', eco: 'B01', group: '1.e4 — Semi-open Games',
    summary: 'Black challenges e4 on move one. Simple to learn: the queen comes out early but finds a safe home on a5.',
    plans: {
      w: 'Gain time by attacking the queen, and use your lead in development.',
      b: 'Tuck the queen on a5, play ...c6, ...Bf5 and ...e6 for a solid structure.',
    },
    moves: line('e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6', [
      'Takes the centre.',
      'Strikes at e4 straight away.',
      'Takes the pawn.',
      'Black recaptures with the queen.',
      'Develops with gain of time by attacking the queen.',
      'The queen steps aside to a5, pinning the knight.',
      'Takes the centre while the queen is busy.',
      'Develops the knight towards the centre and guards d5.',
      'Develops the knight and gets ready to castle.',
      'Gives the queen a retreat square and protects d5.',
    ]),
  },
  {
    id: 'qgd', name: 'Queen\'s Gambit Declined', eco: 'D53', group: '1.d4 d5 — Closed Games',
    summary: 'White offers a side pawn to pull Black\'s d-pawn from the centre. Black declines and holds d5. A classical, strategic opening.',
    plans: {
      w: 'Pressure d5 with pieces, pin the f6 knight, and later push in the centre or on the queenside.',
      b: 'Hold d5 firmly, castle, then free the position with ...c5 or ...e5.',
    },
    moves: line('d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3', [
      'Takes the centre and frees the c1 bishop.',
      'Black matches in the centre.',
      'The gambit: offers a side pawn for Black\'s central d-pawn.',
      'Declines: supports d5 with a pawn.',
      'Adds pressure on d5.',
      'Defends d5.',
      'Pins the knight that defends d5.',
      'Breaks the pin.',
      'Opens the f1 bishop and supports d4.',
      'King to safety.',
      'Develops; both sides have a sound position.',
    ]),
  },
  {
    id: 'qga', name: 'Queen\'s Gambit Accepted', eco: 'D27', group: '1.d4 d5 — Closed Games',
    summary: 'Black takes the c4 pawn, not to keep it but to develop freely. White regains it and gets a nice centre.',
    plans: {
      w: 'Win back the pawn with Bxc4 and use the free centre, often pushing e4.',
      b: 'Return the pawn calmly, then challenge the centre with ...c5 and expand with ...a6, ...b5.',
    },
    moves: line('d4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6', [
      'Takes the centre.',
      'Black matches.',
      'Offers the c-pawn.',
      'Accepts, giving up the centre for a while.',
      'Develops and stops ...e5.',
      'Develops the knight and controls e4.',
      'Opens the bishop to win back c4.',
      'Opens Black\'s bishop too.',
      'White has the pawn back.',
      'Strikes at d4.',
      'King to safety.',
      'Prepares ...b5 to gain space with tempo.',
    ]),
  },
  {
    id: 'slav', name: 'Slav Defence', eco: 'D15', group: '1.d4 d5 — Closed Games',
    summary: 'Like the Caro-Kann for 1.d4: Black supports d5 with the c-pawn so the light-squared bishop stays free.',
    plans: {
      w: 'Win back c4 and use the centre; a4 stops Black holding the pawn with ...b5.',
      b: 'Take on c4 at a good moment and develop the bishop to f5 or g4.',
    },
    moves: line('d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5', [
      'Takes the centre.',
      'Black matches.',
      'The Queen\'s Gambit.',
      'Supports d5 with the c-pawn, keeping the c8 bishop free.',
      'Develops the knight and guards d4 and e5.',
      'Develops the knight and guards d5 and e4.',
      'Adds pressure on d5.',
      'Now Black takes, hoping to hold the pawn with ...b5.',
      'Stops ...b5, so White will win back c4.',
      'The bishop gets out to an active square.',
    ]),
  },
  {
    id: 'london', name: 'London System', eco: 'D02', group: '1.d4 — Systems and Indian Defences',
    summary: 'A system rather than a sharp line: White sets up the same solid formation against almost anything. Popular with beginners and club players.',
    plans: {
      w: 'Bishop to f4 early, then e3, c3, Nbd2, Bd3 and castle. Later attack with Ne5 or a kingside push.',
      b: 'Challenge with ...c5 and ...Nc6; trade off the f4 bishop with ...Bd6 if allowed.',
    },
    moves: line('d4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3', [
      'Takes the centre.',
      'Black matches.',
      'The London bishop: out before e3 shuts it in.',
      'Develops the knight and controls e4.',
      'Supports d4 and opens the f1 bishop.',
      'Opens the f8 bishop.',
      'Develops the knight and controls e5.',
      'Strikes at d4.',
      'Holds d4 with a pawn: the London "triangle" c3–d4–e3.',
      'More pressure on d4.',
      'Develops, keeping c3 free for the pawn.',
      'Offers to trade the London bishop.',
      'Keeps the bishop and avoids a pawn weakness.',
      'King to safety.',
      'The bishop aims at Black\'s king.',
    ]),
  },
  {
    id: 'kings-indian', name: 'King\'s Indian Defence', eco: 'E97', group: '1.d4 — Systems and Indian Defences',
    summary: 'A hypermodern defence: Black lets White build a big centre, then attacks it. Leads to sharp races with attacks on opposite wings.',
    plans: {
      w: 'Use the space: after d5, push on the queenside with c5 and b4.',
      b: 'After the centre locks, play ...Ne8 or ...Nd7, then ...f5 and storm White\'s king.',
    },
    moves: line('d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7', [
      'Takes the centre.',
      'Develops and stops e4 for now.',
      'Gains queenside space.',
      'Prepares a fianchetto: the bishop on g7.',
      'Supports e4.',
      'The bishop aims down the long diagonal at the centre.',
      'White builds a big pawn centre.',
      'Stops e5 and prepares ...e5.',
      'Develops the knight and supports d4.',
      'King to safety behind the fianchettoed bishop.',
      'Prepares to castle.',
      'Black strikes at the centre.',
      'King to safety.',
      'More pressure on d4.',
      'Locks the centre and kicks the knight.',
      'The knight heads to the kingside to support ...f5.',
    ]),
  },
  {
    id: 'nimzo-indian', name: 'Nimzo-Indian Defence', eco: 'E53', group: '1.d4 — Systems and Indian Defences',
    summary: 'Black pins the c3 knight to stop e4, and may give the bishop for the knight to double White\'s pawns. Respected at every level.',
    plans: {
      w: 'Develop calmly, castle, and later use the bishop pair if Black trades on c3.',
      b: 'Control e4, strike with ...d5 and ...c5, and take on c3 when it damages White\'s pawns.',
    },
    moves: line('d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O', [
      'Takes the centre.',
      'Develops and controls e4.',
      'Gains queenside space.',
      'Opens the f8 bishop.',
      'Prepares e4.',
      'The Nimzo pin: the c3 knight can no longer guard e4.',
      'The Rubinstein: solid, opens the f1 bishop.',
      'King to safety.',
      'Develops, eyeing e4 and h7.',
      'Takes a stake in the centre.',
      'Develops the knight and guards d4 and e5.',
      'Strikes at d4.',
      'King to safety. A rich, balanced middlegame.',
    ]),
  },
  {
    id: 'english', name: 'English Opening', eco: 'A29', group: 'Flank Openings',
    summary: 'White starts on the side with 1.c4 and controls the centre from a distance. Often like a reversed Sicilian with an extra move.',
    plans: {
      w: 'Fianchetto the bishop on g2 to pressure the long diagonal; play on the queenside.',
      b: 'Take the centre with ...e5 and ...d5; develop naturally.',
    },
    moves: line('c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nb6 Nf3 Nc6', [
      'Controls d5 from the side.',
      'Black takes the centre.',
      'Develops and adds control of d5.',
      'Develops the knight and attacks the centre.',
      'Prepares the fianchetto.',
      'Black takes even more centre.',
      'Trades a side pawn for a central one.',
      'The knight recaptures.',
      'The bishop pressures the long diagonal and the d5 knight.',
      'The knight steps back from the bishop.',
      'Develops and attacks e5.',
      'Defends e5.',
    ]),
  },
];

/** Looks up an opening by its id; returns undefined for "no opening". */
export function getOpening(id) {
  return OPENINGS.find((opening) => opening.id === id);
}

// Check (+) and mate (#) signs are not part of the move itself.
const bare = (san) => san.replace(/[+#!?]/g, '');

/** Finds the legal move in `state` written as `san` (e.g. "Nf3", "O-O"), or null. */
export function findMove(state, san) {
  const moves = legalMoves(state);
  return moves.find((move) => bare(notation(state, move, moves)) === bare(san)) ?? null;
}

/** How a game (its moves so far, in SAN) compares with an opening's main line. */
export function bookStatus(opening, played) {
  let matched = 0;
  while (matched < played.length && matched < opening.moves.length && bare(played[matched]) === bare(opening.moves[matched].san)) matched++;
  const left = matched < played.length && matched < opening.moves.length;
  const next = left || matched < played.length ? null : opening.moves[matched] ?? null;
  return { matched, left, next, complete: matched === opening.moves.length };
}

/** Names the opening a game is following: the line matching the most moves (at least 3), if exactly one does. */
export function identifyOpening(played) {
  let best = null, bestCount = 2, tie = false;
  for (const opening of OPENINGS) {
    const { matched, left } = bookStatus(opening, played);
    if (left && matched < 3) continue;
    if (matched > bestCount) { best = opening; bestCount = matched; tie = false; }
    else if (matched === bestCount && best) tie = true;
  }
  return tie ? null : best;
}
