/**
 * OWNER: core-logic engineer. NO imports: SaveStore reads these to sanitize settings without loading the ghost stack.
 * Cemetery Montage settings (issue #68, owner decision 2026-11-25).
 */

/** Owner default: keep the last 5 attempts per course. */
export const DEFAULT_ATTEMPT_KEEP = 5;
/**
 * Safe maximum attempts kept per course, shown to the player as the stepper's upper bound. A typical 30-90 s attempt
 * is 11-32 KB of Float32 poses (360 B/s), so a full course is ~0.4-1.3 MB; the renderer caps simultaneous riders
 * separately, so storing more never costs more frame time. See docs/ghosts/cemetery-montage.md.
 */
export const MAX_ATTEMPT_KEEP = 40;
/** 'montage' = a few labelled past selves; 'swarm' = every kept attempt, unlabelled; 'off' = no montage. */
export const MONTAGE_STYLES = Object.freeze(['montage', 'swarm', 'off']);
export const DEFAULT_MONTAGE_STYLE = 'montage';

/** A whole number of attempts in 0..MAX_ATTEMPT_KEEP; the default for anything that is not a finite number. */
export function sanitizeAttemptKeep(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_ATTEMPT_KEEP;
  return Math.max(0, Math.min(MAX_ATTEMPT_KEEP, Math.round(v)));
}

export function sanitizeMontageStyle(v) { return MONTAGE_STYLES.includes(v) ? v : DEFAULT_MONTAGE_STYLE; }
