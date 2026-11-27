/** Deterministic, integrity-checked offline worker for explicitly PWA-enabled builds. */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMusicRouteWorker } from './music-route-worker.mjs';
import { renderR2RouteWorker } from './r2-cache.mjs';
import { renderMonoDevRouter } from './r2-mono-dev-cache.mjs';
import { renderMelodyTierRouter } from './melody-tier-cache.mjs';
import { renderCooperativeUpdateWorker } from './cooperative-update-worker.mjs';

export const CACHE_PREFIX = 'bitstream-shell-v1-';
export const MAX_PRECACHE_BYTES = 8 * 1024 * 1024;
// Transition grids are tiny real soundtrack metadata requested during gameplay.
// They must be available to an offline run, not silently fetched from network.
const EXPLICIT = new Set(['index.html', 'manifest.webmanifest', 'favicon.ico', 'music/catalog.json', 'music/transition-grids.json', 'tools/museum-of-bad-physics.html']);
const EXTENSIONS = /\.(?:js|css|svg|png|jpe?g|webp|gif|ico|woff2?)$/i;

export function shouldPrecache(relativePath) {
  const p = relativePath.replaceAll('\\', '/');
  if (EXPLICIT.has(p) || p === 'offline-melody-index.bin') return true;
  if (!EXTENSIONS.test(p)) return false;
  // Vite hashed bundles and first-party image assets only. Never cache raw
  // performance packs, third-party audio, music catalogs, docs or source maps.
  if (p.startsWith('assets/')) return true;
  if (p.startsWith('icons/')) return true;
  if (p.startsWith('music/billboard/') || p.startsWith('music/thumbnails/')) return true;
  return false;
}

async function listFiles(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(resolve(dir, prefix), { withFileTypes: true })) {
    const p = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(dir, p));
    else if (entry.isFile()) files.push(p);
    else throw new TypeError(`Unexpected symlink/non-file in dist: ${p}`);
  }
  return files;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function checkedBase(base) {
  if(typeof base!=='string'||!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))throw new TypeError('Expected absolute deployment base ending in /');
  return base;
}

export async function createOfflineInventory(distDir, base = '/') {
  checkedBase(base);
  const all = await listFiles(distDir);
  const selected = all.filter(shouldPrecache).sort();
  for (const name of EXPLICIT) {
    if (!selected.includes(name)) throw new Error(`Offline shell missing essential ${name}`);
  }
  if (!selected.some(p => /^assets\/[^/]+\.js$/.test(p))) {
    throw new Error('Offline shell needs at least one Vite entry bundle');
  }
  const html = await readFile(resolve(distDir, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)) {
    const url=new URL(match[1], 'https://offline.invalid'+base);
    if(url.origin!=='https://offline.invalid'||!url.pathname.startsWith(base)||!selected.includes(url.pathname.slice(base.length)))
      throw new Error(`HTML references uncached entry: ${match[1]}`);
  }
  const entries = [];
  let total = 0;
  for (const name of selected) {
    const buf = await readFile(resolve(distDir, name));
    total += buf.length;
    if (total > MAX_PRECACHE_BYTES) throw new RangeError('Offline shell exceeds its 8 MiB cap; optional assets must not be cached');
    entries.push({ path: `${base}${name}`, sha256: sha256(buf), bytes: buf.length });
  }
  const version = sha256(Buffer.from(JSON.stringify(entries))).slice(0, 20);
  return { version, base, totalBytes: total, entries };
}

