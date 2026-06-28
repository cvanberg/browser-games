// Kahuna Learning Classifier System
//
// Each classifier is a condition→strength rule.
// Conditions are 20-character strings over {0,1,#}, where # is a wildcard.
//
// Feature encoding (20 bits) for a candidate play-move:
//
//  0     move type           0=place, 1=remove
//  1-2   my progress on A    00=none 01=partial 10=one-away 11=achieves-majority
//  3-4   opp progress on A   00=none 01=partial 10=one-away 11=already-majority
//  5     opp controls A      1 if yes (we could disrupt)
//  6     cascade on A        1 if placing here would remove opp bridges on A
//  7-8   my progress on B
//  9-10  opp progress on B
//  11    opp controls B
//  12    cascade on B
//  13-14 game phase          01=1 10=2 11=3
//  15    I'm behind on score
//  16    I'm ahead on score
//  17    A is a hub          1 if DEG[A] >= 4
//  18    B is a hub          1 if DEG[B] >= 4
//  19    hand is thin        1 if I have <= 2 cards (after spending)

'use strict';

const { CONNS, DEG, MAJ } = require('./engine');

const BITS = 20;
const INIT_STRENGTH = 1.0;
const TAX_RATE = 0.1;       // bucket brigade: fraction paid to previous classifier
const REWARD = 3.0;         // strength reward to winner's last classifiers
const PENALTY = 1.0;        // strength penalty to loser's last classifiers
const MIN_STRENGTH = 0.01;
const SPECIFICITY_WEIGHT = 0.5; // how much specificity boosts the bid


// ---- Feature encoding ----

function progressBits(myBridges, majNeeded) {
  if (myBridges === 0) return '00';
  if (myBridges >= majNeeded) return '11';
  if (myBridges === majNeeded - 1) return '10';
  return '01';
}

// Would placing bridge ci for player p remove opponent bridges?
function wouldCascade(game, ci, p) {
  const opp = 1 - p;
  for (const isl of CONNS[ci]) {
    let myAfter = 0, oppCnt = 0;
    CONNS.forEach(([a, b], c2) => {
      if (a !== isl && b !== isl) return;
      const br = c2 === ci ? p : game.bridges[c2];
      if (br === p) myAfter++;
      else if (br === opp) oppCnt++;
    });
    if (myAfter >= MAJ[isl] && oppCnt > 0) return true;
  }
  return false;
}

// Would removing bridge ci for player p cause opp to lose control of an island?
function removalDisrupts(game, ci, p) {
  const opp = 1 - p;
  for (const isl of CONNS[ci]) {
    if (game.controlled[isl] !== opp) continue;
    let oppAfter = 0;
    CONNS.forEach(([a, b], c2) => {
      if (a !== isl && b !== isl) return;
      const br = c2 === ci ? null : game.bridges[c2];
      if (br === opp) oppAfter++;
    });
    if (oppAfter < MAJ[isl]) return true;
  }
  return false;
}

