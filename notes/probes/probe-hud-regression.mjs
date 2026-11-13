/**
 * Luna W3 audit probe — is a W3-introduced HUD collision, and is it in the layout maths?
 *
 * The live HUD probe (`tools/sim/shots.mjs hud`) reports text-on-text collisions at the W3 head that
 * are absent at `origin/main`, reproducibly, with an unchanged probe. So the delta is in `src/`.
 *
 * Hypothesis: `_layout()` used to push the strip into `slots` as `kind: 'strip'`, which meant
 * `stackY` reserved vertical space for it and every later item (popups, banner) was placed BELOW it.
 * W3 moved the strip out of `slots` into a separate `placeBand` call, so `stackY` no longer knows the
 * strip occupies a row — and the items that used to sit under it now sit on it.
 *
 * This reproduces that arithmetic directly with the shipped helpers, no browser needed.
 */
import { stackY, placeBand, rectsHit } from './src/ui/HudLayout.js';

// The real constants from UIScene.js
const BANK_Y = 80;
const POPUP_Y = 100;
const SLOT = { warn: 22, boost: 24, flash: 46, strip: 59, bank: BANK_Y, banner: 86, popup: POPUP_Y };

// A fixed HUD row where "FLOW x1.25" lives (right-hand side, y 62..70) and one on the left.
const FLOW = { x: 380, y: 62, w: 92, h: 8 };
const SCORE = { x: 8, y: 8, w: 70, h: 16 };
const keep = [FLOW, SCORE];

const stripH = 17;
const bandTop = placeBand(stripH, SLOT.strip, keep, { gap: 3 });
const stripRow = { x: 0, y: bandTop, w: 480, h: stripH };

console.log('== Where the strip lands ==');
console.log(`  classic SLOT.strip      : ${SLOT.strip}`);
console.log(`  placeBand resolves to   : ${bandTop}`);
console.log(`  band occupies rows      : ${stripRow.y} .. ${stripRow.y + stripRow.h}`);

// A mock mission-completion strip plus one trick popup, measured the way UIScene measures them.
const stripText = { w: 260, h: 8 };
const popup = { w: 120, h: 8 };

console.log('\n== A) W3 layout: strip is NOT in `slots`, so stackY cannot reserve its row ==');
const slotsA = [
  { w: 120, h: 8, pref: SLOT.popup, kind: 'top' },   // the trick popup
];
const ysA = stackY(slotsA, { cx: 240, startY: 0, gap: 3, keepOuts: keep });
const popupA = { x: 240 - popup.w / 2, y: ysA[0], w: popup.w, h: popup.h };
console.log(`  popup placed at y       : ${popupA.y} .. ${popupA.y + popupA.h}`);
console.log(`  strip band              : ${stripRow.y} .. ${stripRow.y + stripRow.h}`);
console.log(`  do they collide?        : ${rectsHit(popupA, stripRow) ? 'YES' : 'no'}`);

console.log('\n== B) pre-W3 layout: strip WAS a slot, so the popup was pushed below it ==');
const slotsB = [
  // stackY places in array order; the original added the strip between flash and bank.
  { w: stripText.w, h: stripH, pref: SLOT.strip, kind: 'strip' },
  { w: popup.w, h: popup.h, pref: SLOT.popup, kind: 'top' },
];
const ysB = stackY(slotsB, { cx: 240, startY: 0, gap: 3, keepOuts: keep });
const popupB = { x: 240 - popup.w / 2, y: ysB[1], w: popup.w, h: popup.h };
const stripRowB = { x: 0, y: ysB[0], w: 480, h: stripH };
console.log(`  strip slot at y         : ${stripRowB.y} .. ${stripRowB.y + stripRowB.h}`);
console.log(`  popup placed at y       : ${popupB.y} .. ${popupB.y + popupB.h}`);
console.log(`  do they collide?        : ${rectsHit(popupB, stripRowB) ? 'YES' : 'no'}`);

const w3Collides = rectsHit(popupA, stripRow);
const preCollides = rectsHit(popupB, stripRowB);
console.log(`\nRESULT: W3 ${w3Collides ? 'COLLIDES' : 'is clear'}, pre-W3 ${preCollides ? 'collides' : 'WAS CLEAR'}`);
console.log(w3Collides && !preCollides
  ? '  => removing the strip from `slots` is what let the popup land on the strip\'s row.'
  : '  => the hypothesis is wrong; the stack is not the mechanism.');