export function renderOfflineWorker(inventory, {monoDev=false,melodyDev=false} = {}) {
  const base = checkedBase(inventory.base);
  const cacheToken = '__BB_SHELL_CACHE_ID__';
  const paths = inventory.entries.map(x => [x.path, x.sha256]);
  const script = `/* Bitstream Bluffs: integrity-checked versioned offline shell. */\n` +
`'use strict';\n` +
`const CACHE_NAME = ${JSON.stringify(cacheToken)};\n` +
`const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};\n` +
`const EXPECTED = new Map(${JSON.stringify(paths)});\n` +
`const BASE = ${JSON.stringify(base)};\n` +
`const ROOT = BASE + 'index.html';\n` +
(base === '/' ? renderMusicRouteWorker() : '') +
renderR2RouteWorker() +
(monoDev ? renderMonoDevRouter() : '') +
(melodyDev ? renderMelodyTierRouter() : '') +
renderCooperativeUpdateWorker() +
`function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }\n` +
`self.addEventListener('install', event => {\n` +
`  event.waitUntil((async () => {\n` +
`    if(new URL(self.registration.scope).pathname!==BASE) throw new Error('Offline worker scope mismatch');\n` +
`    const cache = await caches.open(CACHE_NAME);\n` +
`    try {\n` +
`      for (const [path, expected] of EXPECTED) {\n` +
`        const url = new URL(path, self.location.origin);\n` +
`        const response = await fetch(url, { cache: 'no-store', redirect: 'error', credentials: 'same-origin' });\n` +
`        if (!response.ok || response.type !== 'basic' || new URL(response.url).origin !== self.location.origin) throw new Error('Bad offline shell asset: ' + path);\n` +
`        const actual = hex(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer()));\n` +
`        if (actual !== expected) throw new Error('Stale or mismatched offline shell asset: ' + path);\n` +
`        await cache.put(url, response);\n` +
`      }\n` +
`    } catch (error) { await caches.delete(CACHE_NAME); throw error; }\n` +
`  })());\n` +
`});\n` +
`self.addEventListener('activate', event => {\n` +
`  // No unconditional activation, client claiming, or eager cache deletion.\n` +
`  // A prior-version client may still need its own assets during an active run.\n` +
`  // Version cache garbage collection requires a separate safe-boundary policy.\n` +
`  event.waitUntil(Promise.resolve());\n` +
`});\n` +
`self.addEventListener('fetch', event => {\n` +
`  const request = event.request;\n` +
`  if (request.method !== 'GET') return;\n` +
`  const url = new URL(request.url);\n` +
`  if (updateGate && request.mode === 'navigate' && url.origin === self.location.origin && url.pathname.startsWith(BASE)) {\n` +
`    event.respondWith(new Response('<!doctype html><meta http-equiv="refresh" content="2"><title>Updating Bitstream Bluffs</title><p>Updating Bitstream Bluffs…</p>', {headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}));return;\n` +
`  }\n` +
`  if (request.mode === 'cors' && releaseUrl(url.href) && !request.headers.has('Range')) {\n` +
`    event.respondWith((async()=>{` +
(melodyDev ? `const melody=await melodyTierResponse(url.href,event.clientId);if(melody!==undefined)return melody;` : '') +
(monoDev ? `if(url.pathname.endsWith('.ogg')){const candidate=await monoDevResponse(url.href);if(candidate!==undefined)return candidate;}` : '') +
`const stored=await cachedR2(url.href);if(stored)return stored;try{return await fetch(request);}catch{return new Response('Original music download required when online.',{status:503});}})());return;\n` +
`  }\n` +
`  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;\n` +
`  const path = url.pathname === BASE ? ROOT : url.pathname;\n` +
`  if (BASE === '/' && path.startsWith('/music/packs/')) {\n` +
`    event.respondWith((async()=> {\n` +
`      const stored=await realMusicFromCache(path);\n` +
`      if(stored)return stored;\n` +
`      try { return await fetch(request); } catch {\n` +
`        return new Response('Original music download required when online.',{status:503,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});\n` +
`      }\n` +
`    })());\n` +
`    return;\n` +
`  }\n` +
`  if (!EXPECTED.has(path)) return; // No runtime caching of user data or third-party assets.\n` +
`  event.respondWith((async () => {\n` +
`    const cache = await caches.open(CACHE_NAME);\n` +
`    const cached = await cache.match(new URL(path, self.location.origin));\n` +
`    if (cached) return cached;\n` +
`    if (request.mode === 'navigate') return new Response('<!doctype html><title>Bitstream Bluffs — offline files unavailable</title><h1>Offline files unavailable</h1><p>Reconnect and reload to repair the installation. Your local saved games are untouched.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });\n` +
`    return new Response('Offline files unavailable: reconnect to repair.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });\n` +
`  })());\n` +
`});\n`;
  // Bind cache identity to exact worker behavior as well as the shell assets.
  const version = sha256(Buffer.from(JSON.stringify([inventory.version,script]))).slice(0,20);
  return script.replace(cacheToken,CACHE_PREFIX+version);
}

export async function generateOfflineWorker(distDir, base = '/', options = {}) {
  const inventory = await createOfflineInventory(distDir, base);
  const output = renderOfflineWorker(inventory, options);
  await writeFile(resolve(distDir, 'sw.js'), output);
  return inventory;
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const dir = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
  const inv = await generateOfflineWorker(dir, process.argv[3] || '/');
  console.log(JSON.stringify({ path: resolve(dir, 'sw.js'), ...inv }, null, 2));
}
