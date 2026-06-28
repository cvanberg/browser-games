// Kahuna LCS trainer — run with: node train.js
//
// Runs bot-vs-bot self-play games, applies bucket brigade credit assignment,
// and periodically runs a GA step to evolve better classifiers.
// Saves the final population to classifiers.json.

'use strict';

const fs = require('fs');
const { createGame } = require('./engine');
const {
  createPopulation, choosePlayMove, chooseDrawMove,
  bucketBrigade, applyReward, evolve,
  REWARD, PENALTY,
} = require('./lcs');

// ---- Config ----
const POP_SIZE    = 200;   // classifiers per player
const TOTAL_GAMES = 10000;
const GA_EVERY    = 50;    // run GA step every N games
const REPORT_EVERY = 500;
const EPSILON_START = 0.15; // exploration rate at start
const EPSILON_END   = 0.03; // exploration rate at end
const SAVE_FILE   = 'classifiers.json';


// ---- Run one full game between two LCS populations ----
// Returns winner (0, 1, or -1 for tie)

function runGame(pop0, pop1, epsilon) {
  const game = createGame();
  game.init();

  // Track the last classifiers that fired for each player (for bucket brigade)
  const lastClfs = [null, null];

  let safetyValve = 0;

  while (!game.isOver()) {
    if (++safetyValve > 2000) break; // shouldn't happen, but prevents infinite loops

    const p = game.curP;
    const pop = p === 0 ? pop0 : pop1;

    if (game.subphase === 'play') {
      const legal = game.legalMoves().filter(m => m.type === 'place' || m.type === 'remove');

      if (legal.length === 0) {
        // No play moves — go straight to draw
        game.subphase = 'draw';
        continue;
      }

      const result = choosePlayMove(game, pop, epsilon);
      if (!result) { game.subphase = 'draw'; continue; }

      const { move, matchedClfs } = result;

      // Bucket brigade: current classifiers pay the previous ones
      if (lastClfs[p] && matchedClfs.length > 0) {
        bucketBrigade(lastClfs[p], matchedClfs);
      }
      lastClfs[p] = matchedClfs;

      game.applyMove(move);

    } else if (game.subphase === 'draw') {
      const move = chooseDrawMove(game);
      if (!move) break;
      game.applyMove(move);
    }
  }

  const winner = game.winner();

  // End-of-game reward signal
  [0, 1].forEach(p => {
    if (lastClfs[p] && lastClfs[p].length > 0) {
      if (winner === p)       applyReward(lastClfs[p],  REWARD);
      else if (winner === -1) applyReward(lastClfs[p],  REWARD * 0.1);
      else                    applyReward(lastClfs[p], -PENALTY);
    }
  });

  return winner;
}


// ---- Training loop ----

function train() {
  const pop0 = createPopulation(POP_SIZE);
  const pop1 = createPopulation(POP_SIZE);

  const wins = [0, 0, 0]; // [p0 wins, p1 wins, ties]

  console.log(`Training ${TOTAL_GAMES} games, population ${POP_SIZE} each side…\n`);

  for (let g = 0; g < TOTAL_GAMES; g++) {
    const t = g / TOTAL_GAMES;
    const epsilon = EPSILON_START + t * (EPSILON_END - EPSILON_START);

    const winner = runGame(pop0, pop1, epsilon);
    if (winner === 0) wins[0]++;
    else if (winner === 1) wins[1]++;
    else wins[2]++;

    if ((g + 1) % GA_EVERY === 0) {
      evolve(pop0);
      evolve(pop1);
    }

    if ((g + 1) % REPORT_EVERY === 0) {
      const total = wins[0] + wins[1] + wins[2];
      console.log(
        `Game ${g + 1}/${TOTAL_GAMES}  ` +
        `P0 wins: ${wins[0]} (${(100*wins[0]/total).toFixed(1)}%)  ` +
        `P1 wins: ${wins[1]} (${(100*wins[1]/total).toFixed(1)}%)  ` +
        `Ties: ${wins[2]}  ` +
        `ε=${epsilon.toFixed(3)}`
      );
      wins[0] = wins[1] = wins[2] = 0; // reset window
    }
  }

  // Merge both populations, keep the strongest classifiers overall
  const merged = [...pop0, ...pop1];
  merged.sort((a, b) => b.strength - a.strength);
  const best = merged.slice(0, POP_SIZE);

  fs.writeFileSync(SAVE_FILE, JSON.stringify(best, null, 2));
  console.log(`\nDone. Best ${POP_SIZE} classifiers saved to ${SAVE_FILE}`);

  // Print top 10 classifiers
  console.log('\nTop 10 classifiers by strength:');
  best.slice(0, 10).forEach((c, i) => {
    console.log(`  ${i+1}. strength=${c.strength.toFixed(3)}  condition=${c.condition}`);
  });
}

train();
