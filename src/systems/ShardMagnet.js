/**
 * OWNER: gameplay. NO Phaser imports. Pure.
 *
 * Shard Magnet (the black hole). While active, every shard within the pull radius drifts
 * toward the rider, faster the closer it gets, until the normal pickup radius takes it.
 * Strength never grows with time on screen: it comes from the MAGNET PULL permanent
 * upgrade (unlimited ranks, softcapped in PermanentUpgrades), as `magnetMul`.
 *
 * Placement lives here, not in TerrainGenerator: the generator's chunk output (golden-tested,
 * SPEC §9) must stay bit-identical for every existing seed. RunScene asks magnetSpawn() for
 * at most one extra pickup per chunk, from its own seeded stream.
 */
import { Rng } from './Rng.js';

/** Never below this share of the def's base chance, however far down the mountain (as for base pickups). */
const MAGNET_FLOOR_FRACTION = 0.4;

/**
 * The Shard Magnet pickup for one generated chunk, or null. Deterministic per seed and chunk
 * index; keeps clear of the chunk's hazards, gaps and other pickups.
 * @param {string} seed
 * @param {{index:number,startX:number,endX:number,hazards?:object[],gaps?:object[],powerups?:object[]}} chunk
 * @param {object} def the shardMagnet power-up def
 * @param {function(number):number} heightAt terrain surface y at world x
 * @param {number} ppm pixels per metre
 * @param {number} [spawnMul] MYRIAD MAGNETS multiplier on the chance (the result is capped at 0.95)
 * @returns {{defId:string,x:number,y:number}|null}
 */
export function magnetSpawn(seed, chunk, def, heightAt, ppm, spawnMul = 1) {
  if (!def || !chunk || !Number.isFinite(chunk.startX) || !Number.isFinite(chunk.endX)) return null;
  const rng = new Rng(String(seed)).fork(`shardMagnet/${chunk.index}`);
  const span = chunk.endX - chunk.startX - 400;
  if (!(span > 0)) return null;
  const x = Math.round(chunk.startX + 240 + rng.range(0, span));
  const lift = (def.radius || 10) + rng.range(26, 58);
  const sp = def.spawn || {};
  const base = Number.isFinite(sp.baseChance) ? sp.baseChance : 0.2;
  const decay = Number.isFinite(sp.distanceDecayM) ? sp.distanceDecayM : 2000;
  const mul = Number.isFinite(spawnMul) && spawnMul >= 1 ? spawnMul : 1;
  const chance = Math.min(0.95, mul * Math.max(base * MAGNET_FLOOR_FRACTION, base / (1 + x / ppm / decay)));
  if (!rng.chance(chance) || x <= 480) return null;
  for (const h of chunk.hazards || []) if (Math.abs(h.x - x) < 90) return null;
  for (const g of chunk.gaps || []) if (x > g.x0 - 80 && x < g.x1 + 40) return null;
  for (const p of chunk.powerups || []) if (Math.abs(p.x - x) < 120) return null;
  const y = heightAt(x);
  return Number.isFinite(y) ? { defId: def.id, x, y: y - lift } : null;
}

/** Shard Magnets start dropping at this Sync Level in ordinary runs (owner, 2026-11-20). */
export const MAGNET_MIN_SYNC_LEVEL = 5;

/**
 * Do magnets drop on this run? From Sync Level 5 in ordinary runs. Always in Daily runs (classic and
 * Draft): an official board must give every pilot the same pickups, whatever their level.
 */
export function magnetsDropFor({ level, daily = false } = {}) {
  return daily === true || (Number.isFinite(level) && level >= MAGNET_MIN_SYNC_LEVEL);
}

/** The hole hovers above and behind the rider (world px from the sled centre): visible, not hidden under the sprite. */
export const MAGNET_HOLE_OFFSET = Object.freeze({ x: -14, y: -34 });

/** World position of the hole for a sled at (x, y). */
export function magnetHolePos(x, y) {
  return { x: x + MAGNET_HOLE_OFFSET.x, y: y + MAGNET_HOLE_OFFSET.y };
}

/** Pull radius (px) and base pull speed (px/s) for an effect def and upgrade multiplier. */
export function magnetStrength(eff = {}, magnetMul = 1) {
  const mul = Number.isFinite(magnetMul) && magnetMul >= 1 ? magnetMul : 1;
  const radius = (Number.isFinite(eff.pullRadiusPx) ? eff.pullRadiusPx : 96) * mul;
  const speed = (Number.isFinite(eff.pullPxS) ? eff.pullPxS : 360) * mul;
  return { radius, speed, mul };
}

/**
 * New position of one shard pulled toward (x, y) for `dtMs`. Speed rises from 1x at the rim
 * to 3x at the centre; a shard never overshoots the rider.
 * @returns {{x:number,y:number}|null} null when the shard is outside the radius
 */
export function pullStep(sx, sy, x, y, radius, speedPxS, dtMs) {
  const dx = x - sx, dy = y - sy;
  const d = Math.hypot(dx, dy);
  if (!(d <= radius) || d === 0) return null;
  const step = Math.min(d, speedPxS * (1 + 2 * (1 - d / radius)) * (dtMs / 1000));
  return { x: sx + (dx / d) * step, y: sy + (dy / d) * step };
}
