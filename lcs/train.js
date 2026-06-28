// Kahuna LCS trainer — run with: node train.js
//
// Continues from classifiers.json if it exists, otherwise starts fresh.
// Saves snapshots every SNAPSHOT_EVERY games → bots/bot_NNNNN.json

'use strict';

const fs = require('fs');
const path = require('path');
const { createGame, CONNS, MAJ } = require('./engine');
const {
  createPopulation, choosePlayMove, chooseDrawMove,
  bucketBrigade, applyReward, evolve,
  REWARD, PENALTY,
} = require('./lcs');

// ---- Config ----
const POP_SIZE       = 200;
const TOTAL_GAMES    = 100000;
const GA_EVERY       = 50;
const REPORT_EVERY   = 2000;
const SNAPSHOT_EVERY = 20000;
const EPSILON_START  = 0.12;
const EPSILON_END    = 0.02;
const SAVE_FILE      = 'classifiers.json';
const SNAPSHOT_DIR   = 'bots';


// ---- Multi-play helpers ----

// Would placing bridge ci for player p achieve majority on either endpoint?
function wouldCascade(game, ci, p) {
  for (const isl of CONNS[ci]) {
    let mine = 0;
    CONNS.forEach(([a, b], c2) => {
      if (a !== isl && b !== isl) return;
      if ((c2 === ci ? p : game.bridges[c2]) === p) mine++;
    });
    if (mine >= MAJ[isl]) return true;
  }
  return false;
}

// Would removing bridge ci cause opponent to lose an island they control?
function isDisruptiveRemoval(game, ci, p) {
  const opp = 1 - p;
  for (const isl of CONNS[ci]) {
    if (game.controlled[isl] !== opp) continue;
    let oppAfter = 0;
    CONNS.forEach(([a, b], c2) => {
      if (a !== isl && b !== isl) return;
      if (c2 !== ci && game.bridges[c2] === opp) oppAfter++;
    });
    if (oppAfter < MAJ[isl]) return true;
  }
  return false;
}

// After the first play, only continue for high-value moves (cascade or disruption).
function isWorthAnotherPlay(game, move) {
  if (move.type === 'place')  return wouldCascade(game, move.ci, game.curP);
  if (move.type === 'remove') return isDisruptiveRemoval(game, move.ci, game.curP);
  return false;
}


// ---- Run one full game ----

function runGame(pop0, pop1, epsilon) {
  const game = createGame();
  game.init();

  const lastClfs = [null, null];
  let safetyValve = 0;

  while (!game.isOver()) {
    if (++safetyValve > 5000) break;

    const p = game.curP;
    const pop = p === 0 ? pop0 : pop1;

    // ---- Play phase: loop until no more worthwhile moves ----
    let firstPlay = true;
    while (true) {
      const playMoves = game.playMoves();
      if (playMoves.length === 0) break;

      // After first play, only continue if the next best move is high-value
      if (!firstPlay) {
        // Quick peek: is the best available move worth playing?
        const peek = choosePlayMove(game, pop, 0); // no exploration for peek
        if (!peek || !isWorthAnotherPlay(game, peek.move)) break;
      }

      const result = choosePlayMove(game, pop, epsilon);
      if (!result) break;

      const { move, matchedClfs } = result;

      if (lastClfs[p] && matchedClfs.length > 0)
        bucketBrigade(lastClfs[p], matchedClfs);
      lastClfs[p] = matchedClfs;

      game.applyMove(move);
      firstPlay = false;

      if (game.isOver()) break;
    }

    if (game.isOver()) break;

    // ---- Draw phase ----
    const drawMoves = game.drawMoves();
    if (drawMoves.length === 0) break;
    const draw = chooseDrawMove(game);
    if (!draw) break;
    game.applyMove(draw);
  }

  const winner = game.winner();
  [0, 1].forEach(p => {
    if (lastClfs[p] && lastClfs[p].length > 0) {
      if (winner === p)       applyReward(lastClfs[p],  REWARD);
      else if (winner === -1) applyReward(lastClfs[p],  REWARD * 0.1);
      else                    applyReward(lastClfs[p], -PENALTY);
    }
  });

  return winner;
}


// ---- Snapshot ----

function saveSnapshot(pop0, pop1, gameCount) {
  const merged = [...pop0, ...pop1];
  merged.sort((a, b) => b.strength - a.strength);
  const best = merged.slice(0, POP_SIZE);
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR);
  const file = path.join(SNAPSHOT_DIR, `bot_${String(gameCount).padStart(6, '0')}.json`);
  fs.writeFileSync(file, JSON.stringify(best, null, 2));
  console.log(`  → snapshot saved: ${file}`);
  return best;
}


// ---- Training loop ----

function train() {
  let pop0, pop1;
  if (fs.existsSync(SAVE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    pop0 = saved.map(c => ({ ...c }));
    pop1 = saved.map(c => ({ ...c }));
    while (pop0.length < POP_SIZE) pop0.push(...createPopulation(1));
    while (pop1.length < POP_SIZE) pop1.push(...createPopulation(1));
    console.log(`Loaded ${saved.length} classifiers from ${SAVE_FILE}, continuing…`);
  } else {
    pop0 = createPopulation(POP_SIZE);
    pop1 = createPopulation(POP_SIZE);
    console.log('Starting fresh.');
  }

  console.log(`Training ${TOTAL_GAMES.toLocaleString()} games (multi-play rules), pop ${POP_SIZE} each side…\n`);

  const wins = [0, 0, 0];
  const t0 = Date.now();

  for (let g = 0; g < TOTAL_GAMES; g++) {
    const t = g / TOTAL_GAMES;
    const epsilon = EPSILON_START + t * (EPSILON_END - EPSILON_START);

    const winner = runGame(pop0, pop1, epsilon);
    if (winner === 0) wins[0]++;
    else if (winner === 1) wins[1]++;
    else wins[2]++;

    if ((g + 1) % GA_EVERY === 0) { evolve(pop0); evolve(pop1); }

    if ((g + 1) % SNAPSHOT_EVERY === 0)
      saveSnapshot(pop0, pop1, g + 1);

    if ((g + 1) % REPORT_EVERY === 0) {
      const total = wins[0] + wins[1] + wins[2];
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const gps = ((g + 1) / (Date.now() - t0) * 1000).toFixed(0);
      console.log(
        `Game ${(g+1).toLocaleString()}/${TOTAL_GAMES.toLocaleString()}  ` +
        `P0: ${wins[0]} (${(100*wins[0]/total).toFixed(1)}%)  ` +
        `P1: ${wins[1]} (${(100*wins[1]/total).toFixed(1)}%)  ` +
        `Ties: ${wins[2]}  ε=${epsilon.toFixed(3)}  ${gps}g/s  ${elapsed}s`
      );
      wins[0] = wins[1] = wins[2] = 0;
    }
  }

  saveSnapshot(pop0, pop1, TOTAL_GAMES);

  const merged = [...pop0, ...pop1];
  merged.sort((a, b) => b.strength - a.strength);
  const best = merged.slice(0, POP_SIZE);
  fs.writeFileSync(SAVE_FILE, JSON.stringify(best, null, 2));
  console.log(`\nFinal best ${POP_SIZE} classifiers saved to ${SAVE_FILE}`);

  console.log('\nTop 10 classifiers by strength:');
  best.slice(0, 10).forEach((c, i) =>
    console.log(`  ${i+1}. strength=${c.strength.toFixed(3)}  ${c.condition}`)
  );
}

train();
