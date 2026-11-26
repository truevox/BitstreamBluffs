/**
 * #66 Crash Coach: the pure view model behind the Game Over `C` screen. No Phaser, no scene: everything the view prints or
 * decides lives here so it can be tested without a renderer.
 */
import { takeoverEligible, buildTakeoverDescriptor } from '../systems/replay/Takeover.js';
import { perturbableTape } from '../systems/coach/Perturb.js';
import { DEFAULT_BRANCH_BACK_TICKS } from '../systems/coach/CrashCoach.js';

/** Wall-time budget of one search, on top of the count budget (the engine re-simulates every candidate from tick 0). */
export const COACH_TIME_BUDGET_MS = 25000;
export const COACH_BANNER = 'UNRANKED PRACTICE: NO SCORE, XP, SHARDS OR ACHIEVEMENTS';
/** Survival is judged on the last held pad (the tape has no inputs after the crash). The UI says so. */
export const COACH_ASSUMPTION = 'ASSUMES YOU KEEP YOUR LAST INPUT AFTER THE ORIGINAL CRASH MOMENT';
export const MAX_CLAIM_ROWS = 6;

/**
 * Everything a coach search needs from the run that just ended, or a visible reason it cannot run. The tape must be THIS run's
 * (REG.LAST_GHOST_TAPE vs the Game Over record) and replayable by this build, exactly like a takeover.
 * @returns {{ok:true, tape:object, lastCrash:object, crashTick:number, branchTick:number}|{ok:false, reason:string, message:string}}
 */
export function coachContext({ tape, lastCrash, runId, rulesetId }) {
  const no = (reason, message) => ({ ok: false, reason, message });
  if (!tape || !runId || tape.runId !== runId) return no('no-tape', 'this run left no tape to search');
  if (!lastCrash || lastCrash.runId !== runId) return no('no-crash', 'this run did not end in a recorded crash');
  const crashTick = (tape.endTick | 0) + 1; // the crash tick records no checkpoint, so the tape ends one tick before it
  const branchTick = Math.max(1, crashTick - DEFAULT_BRANCH_BACK_TICKS);
  const e = takeoverEligible(tape, branchTick, { rulesetId });
  if (!e.ok) return no(e.reason, e.message);
  const p = perturbableTape(tape);
  if (!p.ok) return no('unsupported', p.reason);
  return { ok: true, tape, lastCrash, crashTick, branchTick };
}

/**
 * PRACTICE THIS MOMENT: a #72 takeover of the ORIGINAL tape at the branch tick (never a candidate tape). Re-checked right
 * before the descriptor is built.
 */
export function practiceDescriptor(ctx, rulesetId) {
  if (!ctx || !ctx.ok) return { ok: false, reason: 'no-context', message: 'nothing to practice' };
  const e = takeoverEligible(ctx.tape, ctx.branchTick, { rulesetId });
  if (!e.ok) return e;
  return { ok: true, descriptor: buildTakeoverDescriptor({ tape: ctx.tape, tick: ctx.branchTick, source: 'coach' }) };
}

const fmtValue = (v) => {
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k} ${x}`).join(', ');
  return String(v);
};

/** The claims as display rows: the sentence, and the field that backs it in a muted sub-line. Uppercase (the pixel font). */
export function claimRows(cause, max = MAX_CLAIM_ROWS) {
  const claims = (cause && Array.isArray(cause.claims) ? cause.claims : []).slice(0, max);
  return claims.map((c) => ({ main: c.text.toUpperCase(), sub: `EVIDENCE: ${c.evidence.field} = ${fmtValue(c.evidence.value)}`.toUpperCase() }));
}

/** Greedy word wrap by measured width. */
export function wrapText(text, maxWidth, measure, maxLines = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > maxWidth) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] = `${keep[maxLines - 1]}...`; return keep; }
  return lines;
}

const secs = (ms) => `${(ms / 1000).toFixed(1)} S`;
/** The live progress line while the search runs. */
export function progressLine(p) {
  if (!p) return 'STARTING THE SEARCH...';
  return `SEARCHED ${p.searched} OF ${p.planned}   SURVIVED ${p.survivors}${p.unstable ? `   UNSTABLE ${p.unstable}` : ''}   ${secs(p.elapsedMs || 0)}`;
}

/** What the buttons may do now. */
export function buttonStates({ phase, result, canPractice }) {
  return {
    alternative: phase === 'done' && !!result && result.survivors.length > 0,
    practice: !!canPractice && (phase === 'done' || phase === 'running' || phase === 'unavailable'),
  };
}

/** The honest line shown when the search found nothing or could not run. Never claims exhaustiveness. */
export function unavailableLine(ctx) {
  return `SEARCH UNAVAILABLE: ${String(ctx.message || ctx.reason).toUpperCase()}`;
}
