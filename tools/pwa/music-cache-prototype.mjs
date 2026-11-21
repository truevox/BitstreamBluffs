/** #172 experimental browser CacheStorage staging for original, selected song assets.
 * No application calls this module. It never replaces the stem music engine. */
export const SONG_CACHE_PREFIX = 'bb-real-music-v1-';

function assertSong(song) {
  if (!song || !/^[a-zA-Z0-9:_-]{1,100}$/.test(song.id) || !/^[a-f0-9]{20}$/.test(song.version) ||
      !Array.isArray(song.entries) || song.entries.length === 0 || song.entries.length > 15000) {
    throw new TypeError('Invalid offline song inventory');
  }
  const seen = new Set(), logical = new Set();
  const quality = song.quality;
  if (quality !== undefined &&
      (!['lite','full'].includes(quality) || song.id !== `${song.originalId}:${quality}` ||
       typeof song.songId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(song.songId))) {
    throw new TypeError('Unrecognized tiered group');
  }
  for (const entry of song.entries) {
    const actual=entry?.url,original=entry?.logicalUrl??actual;
    if (typeof actual !== 'string' || typeof original !== 'string' ||
        !/^\/music\/packs\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+$/.test(original) ||
        original.includes('..') || actual.includes('..') || actual.includes('?') ||
        actual.includes('#') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) || seen.has(actual) || logical.has(original)) {
      throw new TypeError('Invalid or duplicate song asset');
    }
    if (quality === undefined ? actual !== original :
        original.endsWith('.ogg')
          ? actual !== `/music-variants/${quality}${original.slice('/music'.length)}`
          : actual !== original) {
      throw new TypeError('Tiered recording has unexpected physical URL');
    }
    seen.add(actual);logical.add(original);
  }
}

export function songCacheName(song) {
  assertSong(song);
  return `${SONG_CACHE_PREFIX}${song.id}-${song.version}`;
}

function integrityUrl(song, origin) {
  return new URL(`/.bitstream/offline-music-integrity/${encodeURIComponent(song.id)}/${song.version}`, origin).href;
}

function completionUrl(song, origin) {
  return new URL(`/.bitstream/offline-music-complete/${encodeURIComponent(song.id)}/${song.version}`, origin).href;
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function validStored(cache, entry, origin, subtle) {
  const response = await cache.match(new URL(entry.url, origin).href);
  if (!response || !response.ok) return false;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== entry.bytes) return false;
  return hex(await subtle.digest('SHA-256', bytes)) === entry.sha256;
}

export async function isRealSongDownloaded(song, { storage, origin, subtle }) {
  assertSong(song);
  const cache = await storage.open(songCacheName(song));
  const marker = await cache.match(completionUrl(song, origin));
  if (!marker?.ok || await marker.text() !== `${song.id}:${song.version}`) return false;
  // The router needs this manifest as well as the marker and audio bytes.
  // CacheStorage can evict individual entries; don't advertise 'ready' unless
  // both control records and every SHA-256-validated stem are present.
  const inventory = await cache.match(integrityUrl(song, origin));
  if (!inventory?.ok) return false;
  let manifest;
  try { manifest = await inventory.json(); } catch { return false; }
  if (manifest?.id !== song.id || manifest?.version !== song.version ||
      JSON.stringify(manifest.entries) !== JSON.stringify(song.entries)) return false;
  for (const entry of song.entries) {
    if (!await validStored(cache, entry, origin, subtle)) return false;
  }
  return true;
}

/** Cache a *selected, unlocked* song after the caller has asked for an offline
 * download. SHA-256 validation is mandatory per resource, not a mere ETag.
 * Partial downloads are safe to resume: no ready marker is created until all
 * required real recordings are complete. Old song versions are retained. */
export async function downloadRealSong(song, {
  storage, origin, subtle, fetcher, onProgress = () => {}, concurrency = 4, signal,
}) {
  assertSong(song);
  if (!storage?.open || !subtle?.digest || !fetcher || !/^https?:\/\//.test(origin) ||
      !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new TypeError('Invalid downloader capabilities');
  }
  const name = songCacheName(song);
  const cache = await storage.open(name);
  if (await isRealSongDownloaded(song, { storage, origin, subtle })) {
    return { status: 'already-ready', id: song.id, count: song.entries.length };
  }
  await cache.delete(completionUrl(song, origin));
  let next = 0, completed = 0, bytesCompleted = 0, reused = 0;
  let firstFailure = null;
  const totalBytes = song.entries.reduce((a, e) => a + e.bytes, 0);
  async function worker() {
    while (next < song.entries.length && !firstFailure) {
      const entry = song.entries[next++];
      try {
        if (signal?.aborted) throw new Error('Song download aborted');
        if (await validStored(cache, entry, origin, subtle)) {
          reused++;
        } else {
          const url = new URL(entry.url, origin);
          if (url.origin !== new URL(origin).origin) throw new Error('Nonlocal song asset URL');
          const response = await fetcher(url.href, {
            cache: 'no-store', redirect: 'error', credentials: 'same-origin', signal,
          });
          if (!response.ok || response.type === 'opaque' ||
              (response.url && new URL(response.url).href !== url.href)) {
            throw new Error('Unexpected or redirected song asset response: ' + entry.url);
          }
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength !== entry.bytes ||
              hex(await subtle.digest('SHA-256', bytes)) !== entry.sha256) {
            throw new Error('Mismatched real-song asset: ' + entry.url);
          }
          await cache.put(url.href, new Response(bytes, { status: 200, headers: response.headers }));
        }
        completed++;
        bytesCompleted += entry.bytes;
        onProgress({ id: song.id, completed, total: song.entries.length, bytesCompleted, totalBytes, reused });
      } catch (error) {
        firstFailure ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, song.entries.length) }, () => worker()));
  if (firstFailure) throw firstFailure;
  // A ready marker is the *last* write. A failed write or quota rejection means
  // the player is NOT offline-ready, but previous validated files can resume.
  // Store the exact checksummed inventory before writing the final ready
  // marker, so the test-only worker can verify complete groups atomically.
  await cache.put(integrityUrl(song, origin), new Response(JSON.stringify({
    id:song.id,version:song.version,entries:song.entries,
    ...(song.quality ? {quality:song.quality,songId:song.songId,originalId:song.originalId} : {}),
  }),{ status:200, headers:{'Content-Type':'application/json','Cache-Control':'no-store'} }));
  await cache.put(completionUrl(song, origin), new Response(`${song.id}:${song.version}`, {
    status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  }));
  return { status: 'ready', id: song.id, count: completed, totalBytes, reused };
}
