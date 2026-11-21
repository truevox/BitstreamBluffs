import { createHash, webcrypto } from 'node:crypto';
import { downloadRealSong, isRealSongDownloaded } from '../../tools/pwa/music-cache-prototype.mjs';

// The repository uses a jsdom canvas bootstrap. Provide a minimal fetch Response
// for the separate, test-only CacheStorage downloader without changing it.
const savedResponse = globalThis.Response;
class MemoryResponse {
  constructor(data, opts = {}) {
    this.buffer = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
    this.status = opts.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = opts.headers ?? {};
    this.type = 'basic';
    this.url = '';
  }
  clone() { return new MemoryResponse(this.buffer, { status: this.status, headers: this.headers }); }
  async arrayBuffer() { const x = Uint8Array.from(this.buffer); return x.buffer; }
  async text() { return this.buffer.toString('utf8'); }
}
beforeAll(() => { globalThis.Response = MemoryResponse; });
afterAll(() => { globalThis.Response = savedResponse; });

class FakeCache {
  constructor() { this.data = new Map(); }
  async match(url) { return this.data.get(url)?.clone(); }
  async put(url, response) { this.data.set(url, response.clone()); }
  async delete(url) { return this.data.delete(url); }
}
class FakeStorage {
  constructor() { this.data = new Map(); }
  async open(name) { if (!this.data.has(name)) this.data.set(name, new FakeCache()); return this.data.get(name); }
}
const origin = 'https://bitstream.example';
function songFrom(names) {
  return {
    id: 'song-a', version: '1'.repeat(20),
    entries: names.map((n) => ({ url: `/music/packs/a/${n}.ogg`, bytes: 1,
      sha256: createHash('sha256').update(n).digest('hex') })),
  };
}
function fakeFetch({ fail = null, corrupt = null, counter }) {
  return async (url) => {
    const name = url.split('/').at(-1).slice(0, -4);
    counter[name] = (counter[name] ?? 0) + 1;
    if (name === fail) throw new Error('Network unavailable');
    return new Response(name === corrupt ? 'BAD' : name, { status: 200 });
  };
}
const capabilities = (storage, fetcher) => ({ storage, origin, subtle: webcrypto.subtle, fetcher });

test('real stems are checksum-verified and only complete song receives ready marker', async () => {
  const storage = new FakeStorage(), counter = {}, song = songFrom(['a','b','c']);
  const args = capabilities(storage, fakeFetch({counter}));
  expect(await isRealSongDownloaded(song, args)).toBe(false);
  const updates = [];
  const result = await downloadRealSong(song, { ...args, onProgress: x => updates.push(x) });
  expect(result.status).toBe('ready');
  expect(updates.at(-1)).toMatchObject({ completed: 3, total: 3, bytesCompleted: 3, totalBytes: 3 });
  expect(await isRealSongDownloaded(song, args)).toBe(true);
  expect((await downloadRealSong(song, args)).status).toBe('already-ready');
  expect(counter).toEqual({a:1,b:1,c:1});
});

test('failed download is not ready; retry reuses valid stems and only fetches missing ones', async () => {
  const storage = new FakeStorage(), song = songFrom(['a','b','c']);
  const counter = {};
  const fail = capabilities(storage, fakeFetch({fail:'c',counter}));
  await expect(downloadRealSong(song, {...fail,concurrency:1})).rejects.toThrow(/Network unavailable/);
  expect(await isRealSongDownloaded(song, fail)).toBe(false);
  const passed = await downloadRealSong(song, {...fail,fetcher:fakeFetch({counter}),concurrency:1});
  expect(passed.status).toBe('ready');
  expect(passed.reused).toBe(2);
  expect(counter).toEqual({a:1,b:1,c:2});
});

test('corrupt or redirected audio never marks a song ready', async () => {
  const storage = new FakeStorage(), song = songFrom(['a','b']);
  await expect(downloadRealSong(song, capabilities(storage, fakeFetch({corrupt:'a',counter:{}})))).rejects.toThrow(/Mismatched/);
  expect(await isRealSongDownloaded(song, capabilities(storage, fakeFetch({counter:{}})))).toBe(false);
  await expect(downloadRealSong(song, capabilities(storage, async url=>{
    const response = new Response('a', {status:200});
    Object.defineProperty(response,'url',{value:'https://evil.example/somewhere'});
    return response;
  }))).rejects.toThrow(/redirected/);
});

test('incomplete cache cannot masquerade as ready after eviction', async () => {
  const storage = new FakeStorage(), counter = {}, song = songFrom(['a','b']);
  const args = capabilities(storage, fakeFetch({counter}));
  await downloadRealSong(song,args);
  const cache=await storage.open(`bb-real-music-v1-${song.id}-${song.version}`);
  cache.data.delete(`${origin}/music/packs/a/b.ogg`);
  expect(await isRealSongDownloaded(song,args)).toBe(false);
  const restored=await downloadRealSong(song,args);
  expect(restored.reused).toBe(1);
  expect(await isRealSongDownloaded(song,args)).toBe(true);
});
