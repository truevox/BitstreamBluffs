/* Session-isolation probe (issue #120 finding 4). DIAGNOSTIC, NON-AUTHORITATIVE.
 *
 * Replays tapes through the REAL built game (window.__bbGame) and compares one replay as run #N of a page session against the
 * same replay in a fresh page. Every run of a session must start from identical sim state, whatever ran before it.
 *
 *   npm run build && npx vite preview --port 8443 &
 *   GAME_URL=http://localhost:8443/ node tools/determinism/session-isolation-probe.mjs [--json out.json]
 *
 * Env: PRE (comma list of fixture ids replayed first in the session; default collision-heavy), TARGET (fixture compared, default
 * chunk-biome-boundaries), TICKS (ticks compared, default 600).
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.GAME_URL || 'http://localhost:8443/';
const PRE = (process.env.PRE || 'collision-heavy').split(',').filter(Boolean);
const TARGET = process.env.TARGET || 'chunk-biome-boundaries';
const TICKS = Number(process.env.TICKS || 600);
const tape = async (id) => JSON.parse(await readFile(path.join(here, 'fixtures', `${id}.tape.json`), 'utf8'));
const SEEDS = {};

function shell() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of existsSync(root) ? readdirSync(root).sort().reverse() : []) {
    const p = path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (/^chromium_headless_shell-\d/.test(d) && existsSync(p)) return p;
  }
  return undefined;
}

// Page side: replay a tape one fixed 120 Hz frame per tick, dumping per-tick sim state and the Matter world layout.
const PAGE = `(() => {
  const S = (window.__iso = { hold: true });
  const mk = () => ({ push: false, variableHop: false, noAutoNudge: false, divebomb: false, corkscrew: false, tuck: false, brakeHeld: false, brake: false, hop: false, reset: false, airBrake: false, parachute: false, pause: false, tilt: 0, heli: 0, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } });
  function worldLayout(run) {
    const w = run.matter.world.localWorld;
    return { bodies: w.bodies.map((b) => (b.label || '?') + '#' + b.id), minX: w.bodies.map((b) => Math.round(b.bounds.min.x)), isStatic: w.bodies.map((b) => b.isStatic ? 1 : 0), composites: w.composites.length, constraints: w.constraints.length, nextId: window.Matter ? null : null };
  }
  S.play = async (o) => {
    const g = window.__bbGame;
    const run = g.scene.getScene('RunScene');
    if (!S.hooked) {
      S.hooked = true;
      const u = run.update; run.update = function (t, d) { if (!S.hold) return u.call(this, t, d); };
      const st = run.simTick;
      run.simTick = function (d, pad) { const r = st.call(this, d, pad);
        if (S.cur && S.cur.rows.length < S.cur.max) { const b = this.sled.body; S.cur.rows.push([b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity]); if (S.cur.rows.length === 1) S.cur.world1 = worldLayout(this); }
        return r; };
    }
    S.hold = true;
    g.loop.wake();
    const title = g.scene.getScene('TitleScene');
    if (!title.sys.isActive() || run.sys.isActive()) {
      for (const sc of g.scene.getScenes(true)) if (sc.sys.settings.key !== 'TitleScene') g.scene.stop(sc.sys.settings.key);
      if (!title.sys.isActive()) g.scene.start('TitleScene');
      await new Promise((res) => { const w = () => (title.sys.isActive() ? res() : requestAnimationFrame(w)); w(); });
      await new Promise((r) => setTimeout(r, 150));
    }
    title.starting = false;
    g.registry.set('ghostReplay', o.tape);
    title.startRun(o.tape.seed);
    await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled && run.simClock && run.simClock.tick === 0 && !run.crashed ? res() : requestAnimationFrame(w)); w(); });
    await new Promise((r) => setTimeout(r, 120));
    g.loop.sleep();
    S.cur = { rows: [], max: o.max, world1: null };
    run.inputRouter.poll = () => mk();
    const pre = { world0: worldLayout(run), lastCrash: JSON.stringify(g.registry.get('lastCrash') ?? null), regKeys: Object.keys(g.registry.getAll ? g.registry.getAll() : g.registry.list || {}).sort() };
    S.hold = false;
    const end = o.full ? o.tape.endTick + 1 : o.max;
    let t = 0, f = 0;
    while (!run.crashed && run.simClock.tick < end && f < end * 2 + 600) { t += 1000 / 120; f++; g.step(t, 1000 / 120); }
    S.hold = true;
    const snap = run.score.getSnapshot();
    const out = { ...S.cur, pre, ticks: run.simClock.tick, crashed: !!run.crashed, distanceM: Math.floor(snap.distanceM), desync: run.tapePlayer ? (run.tapePlayer.desync || null) : null };
    S.cur = null;
    return out;
  };
})();`;

async function fresh(browser) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  await page.addInitScript(PAGE);
  page.on('pageerror', (e) => console.error('pageerror', String(e).slice(0, 200)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() && window.__iso, null, { timeout: 60000 });
  return { ctx, page };
}
const play = (page, t, o) => page.evaluate((x) => window.__iso.play(x), { tape: t, max: TICKS, ...o });

const browser = await chromium.launch({ headless: true, executablePath: shell(), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const result = { pre: PRE, target: TARGET, ticks: TICKS };
try {
  const f = await fresh(browser);
  const fr = await play(f.page, await tape(TARGET), {});
  await f.ctx.close();
  const s = await fresh(browser);
  for (const id of PRE) await play(s.page, await tape(id), { full: true });
  const sr = await play(s.page, await tape(TARGET), {});
  await s.ctx.close();
  let first = null;
  for (let i = 0; i < Math.min(fr.rows.length, sr.rows.length) && first === null; i++) if (fr.rows[i].some((v, k) => !Object.is(v, sr.rows[i][k]))) first = i + 1;
  result.firstDivergentTick = first;
  result.worldOrderEqual = JSON.stringify(fr.world1.bodies.map((b) => b.split('#')[0])) === JSON.stringify(sr.world1.bodies.map((b) => b.split('#')[0]));
  result.fresh = { world1: fr.world1, pre: fr.pre, distanceM: fr.distanceM };
  result.session = { world1: sr.world1, pre: sr.pre, distanceM: sr.distanceM };
  result.identical = first === null && result.worldOrderEqual;
} finally { await browser.close(); }
const i = process.argv.indexOf('--json');
if (i > 0) await writeFile(process.argv[i + 1], JSON.stringify(result, null, 1));
console.log(JSON.stringify({ identical: result.identical, firstDivergentTick: result.firstDivergentTick, worldOrderEqual: result.worldOrderEqual,
  freshHead: result.fresh.world1.bodies.slice(0, 4), sessHead: result.session.world1.bodies.slice(0, 4), freshLastCrash: result.fresh.pre.lastCrash.slice(0, 80), sessLastCrash: result.session.pre.lastCrash.slice(0, 80) }, null, 1));
process.exit(result.identical ? 0 : 1);
