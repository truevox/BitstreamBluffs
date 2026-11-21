/**
 * Issue #117 canary authoring aid (TEST INFRASTRUCTURE ONLY).
 *
 * Read-only: boots the built game in headless Chromium exactly as run-canaries.mjs does, starts a run for a
 * seed/biomeMask, streams terrain to X, and dumps the REAL generated features around that X (chunks, launch
 * lips, bounce pads, hazards, zones). Use it to find where a canary's named feature actually lives before
 * writing a corpus tape. It never writes game state and never mutates src/**.
 *
 *   GAME_URL=http://127.0.0.1:8317/ \
 *   node tools/canaries/probe-features.mjs --seed CANARY117 --mask 0 --x 17600 --span 2400
 *
 * Prints JSON: { seed, biomeMask, x, from, to, launches, bouncePads, hazards, zones, slope }
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const GAME_URL = process.env.GAME_URL || 'http://127.0.0.1:8317/';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
}

const SEED = arg('seed', 'CANARY117');
const MASK = Number(arg('mask', '0'));
const X = Number(arg('x', '0'));
const SPAN = Number(arg('span', '2400'));

async function inPage(spec) {
  const g = window.__bbGame;
  const run = g.scene.getScene('RunScene');
  const title = g.scene.getScene('TitleScene');
  const settings = g.registry.get('settings');
  if (settings) { settings.reduceMotion = 'on'; settings.screenShake = false; }
  title.startRun(spec.seed, spec.mask);
  await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
  g.loop.sleep();
  run.streamTerrain(spec.x);
  const from = Math.max(0, spec.x - spec.span);
  const to = spec.x + spec.span;
  const chunks = run.terrain.getActiveChunks();
  const inWindow = (v) => v >= from && v <= to;
  const launches = [];
  const bouncePads = [];
  const hazards = [];
  const zones = [];
  for (const c of chunks) {
    for (const l of c.launches || []) if (inWindow(l.x)) launches.push({ x: l.x, y: l.y, angleDeg: l.angleDeg, airS: l.airS, landX: l.landX, chunk: c.index });
    for (const p of c.bouncePads || []) if (inWindow(p.x)) bouncePads.push({ x: p.x, y: p.y, width: p.width, boost: p.boost, chunk: c.index });
    for (const h of c.hazards || []) if (inWindow(h.x)) hazards.push({ x: h.x, defId: h.defId, chunk: c.index });
    for (const z of c.zones || []) if (inWindow((z.x0 + z.x1) / 2)) zones.push({ x0: z.x0, x1: z.x1, modId: z.modId, chunk: c.index });
  }
  const slope = [];
  for (let x = from; x <= to; x += 100) slope.push([Math.round(x), Math.round(run.terrain.heightAt(x)), Math.round(run.slopeAt(x) * 10) / 10]);
  const chunkMeta = chunks
    .filter((c) => c.endX >= from && c.startX <= to)
    .map((c) => ({ index: c.index, startX: c.startX, endX: c.endX, biome: c.biome || null, sector: c.sector, breather: !!c.breather, template: c.template || null }));
  return { seed: spec.seed, biomeMask: spec.mask, x: spec.x, from, to, launches, bouncePads, hazards, zones, chunks: chunkMeta, slope };
}

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--mute-audio', '--disable-audio-output'],
});
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
  const out = await page.evaluate(inPage, { seed: SEED, mask: MASK, x: X, span: SPAN });
  console.log(JSON.stringify(out, null, 2));
  await context.close();
} finally {
  await browser.close();
}
void ROOT;
