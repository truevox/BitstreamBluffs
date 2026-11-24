// Test a production build at a canonical root or subdirectory URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const expectedVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
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
    // Phaser rasterizes SVG textures via local blob: URLs. They share the page's
    // origin but are not HTTP assets or deployment paths.
    if (!['http:', 'https:'].includes(u.protocol) || u.origin !== base.origin) return;
    requests.push(u.pathname);
    if (!u.pathname.startsWith(base.pathname) || r.status() >= 400) failures.push(`${r.status()} ${u.pathname}`);
  });
  page.on('requestfailed', r => {
    const u = new URL(r.url());
    if (['http:', 'https:'].includes(u.protocol) && u.origin === base.origin && r.failure()?.errorText !== 'net::ERR_ABORTED') failures.push(`${r.failure()?.errorText} ${u.href}`);
  });
  assert.equal((await page.goto(base.href)).status(), 200);
  await page.waitForFunction(() => window.__bbGame?.scene?.isActive('TitleScene'), null, {timeout: 60000});
  const readVersion = () => page.evaluate(() => {
    const label = window.__bbGame.scene.getScene('TitleScene').versionLabel;
    return {text: label?.main?.text, visible: label?.visible, alpha: label?.alpha, x: label?.x, y: label?.y};
  });
  const version = await readVersion();
  assert.equal(version.text, `v${expectedVersion}`);
  assert(version.visible && version.alpha === 1, 'startup version is fully visible');
  assert(version.x < 20 && version.y < 20, 'version is in the top-left corner');
  await page.waitForTimeout(1000);
  const heldVersion = await readVersion();
  assert(heldVersion.visible && heldVersion.alpha === 1, 'startup version holds before fade');
  await page.waitForFunction(() => {
    const label = window.__bbGame.scene.getScene('TitleScene').versionLabel;
    return label && !label.visible && label.alpha === 0;
  }, null, {timeout: 12000});
  assert.equal((await readVersion()).text, `v${expectedVersion}`);
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
