/**
 * OWNER: UI engineer.
 * Pure formatting helpers.
 */

/** @param {number} n @returns {string} integer with thousands separators. */
export function fmtInt(n) {
  n = Math.round(Number(n) || 0);
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `-${s}` : s;
}

/** @param {number} ms @returns {string} m:ss */
export function fmtClock(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** @param {number} ms @returns {string} seconds with one decimal, e.g. 1.4 */
export function fmtSec(ms) {
  return (Math.max(0, Number(ms) || 0) / 1000).toFixed(1);
}

/** @param {number} m @returns {string} e.g. 1.25 -> x1.25 */
export function fmtMult(m) {
  return `x${(Number(m) || 1).toFixed(2)}`;
}

const SEED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** UI-side random seed for a fresh run (not seed-dependent logic). @returns {string} 6 readable chars */
export function randomSeed() {
  let s = '';
  for (let i = 0; i < 6; i++) s += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
  return s;
}

/** @param {string} id camelCase id @returns {string} 'TUCK BOOST' style label. */
export function idToLabel(id) {
  return String(id || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toUpperCase();
}

/** Maximum length of leaderboard initials (design doc 6.2: 3 by default, configurable). */
export const INITIALS_LENGTH = 3;
