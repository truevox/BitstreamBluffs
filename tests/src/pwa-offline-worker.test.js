import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOfflineInventory, renderOfflineWorker, shouldPrecache, MAX_PRECACHE_BYTES } from '../../tools/pwa/build-offline-worker.mjs';

let tmp;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'bb-pwa-worker-')); });
afterEach(() => { rmSync(tmp, { force: true, recursive: true }); });
function put(path, content = 'a') {
  const file = join(tmp, path); mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}
function prepare() {
  put('index.html', '<html><script type="module" src="/assets/index-ABC.js"></script></html>');
  put('manifest.webmanifest', '{}'); put('favicon.ico', 'ICO'); put('music/catalog.json', '{"tracks":[]}'); put('music/transition-grids.json','{"tracks":{}}');
  put('assets/index-ABC.js', 'hello'); put('assets/menu/mountains.svg', 'vector');
  put('icons/bitstream-192.png', 'fake-png');
  put('music/packs/huge/performance.json', 'not offline');
  put('assets/index-ABC.js.map', 'sourcemap');
  put('docs/index.html', 'not offline');
}
test('includes coherent app assets but excludes huge/optional/third party content', async () => {
  prepare();
  const inv = await createOfflineInventory(tmp);
  expect(inv.entries.map(x => x.path)).toEqual([
    '/assets/index-ABC.js', '/assets/menu/mountains.svg', '/favicon.ico', '/icons/bitstream-192.png',
    '/index.html', '/manifest.webmanifest', '/music/catalog.json', '/music/transition-grids.json',
  ]);
  expect(inv.entries.every(x => /^[0-9a-f]{64}$/.test(x.sha256))).toBe(true);
  expect(shouldPrecache('music/packs/foo/performance.json')).toBe(false);
  expect(shouldPrecache('assets/index.js.map')).toBe(false);
  expect(shouldPrecache('docs/index.html')).toBe(false);
});
test('inventory and worker bytes are repeatable, and any included change rotates cache', async () => {
  prepare();
  const before = await createOfflineInventory(tmp);
  const again = await createOfflineInventory(tmp);
  expect(before).toEqual(again);
  expect(renderOfflineWorker(before)).toBe(renderOfflineWorker(again));
  put('assets/index-ABC.js', 'changed');
  const after = await createOfflineInventory(tmp);
  expect(after.version).not.toBe(before.version);
  expect(renderOfflineWorker(after)).not.toBe(renderOfflineWorker(before));
  expect(renderOfflineWorker(after)).not.toMatch(/self\.(?:skipWaiting|clients\.claim)\s*\(/);
  expect(renderOfflineWorker(after)).not.toMatch(/caches\.delete\(name\)/);
});
test('rejects mismatched HTML bundle and absent essential assets', async () => {
  prepare();
  put('index.html', '<script src="/assets/missing.js"></script>');
  await expect(createOfflineInventory(tmp)).rejects.toThrow(/uncached entry/);
  put('index.html', '<script type="module" src="/assets/index-ABC.js"></script>');
  rmSync(join(tmp, 'manifest.webmanifest'));
  await expect(createOfflineInventory(tmp)).rejects.toThrow(/missing essential/);
});
test('enforces a capped budget and avoids silently caching user/third party URLs', async () => {
  prepare();
  put('assets/too-big.png', Buffer.alloc(MAX_PRECACHE_BYTES));
  await expect(createOfflineInventory(tmp)).rejects.toThrow(/exceeds its 8 MiB/);
  expect(shouldPrecache('https://other.example/assets/logo.png')).toBe(false);
});

test('subpath inventory is scope-bound and rejects cross-scope HTML entries',async()=>{
  prepare();
  await expect(createOfflineInventory(tmp,'/BitstreamBluffs/')).rejects.toThrow(/uncached entry/);
  put('index.html','<script type="module" src="/BitstreamBluffs/assets/index-ABC.js"></script>');
  const inv=await createOfflineInventory(tmp,'/BitstreamBluffs/');
  expect(inv.base).toBe('/BitstreamBluffs/');
  expect(inv.entries.every(e=>e.path.startsWith(inv.base))).toBe(true);
  const worker=renderOfflineWorker(inv);
  expect(()=>new Function(worker)).not.toThrow();
  expect(worker).toContain('Offline worker scope mismatch');
  expect(worker).toContain('const BASE = "/BitstreamBluffs/"');
  expect(worker).not.toContain('function completeMusicGroup');
  for(const base of ['//other.example/','/foo/../','foo/','/foo'])await expect(createOfflineInventory(tmp,base)).rejects.toThrow(/deployment base/);
});

test('local candidate mono router is explicitly opt-in and generated scripts parse',()=>{
  const inv={base:'/BitstreamBluffs/',version:'a'.repeat(20),entries:[]};
  const normal=renderOfflineWorker(inv),pilot=renderOfflineWorker(inv,{monoDev:true});
  expect(normal).not.toContain('monoDevResponse');
  const cacheName=s=>s.match(/const CACHE_NAME = "([^"]+)"/)[1];
  expect(cacheName(normal)).not.toBe(cacheName(pilot));expect(pilot).toContain('monoDevResponse');
  expect(()=>new Function(normal)).not.toThrow();expect(()=>new Function(pilot)).not.toThrow();
});
