// Portable-math experiment runner (issue #121, Phase A). DIAGNOSTIC, NON-AUTHORITATIVE: the digests are test-side evidence, not the #152 contract.
// Replays the nine #120 fixture tapes on the real built game in chromium / firefox / webkit with a chosen set of Math ops replaced by the
// portable implementation (tools/determinism/portable-math/portable-math.cjs) and compares per-tick digests across engines.
//
//   GAME_URL=http://localhost:8442/ xvfb-run -a node tools/determinism/portable-math/experiment.mjs run <cfg> [<cfg>...]
//   node tools/determinism/portable-math/experiment.mjs report            # summary table from the cell cache
// Configs: see CONFIGS below or pass ad-hoc `ops=sin,cos;mode=global`. Each finished cell is cached on disk (skipped on rerun; delete .cache to redo).
import { chromium, firefox, webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.GAME_URL || 'http://localhost:8442/';
const HZ = Number(process.env.HZ || 120);
const CACHE = process.env.CACHE || path.join(here, '.cache');
const PIN_DATE = '2026-11-21T12:00:00Z'; // replays depend on the calendar date (#120 finding), so the page clock is pinned
const ALL_OPS = ['sin', 'cos', 'tan', 'atan', 'atan2', 'exp', 'log', 'log1p', 'pow', 'tanh', 'hypot'];
export const CONFIGS = {
  native: { ops: [], mode: 'global' },
  all: { ops: ALL_OPS, mode: 'global' },
  'all-scoped': { ops: ALL_OPS, mode: 'scoped' },
  count: { ops: [], mode: 'count' },
};
for (const op of ALL_OPS) { CONFIGS[`only-${op}`] = { ops: [op], mode: 'global' }; CONFIGS[`loo-${op}`] = { ops: ALL_OPS.filter((o) => o !== op), mode: 'global' }; }
function cfgOf(name) {
  if (CONFIGS[name]) return CONFIGS[name];
  const m = {}; for (const kv of name.split(';')) { const [k, v] = kv.split('='); m[k] = v; }
  if (!m.ops && !m.mode) throw new Error('unknown config ' + name);
  return { ops: (m.ops || '').split(',').filter(Boolean), mode: m.mode || 'global' };
}
const fixtures = process.env.FIXTURES ? FIXTURES.filter((f) => process.env.FIXTURES.split(',').includes(f.id)) : FIXTURES;
const engines = (process.env.ENGINES || 'chromium,firefox,webkit').split(',');

function exe(dirRe, rel) { const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'; for (const d of readdirSync(root).sort().reverse()) { const p = path.join(root, d, ...rel); if (dirRe.test(d) && existsSync(p)) return p; } return null; }
const SWIFT = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
const ENG = {
  chromium: () => ({ type: chromium, opts: { headless: true, executablePath: exe(/^chromium_headless_shell-\d/, ['chrome-headless-shell-linux64', 'chrome-headless-shell']), args: SWIFT } }),
  firefox: () => ({ type: firefox, opts: { headless: false, env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' } } }), // headed under Xvfb: headless Firefox has no WebGL here
  webkit: () => ({ type: webkit, opts: { headless: true } }),
};
const pageJs = await readFile(path.join(here, 'page.js'), 'utf8');
const pmJs = await readFile(path.join(here, 'portable-math.cjs'), 'utf8');
const levelOf = (f) => (f.kodiaks ? 8 : 1);
const tapes = {}; for (const f of FIXTURES) tapes[f.id] = JSON.parse(await readFile(path.join(here, 'fixtures', `${f.id}.tape.json`), 'utf8'));

async function freshPage(browser, patch) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  await page.addInitScript(`(() => { const R = Date, base = R.parse(${JSON.stringify(PIN_DATE)}), t0 = R.now(); const now = () => base + (R.now() - t0);
    function D(...a) { return a.length ? new R(...a) : new R(now()); } D.prototype = R.prototype; D.now = now; D.parse = R.parse; D.UTC = R.UTC; window.Date = D; })();`);
  await page.addInitScript(`window.__cePatch = ${JSON.stringify(patch)};`);
  await page.addInitScript(pmJs);
  await page.addInitScript(pageJs);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() && window.__ce, null, { timeout: 60000 });
  return { ctx, page };
}
const cellPath = (cfg, eng, fx) => path.join(CACHE, cfg.replace(/[^\w.=,-]/g, '_'), eng, `${fx}.json`);

async function runCell(browser, cfgName, eng, f) {
  const p = cellPath(cfgName, eng, f.id);
  if (existsSync(p)) return;
  const { ctx, page } = await freshPage(browser, cfgOf(cfgName));
  try {
    const r = await page.evaluate((x) => window.__ce.play(x), { seed: f.seed, hz: HZ, tape: tapes[f.id], level: levelOf(f), raster: false });
    const n = r.digests.length, buf = new Int32Array(n * 8);
    for (let i = 0; i < n; i++) for (let k = 0; k < 8; k++) buf[i * 8 + k] = r.digests[i][k];
    const cell = { cfg: cfgName, engine: eng, fixture: f.id, hz: HZ, ticks: n, outcome: { ticks: r.outcome.ticks, crashed: r.outcome.crashed, cause: r.outcome.cause, distanceM: r.outcome.distanceM, score: r.outcome.score },
      tapeDesync: r.tapeCheck.desync ? { tick: r.tapeCheck.desync.tick } : null, simMs: r.simMs, loopMs: r.loopMs, counts: r.counts,
      digests: Buffer.from(buf.buffer).toString('base64') };
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(cell));
    console.log(`${cfgName} ${eng} ${f.id}: ${n} ticks, sim ${(r.simMs / n).toFixed(4)} ms/tick, outcome ${r.outcome.distanceM}m/${r.outcome.score}`);
  } finally { await ctx.close(); }
}
async function runEngine(cfgNames, eng) {
  const c = ENG[eng](); const browser = await c.type.launch(c.opts);
  try { for (const cfg of cfgNames) for (const f of fixtures) await runCell(browser, cfg, eng, f); } finally { await browser.close(); }
}
const cmd = process.argv[2];
if (cmd === 'run') {
  const cfgs = process.argv.slice(3);
  for (const c of cfgs) cfgOf(c);
  await Promise.all(engines.map((e) => runEngine(cfgs, e)));
}

// ---------------------------------------------------------------- report
if (cmd === 'report') {
  const { readdirSync: ls } = await import('node:fs');
  const SUB = ['rng', 'timers', 'terrain', 'kodiaks', 'bsod', 'sled', 'world', 'score'];
  const load = (c, e, f) => { const p = cellPath(c, e, f); if (!existsSync(p)) return null; const j = JSON.parse(readFileSync(p, 'utf8')); j.d = new Int32Array(Uint8Array.from(Buffer.from(j.digests, 'base64')).buffer); delete j.digests; return j; };
  const first = (a, b) => { const n = Math.min(a.ticks, b.ticks); for (let i = 0; i < n; i++) { const s = []; for (let k = 0; k < 8; k++) if (a.d[i * 8 + k] !== b.d[i * 8 + k]) s.push(SUB[k]); if (s.length) return { tick: i + 1, subsystems: s }; } return a.ticks !== b.ticks ? { tick: n + 1, subsystems: ['length'] } : null; };
  const cfgs = ls(CACHE).filter((d) => d !== 'count');
  const out = { generatedFrom: 'tools/determinism/portable-math/.cache', hz: HZ, configs: {} };
  const want = process.argv.slice(3);
  for (const c of (want.length ? want : cfgs)) {
    const row = { perFixture: {}, identicalAcrossEngines: 0, fixturesCompared: 0, simMsPerTick: {} };
    for (const f of FIXTURES) {
      const cells = Object.fromEntries(['chromium', 'firefox', 'webkit'].map((e) => [e, load(c, e, f.id)]));
      if (!cells.chromium) continue;
      const r = { ticks: cells.chromium.ticks, outcome: cells.chromium.outcome };
      for (const e of ['firefox', 'webkit']) if (cells[e]) r[e] = first(cells.chromium, cells[e]);
      row.perFixture[f.id] = r;
      if (cells.firefox && cells.webkit) { row.fixturesCompared++; if (!r.firefox && !r.webkit) row.identicalAcrossEngines++; }
      for (const e of Object.keys(cells)) if (cells[e]) { const m = (row.simMsPerTick[e] = row.simMsPerTick[e] || { ms: 0, ticks: 0 }); m.ms += cells[e].simMs; m.ticks += cells[e].ticks; }
    }
    for (const e of Object.keys(row.simMsPerTick)) row.simMsPerTick[e] = +(row.simMsPerTick[e].ms / row.simMsPerTick[e].ticks).toFixed(4);
    out.configs[c] = row;
  }
  // how far the portable physics departs from native on Chromium (first divergent tick of 'all' vs 'native', per fixture)
  const dep = {};
  for (const f of FIXTURES) { const a = load('native', 'chromium', f.id), b = load('all', 'chromium', f.id); if (a && b) dep[f.id] = { firstDivergentTick: first(a, b)?.tick ?? null, nativeOutcome: a.outcome, portableOutcome: b.outcome }; }
  out.portableVsNativeOnChromium = dep;
  const o = process.env.OUT || path.join(here, '..', '..', '..', 'docs', 'determinism', 'results', 'portable-math-results.json');
  await mkdir(path.dirname(o), { recursive: true }); await writeFile(o, JSON.stringify(out, null, 1));
  for (const [c, r] of Object.entries(out.configs)) {
    const cols = FIXTURES.map((f) => { const x = r.perFixture[f.id]; if (!x) return '-'; const t = [x.firefox?.tick, x.webkit?.tick].map((v) => v ?? 'ok'); return `${t[0]}/${t[1]}`; });
    console.log(c.padEnd(14), `${r.identicalAcrossEngines}/${r.fixturesCompared}`.padEnd(6), cols.join(' ').padEnd(80), JSON.stringify(r.simMsPerTick));
  }
}
