#!/usr/bin/env node
/**
 * Screenshot driver for the real game (vite + headless Chromium, deviceScaleFactor 2, HUD scene running).
 *   node tools/sim/shots.mjs hints  <outDir>     tutorial hints: keyboard (natural run), push (stall), touch / gamepad labels
 *   node tools/sim/shots.mjs zoom   <outDir>     speed-zoom views and warning-time table (scenario in shots-zoom.js)
 * Scenarios live page-side in shots-page.js; they await window.__shot(name, meta) which saves <outDir>/<name>.png.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [mode, outDirArg, optsArg] = process.argv.slice(2);
const outDir = path.resolve(outDirArg || '.');
mkdirSync(outDir, { recursive: true });
const opts = optsArg ? JSON.parse(optsArg) : {};

const port = await new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const vite = spawn(path.join(root, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: root, env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 300; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch (e) { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
  browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.addInitScript({ path: path.join(here, 'browser.js') });
  await page.addInitScript({ path: path.join(here, 'shots-page.js') });
  await page.addInitScript({ path: path.join(here, 'shots-zoom.js') });
  const shots = [];
  await page.exposeFunction('__shot', async (name, meta) => {
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    shots.push({ file, meta });
    console.log('shot', file, JSON.stringify(meta));
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__bbGame && window.__bbGame.scene.isActive('TitleScene'), null, { timeout: 60000 });
  const run = async (fn, arg) => page.evaluate(([f, a]) => window.__shots[f](a), [fn, arg]);
  const result = {};
  if (mode === 'hints') {
    result.natural = await run('hintsNatural', opts);
    await page.reload(); await page.waitForFunction(() => window.__bbGame && window.__bbGame.scene.isActive('TitleScene'), null, { timeout: 60000 });
    result.push = await run('hintPush', opts);
    await page.reload(); await page.waitForFunction(() => window.__bbGame && window.__bbGame.scene.isActive('TitleScene'), null, { timeout: 60000 });
    result.modes = await run('hintsModes', opts);
  } else if (mode === 'pushRelease') {
    result.push = await run('hintPush', { ...opts, release: true });
  } else if (mode === 'stallTrace') {
    result.trace = await run('stallTrace', opts);
  } else if (mode === 'zoom') {
    result.zoom = await page.evaluate((o) => window.__shotsZoom.run(o), opts);
  } else throw new Error('mode: hints | zoom');
  writeFileSync(path.join(outDir, `${mode}.json`), JSON.stringify(result, null, 1));
  console.log('done', shots.length, 'shots');
} finally {
  if (browser) await browser.close();
  vite.kill('SIGKILL');
}
