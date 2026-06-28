// Kahuna game engine — headless, synchronous, no DOM
// Mirrors the logic in kahuna/kahuna.html exactly.
//
// Turn structure (matching the real game and browser):
//   Play phase: player may play any number of cards (place or remove).
//   Draw phase: player draws one card (or passes), ending the turn.
//   legalMoves() always returns both play moves AND draw moves so the
//   training loop can decide when to stop playing and draw.

'use strict';

const ISLANDS = ['LALE','IFFI','HUNA','KAHU','JOJO','GOLA','FAAA','COCO','BARI','ELAI','DUDA','ALOA'];

const CONNS = [
  [0,1],[0,2],[0,3],[1,2],[1,3],[1,4],[1,9],[2,9],[2,10],[2,11],
  [3,4],[3,5],[3,7],[4,5],[4,6],[4,9],[5,6],[5,7],[6,8],[6,9],
  [7,8],[8,9],[8,10],[8,11],[9,10],[10,11],[6,7]
];

const DEG = new Array(12).fill(0);
CONNS.forEach(([a,b]) => { DEG[a]++; DEG[b]++; });
const MAJ = DEG.map(d => Math.floor(d / 2) + 1);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function createGame() {
  const g = {
    deck: [], market: [], hands: [[], []], bridges: [],
    controlled: [], scores: [0, 0], discard: [],
    curP: 0, subphase: 'play', gamePhase: 1,
    hasPlayed: false, lastPassedDraw: false,

    init() {
      const full = [];
      for (let i = 0; i < 12; i++) { full.push(i); full.push(i); }
      shuffle(full);
      this.hands = [full.splice(0, 3), full.splice(0, 3)];
      this.market = full.splice(0, 3);
      this.deck = [...full];
      this.discard = [];
      this.bridges = new Array(CONNS.length).fill(null);
      this.controlled = new Array(12).fill(null);
      this.scores = [0, 0];
      this.curP = 0;
      this.subphase = 'play';
      this.gamePhase = 1;
      this.hasPlayed = false;
      this.lastPassedDraw = false;
    },

    isOver() { return this.subphase === 'over'; },

    winner() {
      if (!this.isOver()) return -1;
      if (this.scores[0] > this.scores[1]) return 0;
      if (this.scores[1] > this.scores[0]) return 1;
      const ic = [0, 0];
      this.controlled.forEach(c => { if (c === 0) ic[0]++; else if (c === 1) ic[1]++; });
      if (ic[0] > ic[1]) return 0;
      if (ic[1] > ic[0]) return 1;
      return -1;
    },

    // Returns all legal moves for the current player.
    // During a turn the player may play any number of cards, then must draw.
    // All of: place, remove, draw, pass-draw are returned together so the
    // caller can decide when to switch from playing to drawing.
    legalMoves() {
      if (this.isOver()) return [];
      const p = this.curP;
      const moves = [];

      // ---- Play moves ----
      this.hands[p].forEach((isl, hi) => {
        CONNS.forEach(([a, b], ci) => {
          if ((a === isl || b === isl) && this.bridges[ci] === null)
            moves.push({ type: 'place', handIdx: hi, ci });
        });
      });
      for (let i = 0; i < this.hands[p].length; i++) {
        for (let j = i + 1; j < this.hands[p].length; j++) {
          const i1 = this.hands[p][i], i2 = this.hands[p][j];
          CONNS.forEach(([a, b], ci) => {
            if (this.bridges[ci] === 1 - p &&
                (i1 === a || i1 === b) && (i2 === a || i2 === b))
              moves.push({ type: 'remove', h1: i, h2: j, ci });
          });
        }
      }

      // ---- Draw moves (these end the turn) ----
      if (this.hands[p].length < 5) {
        if (this.deck.length > 0)
          moves.push({ type: 'draw', src: 'deck' });
        this.market.forEach((_, mi) =>
          moves.push({ type: 'draw', src: mi }));
      }
      if (this.deck.length === 0 && this.market.length === 0)
        moves.push({ type: 'pass-draw' });
      else if (this.lastPassedDraw)
        moves.push({ type: 'pass-draw' });

      return moves;
    },

    // Convenience: just the play moves (place + remove)
    playMoves() {
      return this.legalMoves().filter(m => m.type === 'place' || m.type === 'remove');
    },

    // Convenience: just the draw moves
    drawMoves() {
      return this.legalMoves().filter(m => m.type === 'draw' || m.type === 'pass-draw');
    },

    applyMove(move) {
      if (this.isOver()) return false;
      if (move.type === 'place')     return this._applyPlace(move.handIdx, move.ci);
      if (move.type === 'remove')    return this._applyRemove(move.h1, move.h2, move.ci);
      if (move.type === 'draw')      return this._applyDraw(move.src);
      if (move.type === 'pass-draw') { this._endTurn(true); return true; }
      return false;
    },

    _applyPlace(handIdx, ci) {
      const p = this.curP;
      const isl = this.hands[p][handIdx];
      if (!CONNS[ci].includes(isl) || this.bridges[ci] !== null) return false;
      this.discard.push(this.hands[p].splice(handIdx, 1)[0]);
      this.bridges[ci] = p;
      this._resolveAll();
      this.hasPlayed = true;
      // Turn does NOT end here — player may play more cards.
      return true;
    },

    _applyRemove(h1, h2, ci) {
      const p = this.curP;
      const [a, b] = CONNS[ci];
      const i1 = this.hands[p][h1], i2 = this.hands[p][h2];
      if (!((i1 === a || i1 === b) && (i2 === a || i2 === b))) return false;
      if (this.bridges[ci] !== 1 - p) return false;
      const hi = Math.max(h1, h2), lo = Math.min(h1, h2);
      this.discard.push(this.hands[p].splice(hi, 1)[0]);
      this.discard.push(this.hands[p].splice(lo, 1)[0]);
      this.bridges[ci] = null;
      this._resolveAll();
      this.hasPlayed = true;
      // Turn does NOT end here — player may play more cards.
      return true;
    },

    _applyDraw(src) {
      const p = this.curP;
      if (this.hands[p].length >= 5) return false;
      if (src === 'deck') {
        if (!this.deck.length) return false;
        this.hands[p].push(this.deck.shift());
      } else {
        const mi = parseInt(src);
        if (this.market[mi] === undefined) return false;
        this.hands[p].push(this.market[mi]);
        this.market.splice(mi, 1);
        if (this.deck.length) this.market.push(this.deck.shift());
      }
      this._endTurn(false);
      return true;
    },

    _resolveAll() {
      let changed = true;
      while (changed) {
        changed = false;
        for (let isl = 0; isl < 12; isl++) {
          const cnt = [0, 0];
          CONNS.forEach(([a, b], ci) => {
            if (a !== isl && b !== isl) return;
            if (this.bridges[ci] === 0) cnt[0]++;
            else if (this.bridges[ci] === 1) cnt[1]++;
          });
          const prev = this.controlled[isl];
          const next = cnt[0] >= MAJ[isl] ? 0 : cnt[1] >= MAJ[isl] ? 1 : null;
          if (next !== prev) {
            this.controlled[isl] = next;
            changed = true;
            if (next !== null) {
              CONNS.forEach(([a, b], ci) => {
                if ((a === isl || b === isl) && this.bridges[ci] === 1 - next)
                  this.bridges[ci] = null;
              });
            }
          }
        }
      }
    },

    _checkInstantWin() {
      if (this.gamePhase < 2) return -1;
      const cnt = [0, 0];
      this.bridges.forEach(b => { if (b === 0) cnt[0]++; else if (b === 1) cnt[1]++; });
      if (cnt[0] === 0 && cnt[1] > 0) return 1;
      if (cnt[1] === 0 && cnt[0] > 0) return 0;
      return -1;
    },

    _doScoring(phase) {
      const ic = [0, 0];
      this.controlled.forEach(c => { if (c === 0) ic[0]++; else if (c === 1) ic[1]++; });
      const winner = ic[0] > ic[1] ? 0 : ic[1] > ic[0] ? 1 : -1;
      const pts = phase === 1 ? 1 : phase === 2 ? 2 : Math.abs(ic[0] - ic[1]);
      if (winner >= 0) this.scores[winner] += pts;
    },

    _endTurn(passedDraw) {
      if (this.gamePhase >= 2) {
        const w = this._checkInstantWin();
        if (w >= 0) { this.subphase = 'over'; return; }
      }

      if (this.deck.length === 0 && this.market.length === 0) {
        this._doScoring(this.gamePhase);
        if (this.gamePhase >= 3) { this.subphase = 'over'; return; }
        this.gamePhase++;
        shuffle(this.discard);
        this.deck = [...this.discard];
        this.discard = [];
        this.market = [];
        while (this.market.length < 3 && this.deck.length) this.market.push(this.deck.shift());
      }

      this.lastPassedDraw = passedDraw;
      this.curP = 1 - this.curP;
      this.subphase = 'play';
      this.hasPlayed = false;
    },
  };

  return g;
}

module.exports = { createGame, CONNS, DEG, MAJ, ISLANDS };