function encodeMove(game, move) {
  const p = game.curP;
  const opp = 1 - p;
  const [A, B] = CONNS[move.ci];

  const isRemove = move.type === 'remove' ? '1' : '0';

  // progress on A
  let myBrA = 0, oppBrA = 0;
  CONNS.forEach(([a, b], ci) => {
    if (a !== A && b !== A) return;
    const br = ci === move.ci
      ? (move.type === 'place' ? p : null)
      : game.bridges[ci];
    if (br === p) myBrA++;
    else if (br === opp) oppBrA++;
  });
  const myProgA  = progressBits(myBrA,  MAJ[A]);
  const oppProgA = progressBits(oppBrA, MAJ[A]);
  const oppCtlA  = game.controlled[A] === opp ? '1' : '0';
  const cascA    = move.type === 'place'
    ? (wouldCascade(game, move.ci, p) && CONNS[move.ci].includes(A) ? '1' : '0')
    : (removalDisrupts(game, move.ci, p) && CONNS[move.ci].includes(A) ? '1' : '0');

  // progress on B
  let myBrB = 0, oppBrB = 0;
  CONNS.forEach(([a, b], ci) => {
    if (a !== B && b !== B) return;
    const br = ci === move.ci
      ? (move.type === 'place' ? p : null)
      : game.bridges[ci];
    if (br === p) myBrB++;
    else if (br === opp) oppBrB++;
  });
  const myProgB  = progressBits(myBrB,  MAJ[B]);
  const oppProgB = progressBits(oppBrB, MAJ[B]);
  const oppCtlB  = game.controlled[B] === opp ? '1' : '0';
  const cascB    = move.type === 'place'
    ? (wouldCascade(game, move.ci, p) && CONNS[move.ci].includes(B) ? '1' : '0')
    : (removalDisrupts(game, move.ci, p) && CONNS[move.ci].includes(B) ? '1' : '0');

  const phase = game.gamePhase === 1 ? '01' : game.gamePhase === 2 ? '10' : '11';
  const scoreDiff = game.scores[p] - game.scores[opp];
  const behind    = scoreDiff < 0 ? '1' : '0';
  const ahead     = scoreDiff > 0 ? '1' : '0';

  const hubA = DEG[A] >= 4 ? '1' : '0';
  const hubB = DEG[B] >= 4 ? '1' : '0';

  const handSize = game.hands[p].length - (move.type === 'place' ? 1 : 2);
  const thin = handSize <= 2 ? '1' : '0';

  return isRemove + myProgA + oppProgA + oppCtlA + cascA +
         myProgB + oppProgB + oppCtlB + cascB +
         phase + behind + ahead + hubA + hubB + thin;
}


// ---- Classifier operations ----

function matches(condition, features) {
  for (let i = 0; i < BITS; i++) {
    if (condition[i] !== '#' && condition[i] !== features[i]) return false;
  }
  return true;
}

function specificity(condition) {
  let s = 0;
  for (let i = 0; i < BITS; i++) if (condition[i] !== '#') s++;
  return s / BITS;
}

function randomCondition(features) {
  // Start from the actual feature string, then randomly generalize some bits to #
  let c = '';
  for (let i = 0; i < BITS; i++) {
    const r = Math.random();
    if (r < 0.33) c += '#';          // don't-care
    else c += features[i];            // match actual feature
  }
  return c;
}

function randomClassifier(features) {
  return { condition: randomCondition(features), strength: INIT_STRENGTH };
}


// ---- Population ----

function createPopulation(size) {
  const pop = [];
  // Seed with all-wildcard classifier so there's always at least one match
  pop.push({ condition: '#'.repeat(BITS), strength: INIT_STRENGTH });
  for (let i = 1; i < size; i++) {
    // Random condition
    let c = '';
    for (let j = 0; j < BITS; j++) {
      const r = Math.random();
      c += r < 0.33 ? '#' : (Math.random() < 0.5 ? '0' : '1');
    }
    pop.push({ condition: c, strength: INIT_STRENGTH });
  }
  return pop;
}


// ---- Auction: score a move given the population ----

// Returns the total weighted bid for this move's feature string.
function scoreMoveForPop(features, pop) {
  let total = 0;
  for (const clf of pop) {
    if (matches(clf.condition, features)) {
      total += clf.strength * (1 + SPECIFICITY_WEIGHT * specificity(clf.condition));
    }
  }
  return total;
}

// Choose a play-move (place or remove) using the classifier population.
// Returns { move, matchedClfs } where matchedClfs is the set of classifiers
// that fired, for use in the bucket brigade.
// epsilon: probability of random move (exploration).
function choosePlayMove(game, pop, epsilon = 0.05) {
  const moves = game.legalMoves().filter(m => m.type === 'place' || m.type === 'remove');
  if (moves.length === 0) return null;

  if (Math.random() < epsilon) {
    const m = moves[Math.floor(Math.random() * moves.length)];
    return { move: m, matchedClfs: [] };
  }

  let bestScore = -Infinity, bestMove = null, bestFeatures = null;
  for (const m of moves) {
    const f = encodeMove(game, m);
    const s = scoreMoveForPop(f, pop);
    if (s > bestScore) { bestScore = s; bestMove = m; bestFeatures = f; }
  }

  const matched = pop.filter(clf => matches(clf.condition, bestFeatures));
  return { move: bestMove, matchedClfs: matched };
}

