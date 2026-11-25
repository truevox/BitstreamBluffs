/**
 * #66 Crash Coach: explain a crash, then look for nearby input variations that a deterministic re-simulation proves
 * survive. Pure orchestration: the simulator is INJECTED (`simulate`), the clock is injected (`now`), no randomness.
 *
 * Honesty rules, enforced here and by tests:
 *  - a variation is reported as a survivor only after a SECOND, fresh simulation of a freshly built tape gives the same
 *    outcome and the same fingerprints; one that fails that check is dropped and counted as `unstable`;
 *  - the summary says how many variations were searched and how many survived, and when none did it says the search is not
 *    exhaustive. It never claims a variation is the only or the strongest one, and never promises anything.
 *
 * The injected `simulate(tape, {untilTick})` re-runs `tape` from tick 0 (or from a cached prefix) through `untilTick`, which
 * can lie past `tape.endTick`; past the last row the pad is the last held pad (TapePlayer semantics). It resolves
 * `{survived:boolean, crashTick:number|null, cause:string|null, fingerprintAt:{[tick]:string}, divergenceAt?:number|null}`.
 */
import { explainCrash } from './CrashCause.js';
import { butterflyData } from './Butterfly.js';
import { applyCandidate, enumerateCandidates, perturbableTape } from './Perturb.js';
import { SIM_TICK_HZ } from '../SimClock.js';

export const DEFAULT_BUDGET = 64;
/** The crash is judged over this many ticks past the original crash: 2 s. */
export const DEFAULT_MARGIN_TICKS = 2 * SIM_TICK_HZ;
/** Variations start this many ticks before the crash: 3 s. */
export const DEFAULT_BRANCH_BACK_TICKS = 3 * SIM_TICK_HZ;
export const DEFAULT_MAX_SHIFT = 12;

const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);

/** Same non-empty fingerprint map, tick for tick. */
function sameFingerprints(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (!ka.length || ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

const finalFingerprint = (fp) => {
  const ticks = Object.keys(fp).map(Number).filter(Number.isFinite).sort((x, y) => x - y);
  const tick = ticks[ticks.length - 1];
  return { tick, hash: fp[tick] };
};

/** A result counts as survived only if it says so and reports no crash inside the judged span. */
const survivedAll = (res, untilTick) => !!res && res.survived === true && !(isInt(res.crashTick) && res.crashTick <= untilTick);

function summaryOf({ searched, survivors, unstable, errors, budgetExhausted, unsupported }) {
  const noun = searched === 1 ? 'variation' : 'variations';
  let s = survivors.length
    ? `Searched ${searched} nearby input ${noun}; ${survivors.length} survived.`
    : `Searched ${searched} nearby input ${noun}; none survived. This search is not exhaustive.`;
  if (unstable) s += ` ${unstable} ${unstable === 1 ? 'was' : 'were'} dropped because the result did not repeat.`;
  if (errors) s += ` ${errors} could not be simulated.`;
  if (budgetExhausted) s += ' Search stopped at its budget.';
  if (unsupported) s += ` No variations were generated: ${unsupported}.`;
  return s;
}

/**
 * @param {object} o
 * @param {object} o.tape the run's ghost tape (a finished GhostRecorder tape)
 * @param {number} o.crashTick tick the run crashed on
 * @param {object} o.lastCrash REG.LAST_CRASH
 * @param {(tape:object, o:{untilTick:number}) => Promise<object>} o.simulate injected simulator (see file header)
 * @param {number} [o.budget] max variations to simulate
 * @param {number} [o.timeBudgetMs] optional wall-time cap, measured with `now`
 * @param {() => number} [o.now] injected clock (ms); required for timeBudgetMs to have any effect
 * @param {number} [o.branchBackTicks] how far before the crash variations may start
 * @param {number} [o.marginTicks] survival is judged through crashTick + marginTicks
 * @param {number} [o.maxShift] largest timing shift tried, in ticks
 * @param {object|number[]} [o.sledAtCrash] sled pose at the crash, for the explanation
 */
export async function runCoach({
  tape, crashTick, lastCrash, simulate, budget = DEFAULT_BUDGET, timeBudgetMs = null, now = null,
  branchBackTicks = DEFAULT_BRANCH_BACK_TICKS, marginTicks = DEFAULT_MARGIN_TICKS, maxShift = DEFAULT_MAX_SHIFT, sledAtCrash,
} = {}) {
  if (typeof simulate !== 'function') throw new TypeError('runCoach needs an injected simulate(tape, {untilTick}) function');
  const cause = explainCrash({ lastCrash, crashTick, tape, sledAtCrash });
  const branchTick = Math.max(1, (crashTick | 0) - branchBackTicks);
  const untilTick = (crashTick | 0) + marginTicks;

  const support = perturbableTape(tape);
  const cap = Math.max(0, Math.floor(budget));
  // Ask for one more than the budget: that is how we know the list was cut rather than complete.
  const listed = support.ok && isInt(crashTick) ? enumerateCandidates(tape, { branchTick, crashTick, maxShift, budget: cap + 1 }) : [];
  const candidates = listed.slice(0, cap);
  let budgetExhausted = listed.length > cap;

  const useClock = isInt(timeBudgetMs) && typeof now === 'function';
  const t0 = useClock ? now() : 0;
  const survivors = [];
  const results = [];
  let searched = 0;
  let unstable = 0;
  let errors = 0;

  for (const c of candidates) {
    if (useClock && now() - t0 >= timeBudgetMs) { budgetExhausted = true; break; }
    searched++;
    const rec = { id: c.id, kind: c.kind, label: c.label, offsetTicks: c.offsetTicks, outcome: 'crashed', divergenceAt: null };
    results.push(rec);
    try {
      const candidateTape = applyCandidate(tape, c);
      const first = await simulate(candidateTape, { untilTick });
      rec.divergenceAt = Number.isFinite(first && first.divergenceAt) ? first.divergenceAt : null;
      if (!survivedAll(first, untilTick)) continue;
      // Re-validate with a FRESH tape object and a fresh simulate call.
      const second = await simulate(applyCandidate(tape, c), { untilTick });
      if (survivedAll(second, untilTick) && sameFingerprints(first.fingerprintAt, second.fingerprintAt)) {
        rec.outcome = 'survived';
        survivors.push({ id: c.id, kind: c.kind, label: c.label, offsetTicks: c.offsetTicks, branchTick, validated: true,
          divergenceAt: rec.divergenceAt, finalFingerprint: finalFingerprint(second.fingerprintAt), tape: candidateTape });
      } else {
        rec.outcome = 'unstable';
        unstable++;
      }
    } catch {
      rec.outcome = 'error';
      errors++;
    }
  }

  const unsupported = support.ok ? null : support.reason;
  return {
    cause, searched, survivors, unstable, errors, budgetExhausted, unsupported, branchTick, untilTick,
    summary: summaryOf({ searched, survivors, unstable, errors, budgetExhausted, unsupported }),
    sensitivity: butterflyData(results, { branchTick }),
  };
}
