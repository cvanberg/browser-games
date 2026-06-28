// Kahuna LCS trainer — run with: node train.js
//
// Continues from classifiers.json if it exists, otherwise starts fresh.
// Saves snapshots every SNAPSHOT_EVERY games → bots/bot_NNNNN.json
// These snapshots become the named opponents in the browser game.

'use strict';

const fs = require('fs');
const { createGame } = require('./engine');
const {
  createPopulation, choosePlayMove, chooseDrawMove,
  bucketBrigade, applyReward, evolve,
  REWARD, PENALTY,
} = require('./lcs');

// ---- Config ----
const POP_SIZE      = 200;
const TOTAL_GAMES   = 20000;
const GA_EVERY      = 50;
const REPORT_EVERY  = 500;
const SNAPSHOT_EVERY = 4000;   // save a bot snapshot every N games
const EPSILON_START = 0.12;
const EPSILON_END   = 0.02;
const SAVE_FILE     = 'classifiers.json';
const SNAPSHOT_DIR  = 'bots';


// ---- Run one full game between two LCS populations ----

function runGame(pop0, pop1, epsilon) {
  const game = createGame();
  game.init();

  const lastClfs = [null, null];
  let safetyValve = 0;

  while (!game.isOver()) {
    if (++safetyValve > 2000) break;

    const p = game.curP;
    const pop = p === 0 ? pop0 : pop1;

    if (game.subphase === 'play') {
      const legal = game.legalMoves().filter(m => m.type === 'place' || m.type === 'remove');
      if (legal.length === 0) { game.subphase = 'draw'; continue; }

      const result = choosePlayMove(game, pop, epsilon);
      if (!result) { game.subphase = 'draw'; continue; }

      const { move, matchedClfs } = result;
      if (lastClfs[p] && matchedClfs.length > 0)
        bucketBrigade(lastClfs[p], matchedClfs);
      lastClfs[p] = matchedClfs;
      game.applyMove(move);

    } else if (game.subphase === 'draw') {
      const move = chooseDrawMove(game);
      if (!move) break;
      game.applyMove(move);
    }
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


// ---- Snapshot: merge both pops, keep best POP_SIZE ----

function saveSnapshot(pop0, pop1, gameCount) {
  const merged = [...pop0, ...pop1];
  merged.sort((a, b) => b.strength - a.strength);
  const best = merged.slice(0, POP_SIZE);
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR);
  const file = `${SNAPSHOT_DIR}/bot_${String(gameCount).padStart(5, '0')}.json`;
  fs.writeFileSync(file, JSON.stringify(best, null, 2));
  console.log(`  → snapshot saved: ${file}`);
  return best;
}


// ---- Training loop ----

function train() {
  // Load existing classifiers as seed if available
  let pop0, pop1;
  if (fs.existsSync(SAVE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    // Deep-copy so the two populations diverge independently
    pop0 = saved.map(c => ({ ...c }));
    pop1 = saved.map(c => ({ ...c }));
    // Pad to POP_SIZE if saved file is smaller
    while (pop0.length < POP_SIZE) { pop0.push(...createPopulation(1)); }
    while (pop1.length < POP_SIZE) { pop1.push(...createPopulation(1)); }
    console.log(`Loaded ${saved.length} classifiers from ${SAVE_FILE}, continuing…`);
  } else {
    pop0 = createPopulation(POP_SIZE);
    pop1 = createPopulation(POP_SIZE);
    console.log('No existing classifiers found, starting fresh.');
  }

  const wins = [0, 0, 0];
  console.log(`Training ${TOTAL_GAMES} games, population ${POP_SIZE} each side…\n`);

  for (let g = 0; g < TOTAL_GAMES; g++) {
    const t = g / TOTAL_GAMES;
    const epsilon = EPSILON_START + t * (EPSILON_END - EPSILON_START);

    const winner = runGame(pop0, pop1, epsilon);
    if (winner === 0) wins[0]++;
    else if (winner === 1) wins[1]++;
    else wins[2]++;

    if ((g + 1) % GA_EVERY === 0) { evolve(pop0); evolve(pop1); }

    if ((g + 1) % SNAPSHOT_EVERY === 0) {
      saveSnapshot(pop0, pop1, g + 1);
    }

    if ((g + 1) % REPORT_EVERY === 0) {
      const total = wins[0] + wins[1] + wins[2];
      console.log(
        `Game ${g + 1}/${TOTAL_GAMES}  ` +
        `P0: ${wins[0]} (${(100*wins[0]/total).toFixed(1)}%)  ` +
        `P1: ${wins[1]} (${(100*wins[1]/total).toFixed(1)}%)  ` +
        `Ties: ${wins[2]}  ε=${epsilon.toFixed(3)}`
      );
      wins[0] = wins[1] = wins[2] = 0;
    }
  }

  saveSnapshot(pop0, pop1, TOTAL_GAMES);

  // Also overwrite classifiers.json with the final best
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
