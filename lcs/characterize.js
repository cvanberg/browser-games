// Reads each bot snapshot and prints a character profile based on
// what their top classifiers prefer.

'use strict';

const fs = require('fs');
const { CONNS, DEG, MAJ } = require('./engine');

const BITS = 20;
// Bit positions (matches encodeMove in lcs.js)
// 0:moveType  1-2:myProgA  3-4:oppProgA  5:oppCtlA  6:cascA
// 7-8:myProgB  9-10:oppProgB  11:oppCtlB  12:cascB
// 13-14:phase  15:behind  16:ahead  17:hubA  18:hubB  19:thin

function pct(n, d) { return d ? (100 * n / d).toFixed(0) + '%' : 'n/a'; }

function profile(clfs) {
  const top = clfs.slice(0, 50); // analyse top 50 by strength
  const n = top.length;

  const count = (bit, val) =>
    top.filter(c => c.condition[bit] === val).length;

  const isPlace   = count(0, '0');
  const isRemove  = count(0, '1');
  const casc      = top.filter(c => c.condition[6] === '1' || c.condition[12] === '1').length;
  const oppCtl    = top.filter(c => c.condition[5] === '1' || c.condition[11] === '1').length;
  const phase1    = top.filter(c => c.condition[13] === '0' && c.condition[14] === '1').length;
  const phase2    = top.filter(c => c.condition[13] === '1' && c.condition[14] === '0').length;
  const phase3    = top.filter(c => c.condition[13] === '1' && c.condition[14] === '1').length;
  const hubFocus  = top.filter(c => c.condition[17] === '1' || c.condition[18] === '1').length;
  const thin      = count(19, '1');
  const behind    = count(15, '1');
  const ahead     = count(16, '1');
  const achieveMaj= top.filter(c =>
    (c.condition[1] === '1' && c.condition[2] === '1') ||
    (c.condition[7] === '1' && c.condition[8] === '1')).length;
  const oneAway   = top.filter(c =>
    (c.condition[1] === '1' && c.condition[2] === '0') ||
    (c.condition[7] === '1' && c.condition[8] === '0')).length;

  const avgSpec   = top.reduce((s, c) => {
    return s + [...c.condition].filter(b => b !== '#').length / BITS;
  }, 0) / n;

  return {
    place: pct(isPlace, n),
    remove: pct(isRemove, n),
    cascade: pct(casc, n),
    oppControl: pct(oppCtl, n),
    phase1: pct(phase1, n),
    phase2: pct(phase2, n),
    phase3: pct(phase3, n),
    hubFocus: pct(hubFocus, n),
    thin: pct(thin, n),
    behind: pct(behind, n),
    ahead: pct(ahead, n),
    achieveMaj: pct(achieveMaj, n),
    oneAway: pct(oneAway, n),
    specificity: (avgSpec * 100).toFixed(1) + '%',
    topStrength: clfs[0].strength.toFixed(2),
  };
}

const files = [
  'bots/bot_04000.json',
  'bots/bot_08000.json',
  'bots/bot_12000.json',
  'bots/bot_16000.json',
  'bots/bot_20000.json',
];

for (const f of files) {
  const clfs = JSON.parse(fs.readFileSync(f, 'utf8'));
  const p = profile(clfs);
  console.log(`\n── ${f} (${clfs.length} classifiers, top strength: ${p.topStrength})`);
  console.log(`   Place: ${p.place}  Remove: ${p.remove}  Cascade focus: ${p.cascade}`);
  console.log(`   Opp-control focus: ${p.oppControl}  Hub focus: ${p.hubFocus}`);
  console.log(`   Phase 1: ${p.phase1}  Phase 2: ${p.phase2}  Phase 3: ${p.phase3}`);
  console.log(`   Achieve majority: ${p.achieveMaj}  One-away: ${p.oneAway}`);
  console.log(`   Behind-score rules: ${p.behind}  Ahead-score rules: ${p.ahead}`);
  console.log(`   Thin-hand rules: ${p.thin}  Avg specificity: ${p.specificity}`);
}
