/** Developer-only QA data. Never referenced by production gameplay. */
export const BSOD_QA_PRESETS = Object.freeze({
  moderate: Object.freeze({ label: 'MODERATE', gapOffsetPx: 0, initialSpeedPxS: 250, accelFactor: 3 / 4, initialGapPx: 4500, accelerationPxS2: 3 }),
  buffered: Object.freeze({ label: 'BUFFERED STRONG', gapOffsetPx: 0, initialSpeedPxS: 300, accelFactor: 1, initialGapPx: 4500, accelerationPxS2: 4 }),
  soft: Object.freeze({ label: 'FAST APPROACH / SOFT FINISH', gapOffsetPx: 0, initialSpeedPxS: 300, accelFactor: 1, initialGapPx: 4500, accelerationPxS2: 4, softFinish: true }),
});
export function parseBsodQaQuery(search) {
  const q = new URLSearchParams(typeof search === 'string' ? search : '');
  const name = q.get('bsodQa');
  if (!Object.hasOwn(BSOD_QA_PRESETS, name)) return null;
  const rawSeed = q.get('qaSeed') || 'bsod-ab-01';
  const seed = /^[a-zA-Z0-9_-]{1,64}$/.test(rawSeed) ? rawSeed : 'bsod-ab-01';
  return Object.freeze({ name, seed, ...BSOD_QA_PRESETS[name] });
}
