/**
 * #66 Crash Coach: an evidence-backed explanation of a crash. Pure; no Phaser, no clock, no randomness.
 *
 * Every claim carries `evidence: {field, value}`. `field` is a dotted path into the input of explainCrash
 * (`lastCrash.verdict`, `sledAtCrash.angle`, ...) and `value` is exactly what sits there, or, for claims read off the tape,
 * `field: 'tape.inputs'` with the tick of the input edge the claim is about. A claim whose data is missing is not made:
 * fewer claims, never guesses.
 */
import { SIM_TICK_HZ } from '../SimClock.js';
import { lastInputEdges, perturbableTape } from './Perturb.js';

/** How far back before the crash the tape is read for "your last hop/lean/tuck" claims. */
export const CAUSE_WINDOW_TICKS = 240;

const CAUSE_TEXT = Object.freeze({
  hazard: 'The crash was a hazard hit.',
  terrain: 'The sled hit the terrain head first.',
  badLanding: 'The sled landed badly.',
  chasm: 'The sled fell into the void.',
  bsod: 'The BSOD caught the sled.',
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sec = (ticks) => (ticks / SIM_TICK_HZ).toFixed(2);

/** @returns {{text:string, evidence:{field:string, value:any}}|null} null when the evidence is missing. */
function claim(text, field, value) {
  if (value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value)) || value === '') return null;
  return { text, evidence: { field, value } };
}

/**
 * The hop verdict text (CrashReport.verdictText) turned into a sentence. hopTiming: 'late' = the last hop came after the
 * telegraph's ideal-hop window closed, 'early' = before it opened, 'none' = no hop within 1 s before the window.
 */
function verdictClaim(verdict) {
  if (typeof verdict !== 'string' || !verdict) return null;
  const m = /^HOP WAS (\d+(?:\.\d+)?) S (LATE|EARLY)$/.exec(verdict);
  let text;
  if (m && m[2] === 'LATE') text = `Your last hop came ${m[1]} s after the ideal hop window had closed.`;
  else if (m) text = `Your last hop came ${m[1]} s before the ideal hop window opened.`;
  else if (verdict === 'NO HOP') text = 'No hop was found in the second before the ideal hop window.';
  else if (verdict === 'HOP WAS ON TIME') text = 'Your last hop was inside the ideal hop window.';
  else text = `Hop verdict: ${verdict}.`;
  return claim(text, 'lastCrash.verdict', verdict);
}

/** Impact angle in degrees, from either an object `{angle}` or the GhostTape sledState array `[x, y, angle, ...]`. */
function impactAngle(sled) {
  const rad = Array.isArray(sled) ? sled[2] : sled && sled.angle;
  return isNum(rad) ? rad : null;
}

/**
 * @param {{lastCrash?:object|null, crashTick?:number, tape?:object|null, sledAtCrash?:object|number[]|null}} o
 *   lastCrash is the REG.LAST_CRASH shape (CrashReport.js); crashTick the tick the crash was decided on.
 * @returns {{cause:string|null, hazardId:string|null, claims:Array<{text:string, evidence:{field:string, value:any}}>}}
 */
export function explainCrash({ lastCrash, crashTick, tape, sledAtCrash } = {}) {
  const lc = lastCrash && typeof lastCrash === 'object' ? lastCrash : {};
  const cause = typeof lc.cause === 'string' && lc.cause ? lc.cause : null;
  const hazardId = typeof lc.hazardId === 'string' && lc.hazardId ? lc.hazardId : null;
  const claims = [];
  const add = (c) => { if (c) claims.push(c); };

  if (cause) add(claim(CAUSE_TEXT[cause] || `The crash cause was recorded as ${cause}.`, 'lastCrash.cause', cause));
  if (hazardId) {
    const label = typeof lc.name === 'string' && lc.name ? lc.name : hazardId;
    add(claim(`The hazard was ${label}.`, 'lastCrash.hazardId', hazardId));
  }
  add(verdictClaim(lc.verdict));
  if (isNum(lc.distM)) add(claim(`The crash was at ${lc.distM} m.`, 'lastCrash.distM', lc.distM));

  if (cause === 'terrain' || cause === 'badLanding') {
    const rad = impactAngle(sledAtCrash);
    if (rad !== null) {
      const deg = Math.round((rad * 180) / Math.PI);
      add(claim(`The sled was rotated ${Math.abs(deg)} degrees from level at impact.`, 'sledAtCrash.angle', rad));
    }
  }

  if (perturbableTape(tape).ok && Number.isSafeInteger(crashTick) && crashTick > 0) {
    const edges = lastInputEdges(tape, crashTick, CAUSE_WINDOW_TICKS);
    const last = (pred) => { for (let i = edges.length - 1; i >= 0; i--) if (pred(edges[i])) return edges[i]; return null; };
    const at = (e) => ({ tick: e.tick, ticksBeforeCrash: e.ticksBeforeCrash });
    const hop = last((e) => e.kind === 'hop' && e.action === 'press');
    if (hop) add(claim(`Your last hop press was ${sec(hop.ticksBeforeCrash)} s before the crash.`, 'tape.inputs', at(hop)));
    else add(claim(`There was no hop press in the ${sec(CAUSE_WINDOW_TICKS)} s before the crash.`, 'tape.inputs', { windowTicks: CAUSE_WINDOW_TICKS, hopPresses: 0 }));
    const lean = last((e) => e.kind === 'lean');
    if (lean) add(claim(`Your last lean change was ${sec(lean.ticksBeforeCrash)} s before the crash, to ${(lean.to / 127).toFixed(2)}.`, 'tape.inputs', { ...at(lean), tilt127: lean.to }));
    const tuck = last((e) => e.kind === 'tuck');
    if (tuck) add(claim(`Your last tuck ${tuck.action} was ${sec(tuck.ticksBeforeCrash)} s before the crash.`, 'tape.inputs', { ...at(tuck), action: tuck.action }));
  }
  return { cause, hazardId, claims };
}
