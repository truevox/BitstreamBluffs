/**
 * OWNER: progression engineer. Pure. No Phaser, no window, no Math.random, no Date.now.
 *
 * Marvin decision 3 (audit ACH-3 / ACH-6): "Biome discovery means actually encountering the biome; track
 * unlocked, encountered, and completed separately."
 *
 *  - UNLOCKED   is the existing Sync Level unlock (ProfileStore.unlockedBiomeIds). Not stored here.
 *  - ENCOUNTERED: the sled's x reached a stretch the generator answers with that biome (`terrain.biomeAtX`), i.e.
 *                 past the arcade bridge that opens its sector when the previous sector was a different biome (#65).
 *  - COMPLETED:   the sled rode one of that biome's sectors from its start to its end (SECTOR_M, 500 m) and
 *                 the run's crash is not inside that sector.
 *
 * Arcade (a bridge) is glue, never a biome: it is not tracked. The home biome (Debutmont) is the base, so it is
 * encountered from sector 0 whatever the mask, and the mask-0 early return is gone. Completion stays
 * sector-based (the whole sector ridden, bridge included), so a sector that opens with a bridge still completes
 * its biome at the sector's end.
 *
 * Detection is a pure function of what a run saw: the terrain's own biome answer, the furthest x the sled reached
 * and the x of the run-ending crash. The sled only moves forward through sectors (a respawn never skips one), so
 * every sector from 0 to the furthest one was entered; "crossed the end of sector s" is "the furthest
 * sector is past s". Asking the generator (the same answer RunScene's BIOME_ENTER and palette use) means detection
 * and the drawn terrain can never disagree, bridge edges included.
 *
 * Only the run-ending crash voids a sector. A crash a Hashed Backup absorbs, or an opening-grace recovery,
 * does not: the run went on and the sled still rode the sector to its end. (Documented in ARCHITECTURE.)
 */
import { SECTOR_M } from './TerrainGenerator.js';
import { canonicalBiomeId } from '../data/biomeAliases.js';

/**
 * Every biome id the profile may record, in the level table's biomeOrder. A static list on purpose: the
 * profile sanitizer must not depend on whichever level table it was handed (the fallback table has an empty
 * biomeOrder, and sanitizing against it would erase every encounter on the next save). A test pins this
 * list to src/data/biomes and to levels.json biomeOrder, so it cannot drift from the content.
 */
export const BIOME_IDS = Object.freeze([
  'debutmont', 'garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain', 'crystal-cavern',
  'space-mountain', 'candy-cane-canyon', 'sky-jellyfish-mountain', 'steampunk-slopes', 'micro-mountain',
  'vertigo-vents',
]);

const EMPTY = () => ({ encountered: [], completed: [] });

/** Canonical order: BIOME_IDS index, then id (an id outside the list sorts after every known one). */
function canonical(ids) {
  const rank = (id) => {
    const i = BIOME_IDS.indexOf(id);
    return i < 0 ? BIOME_IDS.length : i;
  };
  return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 0-based sector of a world x. Same rule as TerrainGenerator._sectorOf (which is this plus one).
 * @param {number} x world px
 * @param {number} [pxPerMeter=20]
 * @returns {number}
 */
export function sectorOfX(x, pxPerMeter = 20) {
  const ppm = Number(pxPerMeter) > 0 ? Number(pxPerMeter) : 20;
  return Math.floor(Math.max(0, Number(x) || 0) / ppm / SECTOR_M);
}

/**
 * What one run encountered and completed.
 *
 * The biome at a position is the generator's own answer (`biomeAt`, normally `terrain.biomeAtX`), not arithmetic on
 * sectors: the generator rounds an arcade bridge to whole chunks and caps it, so any other rule disagrees with the
 * drawn terrain and BIOME_ENTER by up to a chunk. Each sector 0..furthest is probed once: at its last pixel for a
 * sector the sled rode through (a chunk straddling the next boundary is still that sector's biome there), at the
 * furthest x for the sector the sled ended in. A bridge answers null, so a run that ended inside one has not
 * entered the biome it leads to.
 * @param {{biomeAt:(xPx:number)=>(string|null), furthestX:number, crashX?:number|null, pxPerMeter?:number}} [o]
 *   biomeAt: the run's terrain answer at a world x, a biome id or null for an arcade bridge.
 *   furthestX: the furthest world x the sled reached. crashX: world x of the run-ending crash (null/absent:
 *   the run did not end in a crash inside the ridden ground).
 * @returns {{encountered:string[], completed:string[]}} canonical order; completed is a subset of encountered.
 */
export function detectBiomeVisits(o = {}) {
  const opts = o && typeof o === 'object' ? o : {};
  if (!Number.isFinite(opts.furthestX) || typeof opts.biomeAt !== 'function') return EMPTY();
  const ppm = Number(opts.pxPerMeter) > 0 ? Number(opts.pxPerMeter) : 20;
  const last = sectorOfX(opts.furthestX, ppm);
  const crashSector = Number.isFinite(opts.crashX) ? sectorOfX(opts.crashX, ppm) : -1;
  const encountered = [];
  const completed = [];
  for (let s = 0; s <= last; s++) {
    const probeX = s === last ? Math.max(0, opts.furthestX) : (s + 1) * SECTOR_M * ppm - 1;
    const id = opts.biomeAt(probeX);
    if (!id) continue;
    encountered.push(id);
    if (s < last && s !== crashSector) completed.push(id);
  }
  return { encountered: canonical(encountered), completed: canonical(completed) };
}

/**
 * The profile's stored biome progress, trusted only as far as known ids. Never throws.
 * Completed implies encountered, so a completed id missing from `encountered` is added there.
 * @param {*} raw
 * @returns {{encountered:string[], completed:string[]}}
 */
export function sanitizeBiomeProgress(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY();
  // A legacy id (issue #65) is read as its canonical id; `canonical` below dedupes if both spellings were saved.
  const known = (v) => (Array.isArray(v) ? v.map(canonicalBiomeId).filter((id) => typeof id === 'string' && BIOME_IDS.includes(id)) : []);
  const completed = canonical(known(raw.completed));
  const encountered = canonical([...known(raw.encountered), ...completed]);
  return { encountered, completed };
}

/**
 * Union a run's visits into stored progress. Pure: neither input is touched.
 * @param {*} progress stored {encountered, completed}
 * @param {*} visits a detectBiomeVisits result
 * @returns {{encountered:string[], completed:string[]}}
 */
export function mergeBiomeVisits(progress, visits) {
  const a = sanitizeBiomeProgress(progress);
  const b = sanitizeBiomeProgress(visits);
  return sanitizeBiomeProgress({
    encountered: [...a.encountered, ...b.encountered],
    completed: [...a.completed, ...b.completed],
  });
}
