// Test a production build at a canonical root or subdirectory URL.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = new URL(process.argv[2]);
assert(base.pathname.endsWith('/'));
const browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage();
  const failures = [], requests = [];
  page.on('pageerror', e => failures.push(String(e)));
  page.on('response', r => {
    const u = new URL(r.url());
    if (u.origin !== base.origin) return;
    requests.push(u.pathname);
    if (!u.pathname.startsWith(base.pathname) || r.status() >= 400) failures.push(`${r.status()} ${u.pathname}`);
  });
  assert.equal((await page.goto(base.href)).status(), 200);
  await page.waitForFunction(() => window.__bbGame?.scene?.isActive('TitleScene'), null, {timeout: 60000});
  await page.waitForFunction(() => window.__bbGame?.registry?.get('audioSynth')?._stemMusic?.ready, null, {timeout: 30000});
  assert(requests.includes(base.pathname + 'music/catalog.json'), 'actual game loaded music catalog');
  const assets = await page.evaluate(async () => {
    const manifestURL = document.querySelector('link[rel=manifest]').href;
    const get = async url => { const r = await fetch(url); if (!r.ok) throw Error(`${r.status} ${url}`); return r.json(); };
    const manifest = await get(manifestURL);
    const catalogURL = new URL('music/catalog.json', location.href);
    const catalog = await get(catalogURL);
    const packURL = new URL(catalog.tracks[0].manifest, catalogURL);
    await get(packURL);
    await Promise.all(manifest.icons.map(async icon => {
      const r = await fetch(new URL(icon.src, manifestURL)); if (!r.ok) throw Error(`Icon ${r.status}`);
    }));
    return { scope: new URL(manifest.scope, manifestURL).href, start: new URL(manifest.start_url, manifestURL).href, tracks: catalog.tracks.length };
  });
  assert.equal(assets.scope, base.href);
  assert.equal(assets.start, base.href);
  assert(assets.tracks > 0);
  await page.evaluate(() => window.__bbGame.scene.getScene('TitleScene').startRun('hosting-smoke'));
  await page.waitForFunction(() => window.__bbGame?.scene?.isActive('RunScene'), null, {timeout: 30000});
  assert(requests.some(p => p.startsWith(base.pathname + 'assets/menu/')), 'menu artwork requested');
  assert.deepEqual(failures, []);
  console.log(`PASS ${base.href}: title, run, manifest, icons, ${assets.tracks} tracks; ${requests.length} same-origin responses`);
} finally { await browser.close(); }
