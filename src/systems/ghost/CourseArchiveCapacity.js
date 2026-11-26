/**
 * #56: repeatably buy more DISTINCT seed+biome-mask course archives.
 * NEVER increase the five per-course Ghost Library display roles.
 * These are reversible pre-alpha tuning values selected by Friday, not a
 * previously established owner pricing decision or a trusted public entitlement.
 */
export const COURSE_ARCHIVE_VERSION = 1;
export const INCLUDED_COURSE_ARCHIVES = 8;
export const MAX_COURSE_ARCHIVE_RANK = 1_000_000;

const rankOk = n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_COURSE_ARCHIVE_RANK;
const floorOk = n => Number.isSafeInteger(n) && n >= INCLUDED_COURSE_ARCHIVES && n <= Number.MAX_SAFE_INTEGER - MAX_COURSE_ARCHIVE_RANK;

/** The persisted baseline includes legacy archives, never silently truncates them. */
export function sanitizeCourseArchive(input) {
  const o = input && typeof input === 'object' && !Array.isArray(input) && input.v === COURSE_ARCHIVE_VERSION ? input : {};
  return {v: COURSE_ARCHIVE_VERSION,
    included: floorOk(o.included) ? o.included : INCLUDED_COURSE_ARCHIVES,
    purchased: rankOk(o.purchased) ? o.purchased : 0,
    // Distinguishes an empty default saved during boot from a completed
    // migration. Power loss between those writes must not steal legacy slots.
    migrated: o.migrated === true};
}

export const archiveCapacity = profile => {
  const s = sanitizeCourseArchive(profile?.courseArchive);
  return s.included + s.purchased;
};

/** No implicit discount or zero-price wraparound on enormous ranks. */
export function nextArchiveSlotPrice(rank = 0) {
  if (!rankOk(rank) || rank === MAX_COURSE_ARCHIVE_RANK) return null;
  const cost = Math.ceil(40 + 12 * rank * (1 + rank / 8));
  return Number.isSafeInteger(cost) && cost > 0 ? cost : null;
}

/** Purchase against the current local Shard bank. Caller must persist atomically. */
export function purchaseArchiveSlot(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const state = sanitizeCourseArchive(profile.courseArchive);
  if (!Number.isSafeInteger(profile.bank) || profile.bank < 0) return profile;
  const cost = nextArchiveSlotPrice(state.purchased);
  if (cost == null || profile.bank < cost || !Number.isSafeInteger(state.included + state.purchased + 1)) return profile;
  return {...profile, bank: profile.bank - cost,
    courseArchive: {...state, purchased: state.purchased + 1}};
}

/** The first activation on a legacy device preserves its actual stored course count. */
export function grandfatherArchives(profile, actualCourseCount) {
  if (!Number.isSafeInteger(actualCourseCount) || actualCourseCount < 0) return profile;
  const state = sanitizeCourseArchive(profile?.courseArchive);
  // Existing purchased slots already cover part of the actual inventory.
  const included = Math.max(state.included, actualCourseCount - state.purchased);
  if (!floorOk(included)) return profile;
  return {...profile, courseArchive: {...state, included, migrated:true}};
}

/** Only a successfully loaded authoritative IDB inventory may complete the
 * legacy migration. A temporary storage outage must NOT durably stamp an
 * empty memory fallback as the old course count. Recheck on the next boot.
 */
export function activateCourseArchiveLimit(library, store) {
  if (library?.backend !== 'idb' || !(library.courses instanceof Map))
    return {ok:false,reason:'archive-inventory-unavailable',profile:store?.profile};
  const result = store.ensureCourseArchiveLegacy(library.courses.size);
  if (result.ok) library.setArchiveLimit(archiveCapacity(result.profile));
  return result;
}

/** Two-tabs may disagree on stale UI numbers; IDB performs the authoritative check. */
export function mayArchiveNewCourse(existingCount, limit) {
  return Number.isSafeInteger(existingCount) && existingCount >= 0 &&
    (limit === null || (Number.isSafeInteger(limit) && limit >= INCLUDED_COURSE_ARCHIVES && existingCount < limit));
}
