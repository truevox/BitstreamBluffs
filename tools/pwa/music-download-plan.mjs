/** #172 prototype: track-selective, real-recording offline music inventory.
 * This is a pure planning module; no runtime registration/download side effects. */
import { normalizeCatalog, normalizePack, resolveMusicAsset } from '../../src/systems/music/MusicPack.js';

function unlocked(trackId, unlockedSongIds) {
  // Current production game has no song-level locks: only the vocals feature
  // has a progression entitlement. An explicit future song-unlock list can
  // restrict what is required, without inventing a lock from `musicVocals`.
  if (unlockedSongIds == null) return true;
  if (!(unlockedSongIds instanceof Set) && !Array.isArray(unlockedSongIds)) {
    throw new TypeError('Unlocked song IDs must be a Set or array when supplied');
  }
  return unlockedSongIds instanceof Set ? unlockedSongIds.has(trackId) : unlockedSongIds.includes(trackId);
}

export function plannedTrackIds(rawCatalog, selection = {}, unlockedSongIds = null) {
  const { tracks } = normalizeCatalog(rawCatalog);
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new TypeError('Invalid song selection');
  return tracks.filter(track => unlocked(track.id, unlockedSongIds) && selection[track.id] !== false).map(track => track.id);
}

export function trackMusicFiles(track, rawPack) {
  const pack = normalizePack(rawPack);
  if (pack.id !== track.id) throw new Error(`Song pack ID mismatch for ${track.id}`);
  const manifest = new URL(track.manifest, 'https://offline.invalid/music/catalog.json');
  if (manifest.origin !== 'https://offline.invalid' || !manifest.pathname.startsWith('/music/packs/')) {
    throw new Error(`Unsafe song-pack path for ${track.id}`);
  }
  const base = manifest.href;
  const paths = new Set([manifest.pathname]);
  const add = (path) => {
    const dest = resolveMusicAsset(base, path);
    const url = new URL(dest);
    if (url.origin !== manifest.origin || !url.pathname.startsWith(manifest.pathname.slice(0, manifest.pathname.lastIndexOf('/') + 1))) {
      throw new Error('Song asset escaped its own pack');
    }
    paths.add(url.pathname);
  };
  for (const segment of pack.segments) {
    for (const path of Object.values(segment.sources)) add(path);
  }
  if (pack.adaptive) {
    for (const byBiome of Object.values(pack.adaptive.variants)) {
      for (const paths of Object.values(byBiome)) for (const path of paths) add(path);
    }
  }
  if (pack.captions) add(pack.captions);
  return [...paths].sort();
}

/** Return the exact per-song candidate URLs. Actual audio cache must hash/check
 * every response and only mark that song ready after its entire bundle lands. */
export function makeSelectedMusicPlan(rawCatalog, packsById, selection = {}, unlockedSongIds = null) {
  const { tracks } = normalizeCatalog(rawCatalog);
  const ids = new Set(plannedTrackIds(rawCatalog, selection, unlockedSongIds));
  const songs = tracks.filter(track => ids.has(track.id)).map(track => {
    const pack = packsById[track.id];
    if (!pack) throw new Error(`Missing pack for enabled unlocked song: ${track.id}`);
    return { id: track.id, title: track.title, files: trackMusicFiles(track, pack) };
  });
  return { catalogFile: '/music/catalog.json', songs };
}

export function musicOfflineStatus(rawCatalog, selection, unlockedSongIds, cachedCompleteSongIds) {
  const { tracks } = normalizeCatalog(rawCatalog);
  const cached = cachedCompleteSongIds instanceof Set ? cachedCompleteSongIds : new Set(cachedCompleteSongIds ?? []);
  const enabled = new Set(plannedTrackIds(rawCatalog, selection, unlockedSongIds));
  const songs = tracks.map(track => ({
    id: track.id,
    status: !unlocked(track.id, unlockedSongIds) ? 'locked' : selection?.[track.id] === false ? 'disabled' : cached.has(track.id) ? 'ready' : 'download-required',
  }));
  return { ready: songs.every(song => song.status !== 'download-required'), songs };
}

/** Inspect a production pack directory without copying/re-encoding the original
 * Ogg stems. This inventory is build evidence; nothing is fetched at runtime. */
export async function makeIntegrityMusicManifest(publicRoot, rawCatalog, packsById, selection = {}, unlockedSongIds = null) {
  const [{ createHash }, { createReadStream }, { stat }, { resolve }] = await Promise.all([
    import('node:crypto'), import('node:fs'), import('node:fs/promises'), import('node:path'),
  ]);
  const plan = makeSelectedMusicPlan(rawCatalog, packsById, selection, unlockedSongIds);
  const songs = [];
  for (const song of plan.songs) {
    let totalBytes = 0;
    const entries = [];
    for (const url of song.files) {
      if (!url.startsWith('/music/packs/') || url.includes('..')) throw new Error('Unsafe offline music file path');
      const path = resolve(publicRoot, url.slice(1));
      const info = await stat(path);
      if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty audio asset: ${url}`);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      entries.push({ url, bytes: info.size, sha256: hash.digest('hex') });
      totalBytes += info.size;
    }
    const digest = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
    songs.push({ id: song.id, title: song.title, version: digest.slice(0, 20), totalBytes, entries });
  }
  return { format: 'bb-offline-music-integrity-v1', catalogFile: plan.catalogFile, songs };
}
