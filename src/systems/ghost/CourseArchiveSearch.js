/**
 * #84: a bounded local-only search over existing canonical course archives.
 * Searchable facts are the actual seed, biome mask and favorite references.
 * No generated hazard/jump/trick traits are assumed without replay evidence;
 * those require a separate reproducible physics-analysis follow-up.
 */
import { courseKey } from './GhostTape.js';

export const MAX_ARCHIVE_QUERY_LENGTH = 48;
export function normalizeArchiveSearch(value) {
  return typeof value === 'string' ? value.trim().slice(0,MAX_ARCHIVE_QUERY_LENGTH) : '';
}

/** @param {object[]} archives records from GhostLibrary.listArchiveCourses() */
export function searchArchiveCourses(archives, rawQuery = '') {
  if (!Array.isArray(archives)) return [];
  const query = normalizeArchiveSearch(rawQuery).toLowerCase();
  const favoriteQuery = query === '#favorites' || query === '#fav';
  const maskQuery = /^@([0-9]{1,10})$/.exec(query);
  const searchMask = maskQuery ? Number(maskQuery[1]) : null;
  const seen = new Set();
  const matches = [];
  for (const entry of archives) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.seed !== 'string' ||
      !entry.seed || !Number.isInteger(entry.biomeMask) || entry.biomeMask < 0 ||
      entry.biomeMask > 0xffffffff) continue;
    const identity = courseKey(entry.seed,entry.biomeMask);
    if (entry.key !== identity || seen.has(identity)) continue;
    seen.add(identity);
    const eligible = !query || favoriteQuery && Array.isArray(entry.favorites) && entry.favorites.some(Boolean) ||
      maskQuery && searchMask <= 0xffffffff && entry.biomeMask === searchMask ||
      !favoriteQuery && !maskQuery && entry.seed.toLowerCase().includes(query);
    if (eligible) matches.push(entry);
  }
  return matches;
}
