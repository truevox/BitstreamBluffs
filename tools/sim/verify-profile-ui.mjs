#!/usr/bin/env node
/**
 * Headed check of the W1 screens: the badge and the PROFILE view as the browser actually draws them.
 *
 * Jest proves the layout model (positions, contrast, glyph coverage). This proves the RENDER: it
 * drives the real TitleScene and the real menu, then asserts on Phaser's resolved text bounds:
 *   - no two text boxes overlap, nothing spills outside the profile panel
 *   - the level badge sits left of the logo and above the menu panel
 *   - every character exists in the 5x7 font (otherwise PixelFont silently draws '?')
 *   - the palette swap repaints without moving a single box
 *   - the view opens from the PROFILE menu row and closes on cancel/confirm without starting a run
 *
 * Usage: node tools/sim/verify-profile-ui.mjs [outDir]
 * Exit code 1 on any failed assertion, so it can gate a commit.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const outDir = path.resolve(process.argv[2] || path.join(root, 'evidence/w1-shots'));
mkdirSync(outDir, { recursive: true });

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
};

let server;
let browser;
async function main() {
  // Dev server, not `vite preview`: the page-side probe imports live '/src/...' modules so it can call
  // the real ProfileView and PixelFont. Same server tools/sim/shots.mjs uses for evidence shots.
  const port = await new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
  server = spawn(path.join(root, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: root, env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) ready = true; } catch (e) { /* wait */ }
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error(`vite never answered on ${port}`);

  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript({ path: path.join(here, 'browser.js') });
  await page.addInitScript({ path: path.join(here, 'shots-page.js') });
  await page.addInitScript({ path: path.join(here, 'shots-probe-profile.js') });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__bbGame && window.__bbGame.scene.isActive('TitleScene'), null, { timeout: 60000 });

  const res = await page.evaluate((o) => window.__shotsProbe.run(o), { out: outDir });
  const t = res.title;
  const p = res.profile;

  // ---- Title badge ----
  check('title: badge drawn as two lines', t.sanity.badgeCount === 2, t.badgeTexts);
  check('title: badge clears the 4x logo', t.clearOfLogo === true, t.badgeBoxes);
  check('title: no text overlaps on the title screen', t.title.overlaps.length === 0, t.title.overlaps);
  check('title: every glyph exists in the 5x7 font',
    t.title.texts.every((x) => x.missing.length === 0),
    t.title.texts.filter((x) => x.missing.length).map((x) => [x.text, x.missing]));
  check('title: palette swap only repaints', t.colourblind.geometryIdentical === true, t.colourblind);

  // ---- Profile view ----
  check('profile: opens from the PROFILE menu row', p.viaMenu === true, p.route);
  check('profile: nothing overlaps inside the panel', p.profile.overlaps.length === 0, p.profile.overlaps);
  check('profile: no text escapes the panel', p.profile.clippedOutsidePanel.length === 0, p.profile.clippedOutsidePanel);
  check('profile: every glyph exists in the 5x7 font', p.profile.missingGlyphs.length === 0, p.profile.missingGlyphs);
  check('profile: has a BACK affordance', p.profile.hasBackButton === true);
  check('profile: is read-only', p.profile.readOnly === true);
  check('profile: palette swap only repaints', p.colourblind.geometryIdentical === true, p.colourblind);
  check('profile: cancel closes', p.closesOnCancel === true);
  check('profile: reopens from the menu', p.reopens === true);
  check('profile: confirm closes', p.closesOnConfirm === true);
  check('profile: closing never starts a run', p.stillOnTitle === true);
  check('profile: a fresh profile still renders a full panel',
    p.freshProfile.texts >= 30 && p.freshProfile.bad.length === 0
    && p.freshProfile.overlaps.length === 0 && p.freshProfile.clipped.length === 0, p.freshProfile);
  check('no uncaught page errors', errors.length === 0, errors);

  await page.screenshot({ path: path.join(outDir, 'w1-profile-view-page.png'), fullPage: false });
}

main()
  .catch((e) => {
    console.error(e);
    checks.push({ name: 'harness', pass: false, detail: String(e) });
  })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill('SIGTERM');
    const failed = checks.filter((c) => !c.pass);
    writeFileSync(path.join(outDir, 'verify-profile-ui.json'), JSON.stringify({ checks, failed: failed.length }, null, 1));
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    process.exitCode = failed.length ? 1 : 0;
  });
