/** #172: pure, non-deployed offline recording groups and look-ahead selection.
 * All data refers to ORIGINAL compressed song recordings; no fallback audio. */
import { BIOME_IDS, HOME_BIOME } from '../../src/systems/music/BiomeVoices.js';
import { normalizeCatalog, normalizePack, resolveMusicAsset } from '../../src/systems/music/MusicPack.js';
import { plannedTrackIds } from './music-download-plan.mjs';

const MENU_BIOME = 'debumont';
const ALL_BIOMES = new Set(BIOME_IDS.filter(id => id !== HOME_BIOME));

function validateBiomeIds(ids) {
  if (!Array.isArray(ids)) throw new TypeError('Biome IDs must be an array');
  for (const id of ids) if (!ALL_BIOMES.has(id)) throw new Error(`Unknown biome: ${id}`);
  return new Set(ids);
}

export function currentlyNeededBiomes({ unlockedBiomeIds = [], enabledBiomeIds = [] } = {}) {
  const owned = validateBiomeIds(unlockedBiomeIds);
  const enabled = validateBiomeIds(enabledBiomeIds);
  // Debumont is used by menus before its gameplay unlock.
  return [MENU_BIOME, ...[...ALL_BIOMES].filter(id => id !== MENU_BIOME && owned.has(id) && enabled.has(id))];
}

/** Opportunistic lookahead: NEXT as-yet-locked biome, selected *before* unlock.
 * This is a bonus download, not a prerequisite to declare current music ready.
 * Caller enforces internet access, transfer consent, and idle/bandwidth budget. */
export function upcomingBiomePrefetch({ currentLevel, biomeDefs, unlockedBiomeIds = [] }) {
  if (!Number.isFinite(currentLevel) || currentLevel < 0 || !Array.isArray(biomeDefs)) {
    throw new TypeError('Current level and biome table required');
  }
  const unlocked = validateBiomeIds(unlockedBiomeIds);
  const candidates = biomeDefs
    .filter(x => x && ALL_BIOMES.has(x.id) && x.id !== MENU_BIOME && !unlocked.has(x.id) &&
      Number.isSafeInteger(x.unlockLevel) && x.unlockLevel > currentLevel)
    .sort((a,b) => a.unlockLevel - b.unlockLevel || a.id.localeCompare(b.id));
  return candidates.length ? [candidates[0].id] : [];
}

function entryPath(packUrl, relative) {
  const base = new URL(packUrl, 'https://offline.invalid/music/catalog.json');
  if (base.origin !== 'https://offline.invalid' || !/^\/music\/packs\/[^/]+\/pack\.json$/.test(base.pathname)) {
    throw new Error('Unsafe music pack manifest location');
  }
  const resolved = new URL(resolveMusicAsset(base, relative));
  const dir = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(dir)) throw new Error('Escaped music pack');
  return resolved.pathname;
}

export function songOfflineGroups(track, rawPack, {
  unlockedBiomeIds = [], enabledBiomeIds = [], dynamicOrchestra = false,
  prefetchBiomeIds = [],
} = {}) {
  const pack = normalizePack(rawPack);
  if (pack.id !== track.id) throw new Error('Song pack identifier mismatch');
  const owned = new Set(currentlyNeededBiomes({unlockedBiomeIds,enabledBiomeIds}));
  const preview = validateBiomeIds(prefetchBiomeIds);
  const songDir = new URL(track.manifest,'https://offline.invalid/music/catalog.json').pathname;
  if (!/^\/music\/packs\/[^/]+\/pack\.json$/.test(songDir)) throw new Error('Unexpected song manifest path');
  const core = new Set([songDir]);
  const lead = new Map();
  const alternate = new Map();
  for (const biome of new Set([...owned, ...preview])) {
    lead.set(biome, new Set());
    if (dynamicOrchestra) alternate.set(biome, new Set());
  }
  for (const seg of pack.segments) {
    for (const [name, relative] of Object.entries(seg.sources)) {
      if (name.startsWith('voice:') && name !== `voice:${HOME_BIOME}`) {
        const biome = name.slice('voice:'.length);
        if (lead.has(biome)) lead.get(biome).add(entryPath(track.manifest, relative));
      } else core.add(entryPath(track.manifest, relative));
    }
  }
  if (pack.captions) core.add(entryPath(track.manifest, pack.captions));
  if (dynamicOrchestra && pack.adaptive) {
    for (const variants of Object.values(pack.adaptive.variants)) {
      for (const [biome, files] of Object.entries(variants)) {
        if (alternate.has(biome)) for (const relative of files) alternate.get(biome).add(entryPath(track.manifest, relative));
      }
    }
  }
  const required = [{ id: `${track.id}:base`, kind: 'base', files: [...core].sort() }];
  const bonus = [];
  for (const [biome, files] of lead) {
    const to = owned.has(biome) ? required : bonus;
    to.push({ id:`${track.id}:lead:${biome}`, kind: 'lead', biome, files: [...files].sort() });
  }
  for (const [biome, files] of alternate) {
    if (!files.size) continue;
    const to = owned.has(biome) ? required : bonus;
    to.push({ id:`${track.id}:orchestra:${biome}`, kind: 'orchestra', biome, files: [...files].sort() });
  }
  return { songId:track.id, required, bonus };
}

export function selectedMusicGroupPlan(rawCatalog, packsById, {
  selection = {}, unlockedSongIds = null, unlockedBiomeIds = [], enabledBiomeIds = [],
  currentLevel = 1, biomeDefs = [], dynamicOrchestra = false, prefetchNextBiome = false,
} = {}) {
  const catalog = normalizeCatalog(rawCatalog);
  const active = new Set(plannedTrackIds(rawCatalog, selection, unlockedSongIds));
  const nextBiomes = prefetchNextBiome
    ? upcomingBiomePrefetch({currentLevel,biomeDefs,unlockedBiomeIds}) : [];
  const songs = catalog.tracks.filter(t => active.has(t.id)).map(t => {
    if (!packsById[t.id]) throw new Error(`Missing pack for active song: ${t.id}`);
    return songOfflineGroups(t, packsById[t.id], {
      unlockedBiomeIds,enabledBiomeIds,dynamicOrchestra,prefetchBiomeIds:nextBiomes,
    });
  });
  return { songs, nextBiomes, offlineReadyRequiresBonus:false };
}
