/**
 * OWNER: gameplay (readable-chaos pass, phase 3). Pure death legibility: who killed the run, how the hop was timed against
 * the ground telegraph's own ideal-hop window (HazardTelegraph GROUND_WARN, whose arrival is predicted with B3's predictX
 * for moving hazards), the Game Over header line, the crash beat schedule and the same-seed DIED HERE x.
 * No Phaser, no clock, no randomness. Everything here runs after a crash has been decided (RunScene.doCrash): nothing
 * feeds back into physics, score, the RunRecord, its ledger hash, the sim or biome discovery. The report travels in the
 * registry (REG.LAST_CRASH), never in the record.
 */
import { GROUND_WARN } from './HazardTelegraph.js';

/**
 * Crash beat (after the existing TUNING.hitStopCrashMs hit-stop): FX run at slowScale for slowMs, and the camera eases
 * in by zoomIn over the same time and holds it until Game Over. Visual only; the run clock is already stopped.
 */
export const CRASH_BEAT = Object.freeze({ slowMs: 400, slowScale: 0.25, hitStopScale: 0.08, zoomIn: 0.18 });

/** A hop older than this before the ideal window counts as no hop at all (ms). */
const NO_HOP_BEFORE_MS = 1000;

const CAUSE_NAMES = Object.freeze({ terrain: 'HEAD FIRST', badLanding: 'BAD LANDING', chasm: 'FELL INTO THE VOID' });

const crashes = (def) => !!def && (!def.onHit || def.onHit.effect === 'crash');

/** "rollingBoulder" -> "ROLLING BOULDER". */
function idToName(id) {
  return String(id || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toUpperCase();
}

/**
 * The killer's name for the crash banner and the Game Over line. Only a def that crashes is ever named (blind, slow,
 * scramble never kill, so a Shatter Wall is never the killer); otherwise the cause names it.
 * @param {string} cause CRASH payload cause: 'hazard' | 'terrain' | 'badLanding' | 'chasm'.
 * @param {Object} [def] the hazard def for a hazard crash.
 * @returns {string}
 */
export function killerName(cause, def) {
  if (cause === 'hazard') {
    if (!crashes(def)) return 'CRASH';
    return def.name ? String(def.name).toUpperCase() : idToName(def.id) || 'CRASH';
  }
  return CAUSE_NAMES[cause] || 'CRASH';
}

/**
 * How the last hop sat against the ideal-hop window of the hazard that killed: the window is the telegraph's
 * (arrival - hopLeadMs .. + hopWindowMs, the sim oracle's rule).
 * @param {number|null|undefined} lastHopMs run time of the last executed hop.
 * @param {number} arrivalMs run time the sled reached the hazard (telegraph prediction, or the crash time).
 * @param {typeof GROUND_WARN} [t]
 * @returns {{kind:'none'|'early'|'late'|'onTime', s:number}} s = seconds outside the window, 2 decimals.
 */
export function hopTiming(lastHopMs, arrivalMs, t = GROUND_WARN) {
  const open = arrivalMs - t.hopLeadMs;
  const close = open + t.hopWindowMs;
  const r2 = (ms) => Math.round(ms / 10) / 100;
  if (!Number.isFinite(lastHopMs) || lastHopMs < open - NO_HOP_BEFORE_MS) return { kind: 'none', s: 0 };
  if (lastHopMs < open) return { kind: 'early', s: r2(open - lastHopMs) };
  if (lastHopMs > close) return { kind: 'late', s: r2(lastHopMs - close) };
  return { kind: 'onTime', s: 0 };
}

/** @param {{kind:string, s:number}} h @returns {string} */
export function verdictText(h) {
  if (!h || h.kind === 'none') return 'NO HOP';
  if (h.kind === 'onTime') return 'HOP WAS ON TIME';
  return `HOP WAS ${h.s.toFixed(2)} S ${h.kind === 'late' ? 'LATE' : 'EARLY'}`;
}

/**
 * @typedef {Object} CrashReportData  REG.LAST_CRASH (registry only).
 * @property {string|null} runId the run's id (RunRecord.id), so Game Over shows the line only for that run
 * @property {string} seed @property {number} biomeMask @property {number} x world px of the crash
 * @property {number} distM @property {string} cause @property {string|null} hazardId
 * @property {string} name killer name @property {string} verdict hop verdict ('' when not a hazard crash)
 * @property {string} line Game Over header line, e.g. "PACKET SPIKE AT 301 M - HOP WAS 0.21 S LATE".
 */

/**
 * @param {{runId?:string, seed:string, biomeMask?:number, cause:string, def?:Object, x:number, startX:number, pxPerMeter:number,
 *   lastHopMs?:number|null, arrivalMs?:number|null, crashMs:number}} o
 * @returns {CrashReportData}
 */
export function crashReport(o) {
  const name = killerName(o.cause, o.def);
  const isHazard = o.cause === 'hazard' && crashes(o.def);
  const arrival = Number.isFinite(o.arrivalMs) ? o.arrivalMs : o.crashMs;
  const verdict = isHazard ? verdictText(hopTiming(o.lastHopMs, arrival)) : '';
  const distM = Math.max(0, Math.floor((o.x - o.startX) / (o.pxPerMeter || 1)));
  return {
    runId: o.runId == null ? null : o.runId,
    seed: o.seed,
    biomeMask: o.biomeMask || 0,
    x: o.x,
    distM,
    cause: o.cause,
    hazardId: isHazard ? o.def.id : null,
    name,
    verdict,
    line: `${name} AT ${distM} M${verdict ? ` - ${verdict}` : ''}`,
  };
}

const smooth01 = (u) => { const c = u < 0 ? 0 : u > 1 ? 1 : u; return c * c * (3 - 2 * c); };

/**
 * @param {number} msSinceCrash real ms since the crash was decided.
 * @param {number} hitStopMs the existing crash hit-stop (TUNING.hitStopCrashMs).
 * @returns {{fxScale:number, zoomMul:number}}
 */
export function crashBeat(msSinceCrash, hitStopMs) {
  const t = Number.isFinite(msSinceCrash) ? msSinceCrash : 0;
  const fxScale = t < hitStopMs ? CRASH_BEAT.hitStopScale : t < hitStopMs + CRASH_BEAT.slowMs ? CRASH_BEAT.slowScale : 1;
  return { fxScale, zoomMul: 1 + CRASH_BEAT.zoomIn * smooth01((t - hitStopMs) / CRASH_BEAT.slowMs) };
}

/**
 * World x of the DIED HERE marker: the last crash, only on a retry of the same seed and mask.
 * @param {CrashReportData|null|undefined} lastCrash
 * @param {string} seed @param {number} [biomeMask]
 * @returns {number|null}
 */
export function deathMarkerX(lastCrash, seed, biomeMask) {
  if (!lastCrash || lastCrash.seed !== seed || (lastCrash.biomeMask || 0) !== (biomeMask || 0)) return null;
  return Number.isFinite(lastCrash.x) ? lastCrash.x : null;
}

/**
 * The Game Over header line for this record: only when the report is for this very run (same id) and it crashed.
 * @param {CrashReportData|null|undefined} lastCrash @param {{id?:string, cause?:string}|null|undefined} rec
 * @returns {string}
 */
export function gameOverLine(lastCrash, rec) {
  if (!lastCrash || !rec || rec.cause !== 'crash' || lastCrash.runId == null || lastCrash.runId !== rec.id) return '';
  return lastCrash.line || '';
}
