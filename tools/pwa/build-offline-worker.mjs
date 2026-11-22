/** #172 prototype: deterministic, integrity-checked standalone offline worker. NOT registered by the app. */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CACHE_PREFIX = 'bitstream-shell-v1-';
export const MAX_PRECACHE_BYTES = 8 * 1024 * 1024;
const EXPLICIT = new Set(['index.html', 'manifest.webmanifest', 'favicon.ico', 'music/catalog.json']);
const EXTENSIONS = /\.(?:js|css|svg|png|jpe?g|webp|gif|ico|woff2?)$/i;

export function shouldPrecache(relativePath) {
  const p = relativePath.replaceAll('\\', '/');
  if (EXPLICIT.has(p)) return true;
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

export async function createOfflineInventory(distDir) {
  const all = await listFiles(distDir);
  const selected = all.filter(shouldPrecache).sort();
  for (const name of EXPLICIT) {
    if (!selected.includes(name)) throw new Error(`Offline shell missing essential ${name}`);
  }
  if (!selected.some(p => /^assets\/[^/]+\.js$/.test(p))) {
    throw new Error('Offline shell needs at least one Vite entry bundle');
  }
  const html = await readFile(resolve(distDir, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)) {
    if (!selected.includes(match[1].slice(1))) throw new Error(`HTML references uncached entry: ${match[1]}`);
  }
  const entries = [];
  let total = 0;
  for (const name of selected) {
    const buf = await readFile(resolve(distDir, name));
    total += buf.length;
    if (total > MAX_PRECACHE_BYTES) throw new RangeError('Offline shell exceeds its 8 MiB cap; optional assets must not be cached');
    entries.push({ path: `/${name}`, sha256: sha256(buf), bytes: buf.length });
  }
  const version = sha256(Buffer.from(JSON.stringify(entries))).slice(0, 20);
  return { version, totalBytes: total, entries };
}

export function renderOfflineWorker(inventory) {
  const cacheName = CACHE_PREFIX + inventory.version;
  const paths = inventory.entries.map(x => [x.path, x.sha256]);
  return `/* Bitstream Bluffs #172: deterministic offline experiment. Deploy only when deliberately registered. */\n` +
`'use strict';\n` +
`const CACHE_NAME = ${JSON.stringify(cacheName)};\n` +
`const CACHE_PREFIX = ${JSON.stringify(CACHE_PREFIX)};\n` +
`const EXPECTED = new Map(${JSON.stringify(paths)});\n` +
`const ROOT = '/index.html';\n` +
`function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }\n` +
`self.addEventListener('install', event => {\n` +
`  event.waitUntil((async () => {\n` +
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
`  // No skipWaiting(), clients.claim(), or eager deletion of older caches.\n` +
`  // A prior-version client may still need its own assets during an active run.\n` +
`  // Version cache garbage collection requires a separate safe-boundary policy.\n` +
`  event.waitUntil(Promise.resolve());\n` +
`});\n` +
`self.addEventListener('fetch', event => {\n` +
`  const request = event.request;\n` +
`  if (request.method !== 'GET') return;\n` +
`  const url = new URL(request.url);\n` +
`  if (url.origin !== self.location.origin) return;\n` +
`  const path = url.pathname === '/' ? ROOT : url.pathname;\n` +
`  if (!EXPECTED.has(path)) return; // No runtime caching of music, user data or third-party assets.\n` +
`  event.respondWith((async () => {\n` +
`    const cache = await caches.open(CACHE_NAME);\n` +
`    const cached = await cache.match(new URL(path, self.location.origin));\n` +
`    if (cached) return cached;\n` +
`    if (request.mode === 'navigate') return new Response('<!doctype html><title>Bitstream Bluffs — offline files unavailable</title><h1>Offline files unavailable</h1><p>Reconnect and reload to repair the installation. Your local saved games are untouched.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });\n` +
`    return new Response('Offline files unavailable: reconnect to repair.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });\n` +
`  })());\n` +
`});\n`;
}

export async function generateOfflineWorker(distDir) {
  const inventory = await createOfflineInventory(distDir);
  const output = renderOfflineWorker(inventory);
  await writeFile(resolve(distDir, 'sw.js'), output);
  return inventory;
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const dir = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
  const inv = await generateOfflineWorker(dir);
  console.log(JSON.stringify({ path: resolve(dir, 'sw.js'), ...inv }, null, 2));
}
