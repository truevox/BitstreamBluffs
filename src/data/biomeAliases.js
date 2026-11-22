/**
 * Legacy biome ids -> canonical ids (issue #65). "Debumont" was a misspelling of "Debutmont"; the rename keeps
 * old saves, replays and in-flight music packs working by resolving the legacy id wherever an id is read from
 * outside the shipped content (profile sanitize, music voice/asset lookup). Pure. No Phaser, no window.
 */
export const LEGACY_BIOME_ALIASES = Object.freeze({ debumont: 'debutmont' });

/**
 * The canonical biome id for `id`: a legacy alias resolves to its new id, anything else comes back unchanged.
 * @param {*} id
 * @returns {*}
 */
export function canonicalBiomeId(id) {
  return typeof id === 'string' && Object.hasOwn(LEGACY_BIOME_ALIASES, id) ? LEGACY_BIOME_ALIASES[id] : id;
}
