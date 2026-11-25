/**
 * #66 Crash Coach: the Butterfly Meter data. Pure; a later UI reads `points` and `summary` and may use butterflyBars() to
 * turn them into bar geometry. "Butterfly" = how small an input change has to be before the outcome changes.
 *
 * Outcomes are relative to the original run, which crashed: only a validated survivor counts as "changed the outcome".
 * A candidate that survived once but failed re-validation ('unstable') is shown, but never counts as a change.
 */

/** @typedef {'survived'|'crashed'|'unstable'|'error'} Outcome */

/** Candidate kinds that move an existing input by a number of ticks (offsetTicks is the shift). */
const SHIFT_KINDS = new Set(['hop-shift', 'edge-shift', 'lean-shift']);
/** Sensitivity tiers by the smallest shift (ticks at 120 Hz) that changed the outcome. */
export const VERY_SENSITIVE_TICKS = 3;
export const SENSITIVE_TICKS = 8;

const plural = (n) => `${n} tick${n === 1 ? '' : 's'}`;

/**
 * @param {Array<{id?:string, kind:string, label:string, offsetTicks:number|null, outcome:Outcome, divergenceAt?:number|null}>} results
 * @param {{branchTick?:number}} [o] with branchTick, `divergence` is in ticks after the branch
 * @returns {{points:Array<{id:string|null, label:string, offsetTicks:number|null, kind:string, outcome:Outcome, divergence:number|null}>,
 *   summary:string, changedAtTicks:number|null}}
 */
export function butterflyData(results, { branchTick } = {}) {
  const list = Array.isArray(results) ? results : [];
  const points = list.map((r) => ({
    id: r.id ?? null,
    label: r.label,
    offsetTicks: Number.isFinite(r.offsetTicks) ? r.offsetTicks : null,
    kind: r.kind,
    outcome: r.outcome,
    divergence: Number.isFinite(r.divergenceAt) ? Math.max(0, r.divergenceAt - (Number.isFinite(branchTick) ? branchTick : 0)) : null,
  }));
  const shifts = points.filter((p) => SHIFT_KINDS.has(p.kind) && p.offsetTicks !== null);
  const changedShifts = shifts.filter((p) => p.outcome === 'survived').sort((a, b) => Math.abs(a.offsetTicks) - Math.abs(b.offsetTicks));
  let summary;
  let changedAtTicks = null;
  if (changedShifts.length) {
    const p = changedShifts[0];
    const n = Math.abs(p.offsetTicks);
    changedAtTicks = n;
    const tier = n <= VERY_SENSITIVE_TICKS ? 'Very sensitive' : n <= SENSITIVE_TICKS ? 'Sensitive' : 'Somewhat sensitive';
    const thing = `your ${String(p.label).replace(/ \d+ ticks? (earlier|later)$/, '')}`;
    summary = `${tier}: shifting ${thing} by ${plural(n)} changed the outcome`;
  } else {
    const other = points.find((p) => p.outcome === 'survived');
    if (other) summary = `Sensitive: trying "${other.label}" changed the outcome`;
    else if (shifts.length) summary = `No shift of up to ${plural(Math.max(...shifts.map((p) => Math.abs(p.offsetTicks))))} that was searched changed the outcome`;
    else if (points.length) summary = 'No searched variation changed the outcome';
    else summary = 'No variations were searched';
  }
  return { points, summary, changedAtTicks };
}

/** Bar colours and relative heights by outcome (a survivor is the tallest bar; a plain crash is a stub). */
export const BAR_STYLE = Object.freeze({
  survived: { color: '#3fb950', height: 1 },
  unstable: { color: '#d29922', height: 0.5 },
  error: { color: '#8b949e', height: 0.25 },
  crashed: { color: '#f85149', height: 0.15 },
});

/**
 * Optional renderer helper: maps butterflyData().points to bars, ordered by offset (then id), heights scaled to maxHeight.
 * @returns {Array<{x:number|null, id:string|null, label:string, kind:string, outcome:Outcome, color:string, height:number, divergence:number|null}>}
 */
export function butterflyBars(data, { maxHeight = 1 } = {}) {
  const pts = data && Array.isArray(data.points) ? data.points : [];
  return [...pts]
    .sort((a, b) => (a.offsetTicks ?? Infinity) - (b.offsetTicks ?? Infinity) || String(a.id).localeCompare(String(b.id)))
    .map((p) => {
      const s = BAR_STYLE[p.outcome] || BAR_STYLE.error;
      return { x: p.offsetTicks, id: p.id, label: p.label, kind: p.kind, outcome: p.outcome, color: s.color, height: s.height * maxHeight, divergence: p.divergence };
    });
}
