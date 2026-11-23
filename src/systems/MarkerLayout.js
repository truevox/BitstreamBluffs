/**
 * OWNER: gameplay. Pure layout for the BEST and DIED HERE gate labels. Your best distance is often (nearly) where you
 * died, so the two poles stand a few px apart. When they are close, both labels are hung off the LEFT of the leftmost
 * pole (text extends away from the hazard that killed you, so the ground telegraph's column stays clear), stacked on
 * a shared baseline so neither text overprints the other and no pole crosses either text. Far apart, each label
 * stays centred over its own pole as before. No Phaser, no randomness.
 */

/** Gap (px) between the leftmost pole and the text hanging off it. */
export const LABEL_PAD = 6;
/** Poles closer than this (px) share a stacked label block; further apart, the labels cannot meet. */
export const NEAR_PX = 220;
/** Label heights above the terrain at the pole (px): the BEST gate is 90 tall, the DIED HERE gate 118. */
export const BEST_LABEL_RISE = 96;
export const DEATH_LABEL_RISE = 126;

/**
 * @typedef {{x:number, y:number, originX:number}} LabelPlacement world position of the label's bottom edge + text origin x.
 * @param {{x:number, y:number}|null} best BEST pole: world x and the terrain y it stands on (null when absent or y unknown).
 * @param {{x:number, y:number}|null} death DIED HERE pole, same shape.
 * @returns {{best: LabelPlacement|null, death: LabelPlacement|null}}
 */
export function layoutMarkerLabels(best, death) {
  const ok = (m) => !!m && Number.isFinite(m.x) && Number.isFinite(m.y);
  const own = (m, rise) => (ok(m) ? { x: m.x, y: m.y - rise, originX: 0.5 } : null);
  if (!ok(best) || !ok(death) || Math.abs(best.x - death.x) >= NEAR_PX) {
    return { best: own(best, BEST_LABEL_RISE), death: own(death, DEATH_LABEL_RISE) };
  }
  const x = Math.min(best.x, death.x) - LABEL_PAD;
  const base = Math.min(best.y, death.y); // the higher terrain point (smaller y): both labels clear both poles' ground
  return {
    best: { x, y: base - BEST_LABEL_RISE, originX: 1 },
    death: { x, y: base - DEATH_LABEL_RISE, originX: 1 },
  };
}


/**
 * #253: read a visual-only marker's ground height ONLY after its chunk has
 * already physically joined the authoritative terrain mesh. A marker may be
 * 2600px ahead of the rider, outside the normal simulation streaming window.
 * An unconditional TerrainGenerator.heightAt(marker.x) there invokes _chunkAt,
 * which mutates activeList/_pendingAdded and contaminates later session replays.
 *
 * Return NaN (markers already defer display on non-finite y) until joined.
 * This is a guard, not a new terrain generator or a fallback extrapolation.
 * The height function is NEVER called for absent/unjoined chunks.
 *
 * @param {number} x marker world coordinate
 * @param {Map<number,{startX:number,endX:number}>} joined actual mesh.chunks
 * @param {(x:number)=>number} heightAt exact registered terrain height function
 */
export function joinedMarkerHeight(x, joined, heightAt) {
  if (!Number.isFinite(x) || !joined || typeof joined.values !== 'function' || typeof heightAt !== 'function') return NaN;
  for (const chunk of joined.values()) {
    if (chunk && Number.isFinite(chunk.startX) && Number.isFinite(chunk.endX)
        && x >= chunk.startX && x <= chunk.endX) return heightAt(x);
  }
  return NaN;
}
