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
 * #253: marker rendering must NEVER read the mutable terrain generator.
 * The physically joined Matter mesh retains the exact polyline it built
 * collision bodies from; sample that existing geometry with the identical
 * TerrainGenerator.heightAt segment formula, but without invoking _chunkAt,
 * changing _lastChunk, generating future chunks, or queuing terrain.
 *
 * At a shared boundary either joined neighbor has the same endpoint height.
 * Iterate the mesh's insertion order consistently and never request a chunk.
 * Return NaN until physically joined; the normal marker update defers drawing.
 * SIM8 release contract: rendering must not touch generator caches or queues.
 *
 * @param {number} x marker world coordinate
 * @param {Map<number,{startX:number,endX:number,points:{x:number,y:number}[]}>} joined
 *   actual Matter TerrainMesh.chunks, not speculative TerrainGenerator.activeList
 * @returns {number} unchanged geometry height, or NaN when unjoined/invalid
 */
export function joinedMarkerHeight(x, joined) {
  if (!Number.isFinite(x) || !joined || typeof joined.values !== 'function') return NaN;
  for (const chunk of joined.values()) {
    if (!chunk || !Number.isFinite(chunk.startX) || !Number.isFinite(chunk.endX) ||
        x < chunk.startX || x > chunk.endX) continue;
    const p = chunk.points;
    if (!Array.isArray(p) || p.length < 2) continue;
    const sp = p[1].x - p[0].x;
    if (!(sp > 0) || !Number.isFinite(sp)) continue;
    // Mirror TerrainGenerator._segIndex and heightAt: this is a read-only
    // interpolation over joined collider points, not a generator lookup.
    const i = Math.max(0, Math.min(p.length - 2, Math.floor((x - chunk.startX) / sp)));
    const a = p[i], b = p[i+1];
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x) ||
        !Number.isFinite(a.y) || !Number.isFinite(b.y) || !(b.x > a.x)) return NaN;
    return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return NaN;
}