// Choose a draw move. Uses a simple heuristic (not LCS) since draw features
// are structurally different — the LCS learns play strategy.
function chooseDrawMove(game) {
  const moves = game.legalMoves();
  if (moves.length === 0) return null;
  const draws = moves.filter(m => m.type === 'draw');
  if (draws.length === 0) return moves[0]; // pass-draw

  const p = game.curP;
  const opp = 1 - p;

  let bestVal = -Infinity, bestMove = null;
  for (const dm of draws) {
    if (dm.src === 'deck') {
      // Deck: neutral value
      if (0 > bestVal) { bestVal = 0; bestMove = dm; }
      continue;
    }
    const isl = game.market[dm.src];
    let val = 0;
    CONNS.forEach(([a, b], ci) => {
      if (a !== isl && b !== isl) return;
      if (game.bridges[ci] === null) val += 1;
      if (game.bridges[ci] === opp)  val += 0.5;
    });
    // Bonus: holding this card would let us remove an opponent bridge
    game.hands[p].forEach(held => {
      CONNS.forEach(([a, b], ci) => {
        if (game.bridges[ci] !== opp) return;
        if ((held === a || held === b) && (isl === a || isl === b)) val += 2;
      });
    });
    if (val > bestVal) { bestVal = val; bestMove = dm; }
  }
  return bestMove || moves[0];
}


// ---- Bucket brigade credit assignment ----

function bucketBrigade(prevMatchedClfs, curMatchedClfs) {
  // Current classifiers pay TAX_RATE of their strength to previous classifiers.
  const totalPrev = prevMatchedClfs.reduce((s, c) => s + c.strength, 0);
  if (totalPrev === 0) return;
  const pot = curMatchedClfs.reduce((s, c) => {
    const tax = c.strength * TAX_RATE;
    c.strength = Math.max(MIN_STRENGTH, c.strength - tax);
    return s + tax;
  }, 0);
  // Distribute pot to prev classifiers proportional to their strength
  prevMatchedClfs.forEach(c => {
    c.strength += pot * (c.strength / totalPrev);
  });
}

function applyReward(matchedClfs, reward) {
  if (!matchedClfs || matchedClfs.length === 0) return;
  const share = reward / matchedClfs.length;
  matchedClfs.forEach(c => {
    c.strength = Math.max(MIN_STRENGTH, c.strength + share);
  });
}


// ---- Genetic algorithm ----

function crossover(cA, cB) {
  const pt = 1 + Math.floor(Math.random() * (BITS - 2));
  return cA.condition.slice(0, pt) + cB.condition.slice(pt);
}

function mutate(condition, mutRate = 0.04) {
  let c = '';
  for (let i = 0; i < BITS; i++) {
    if (Math.random() < mutRate) {
      const r = Math.random();
      c += r < 0.33 ? '#' : (Math.random() < 0.5 ? '0' : '1');
    } else {
      c += condition[i];
    }
  }
  return c;
}

function evolve(pop) {
  pop.sort((a, b) => b.strength - a.strength);
  const targetSize = pop.length;
  const keepN = Math.floor(targetSize * 0.5);
  const elite = pop.slice(0, keepN);

  pop.length = keepN;
  while (pop.length < targetSize) {
    const pA = elite[Math.floor(Math.random() * keepN)];
    const pB = elite[Math.floor(Math.random() * keepN)];
    const child = mutate(crossover(pA, pB));
    pop.push({ condition: child, strength: (pA.strength + pB.strength) / 2 });
  }

  // Normalize strengths to prevent unbounded growth
  const mean = pop.reduce((s, c) => s + c.strength, 0) / pop.length;
  if (mean > 10) pop.forEach(c => { c.strength /= mean / 5; });
}

module.exports = {
  createPopulation,
  choosePlayMove,
  chooseDrawMove,
  bucketBrigade,
  applyReward,
  evolve,
  encodeMove,
  BITS,
  REWARD,
  PENALTY,
};
