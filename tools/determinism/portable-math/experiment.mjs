// Portable-math experiment runner (issue #121, Phase A). DIAGNOSTIC, NON-AUTHORITATIVE: the digests are test-side evidence, not the #152 contract.
// Replays the nine #120 fixture tapes on the real built game in chromium / firefox / webkit with a chosen set of Math ops replaced by the
// portable implementation (tools/determinism/portable-math/portable-math.cjs) and compares per-tick digests across engines.
//
//   GAME_URL=http://localhost:8442/ xvfb-run -a node tools/determinism/portable-math/experiment.mjs run <cfg> [<cfg>...]
//   node tools/determinism/portable-math/experiment.mjs report            # summary table from the cell cache
// Configs: see CONFIGS below or pass ad-hoc `ops=sin,cos;mode=global`. Finished cells are reused only when active source, served build, math closure, browser, tape and harness identities match.
import { chromium, firefox, webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { makeProvenance, classifyCell, sha256, extractAssetRefs, buildServedIdentity, stampCell, cellPayloadProblem, cellCoordinatesProblem, provenanceProblem } from './cache-provenance.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES as CORE, BROAD } from './fixtures.mjs';
const FIXTURES = process.env.CORPUS === 'core' ? CORE : [...CORE, ...BROAD];
const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.GAME_URL || 'http://localhost:8442/';
const HZ = Number(process.env.HZ || 120);
const CACHE = process.env.CACHE || path.join(here, '.cache');
// Leave legacy unproven .cache cells untouched. Only attested-v1 cells may enter a current report.
const CELL_CACHE = path.join(CACHE, 'attested-v1');
const PIN_DATE = '2026-11-21T12:00:00Z'; // replays depend on the calendar date (#120 finding), so the page clock is pinned
const ALL_OPS = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'log1p', 'pow', 'tanh', 'hypot'];
export const CONFIGS = {
  native: { ops: [], mode: 'global' },
  all: { ops: ALL_OPS, mode: 'global' },
  'all-scoped': { ops: ALL_OPS, mode: 'scoped' },
  'matter-only': { ops: ALL_OPS, mode: 'matter' },
  'src-only': { ops: ALL_OPS, mode: 'nomatter' },
  'native-rep2': { ops: [], mode: 'global' },
  'all-rep2': { ops: ALL_OPS, mode: 'global' },
  count: { ops: [], mode: 'count' },
};
for (const op of ALL_OPS) { CONFIGS[`only-${op}`] = { ops: [op], mode: 'global' }; CONFIGS[`loo-${op}`] = { ops: ALL_OPS.filter((o) => o !== op), mode: 'global' }; }
function cfgOf(name) {
  name = name.replace('@main', '');
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
import { pmathScript } from './load-pmath.mjs';
const pmJs = pmathScript();
const levelOf = (f) => (f.kodiaks ? 8 : 1);
const tapes = {}; for (const f of FIXTURES) { const tp = path.join(here, 'fixtures', `${f.id}.tape.json`); if (existsSync(tp)) tapes[f.id] = JSON.parse(await readFile(tp, 'utf8')); }

async function freshPage(browser, patch, urlOverride) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  await page.addInitScript(`(() => { const R = Date, base = R.parse(${JSON.stringify(PIN_DATE)}), t0 = R.now(); const now = () => base + (R.now() - t0);
    function D(...a) { return a.length ? new R(...a) : new R(now()); } D.prototype = R.prototype; D.now = now; D.parse = R.parse; D.UTC = R.UTC; window.Date = D; })();`);
  await page.addInitScript(`window.__cePatch = ${JSON.stringify(patch)}; window.__ceNoProbe = ${process.env.NOPROBE === '1'};`);
  await page.addInitScript(pmJs);
  await page.addInitScript(pageJs);
  await page.goto(urlOverride || url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() && window.__ce, null, { timeout: 60000 });
  return { ctx, page };
}
const root = path.resolve(here, '..', '..', '..');
const cellPath = (cfg, eng, fx) => path.join(CELL_CACHE, cfg.replace(/[^\w.=,-]/g, '_'), eng, `${fx}.json`);
const fileDigest = p => existsSync(p) ? sha256(readFileSync(p)) : null;
const safeRead = p => existsSync(p) ? readFileSync(p) : null;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

// Hash all tracked causal source, build metadata and harness inputs. Untracked new tool files
// are added explicitly; sourceDirty is separately included and cannot silently match a clean cell.
function sourceTreeDigest() {
  const names = git('ls-files', '-z').split('\0').filter(Boolean).filter(n =>
    n.startsWith('src/') || n.startsWith('tools/determinism/portable-math/') ||
    n.startsWith('tools/ruleset/') ||
    ['package-lock.json', 'package.json', 'vite.config.js', 'index.html'].includes(n));
  for (const n of ['tools/determinism/portable-math/cache-provenance.mjs']) if (!names.includes(n)) names.push(n);
  const hash = createHash('sha256');
  for (const n of names.sort()) {
    const bytes = safeRead(path.join(root, n));
    if (!bytes) throw new Error(`Source identity input missing: ${n}`);
    hash.update(n).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}

const fixtureSha = f => sha256(JSON.stringify(f));
const harnessPaths = [
  'tools/determinism/portable-math/experiment.mjs',
  'tools/determinism/portable-math/page.js',
  'tools/determinism/portable-math/load-pmath.mjs',
  'tools/determinism/portable-math/fixtures.mjs',
  'tools/determinism/portable-math/cache-provenance.mjs',
];
const hashInputs = files => {
  const hash = createHash('sha256');
  for (const n of files) {
    const bytes = safeRead(path.join(root, n));
    if (!bytes) return null;
    hash.update(n).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
};

// Bind the bytes loaded into the executable browser harness to the disk snapshot.
// Otherwise a mutation between import and measurement could stamp old in-memory
// page code with a newer file hash and create false parity evidence.
const bootPageSha = sha256(pageJs);
const bootPmathScriptSha = sha256(pmJs);
const bootHarnessSha = hashInputs(harnessPaths);
if (!bootHarnessSha || fileDigest(path.join(root, 'tools/determinism/portable-math/page.js')) !== bootPageSha) {
  throw new Error('Cannot bind loaded browser harness to source snapshot');
}

function currentBuildIdentity() {
  // Loaded pageJs and pmJs are immutable in this process. Reject if their
  // source files changed after module startup, even before the first cell.
  if (hashInputs(harnessPaths) !== bootHarnessSha ||
      fileDigest(path.join(root, 'tools/determinism/portable-math/page.js')) !== bootPageSha ||
      sha256(pmJs) !== bootPmathScriptSha) {
    throw new Error('Executable browser harness changed after loading; refusing evidence');
  }
  const current = JSON.parse(readFileSync(path.join(root, 'tools/ruleset/current.json'), 'utf8'));
  return {
    sourceCommit: git('rev-parse', 'HEAD'),
    sourceDirty: git('status', '--porcelain').length > 0,
    sourceTreeDigest: sourceTreeDigest(),
    rulesetId: current.rulesetId,
    simRevision: current.simRevision,
    rulesetCurrentSha: fileDigest(path.join(root, 'tools/ruleset/current.json')),
    mathLockDigest: hashInputs(['package-lock.json', 'src/systems/pmath-stdlib-lock.json']),
    pmathSha: fileDigest(path.join(root, 'src/systems/pmath.js')),
    harnessSha: bootHarnessSha,
  };
}

function distFiles() {
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) return [];
  const files = [];
  const walk = (dir, prefix) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('Served build contains a symlink: ' + item.name);
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) walk(path.join(dir, item.name), rel);
      else if (item.isFile()) files.push(rel);
    }
  };
  walk(dist, '');
  return files.sort();
}

async function servedIdentity(gameUrl) {
  const u = new URL(gameUrl);
  if (!['http:', 'https:'].includes(u.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.pathname !== '/') {
    return { proven: false, identity: null, missing: ['nonlocal-or-nonroot-preview'] };
  }
  const get = async addr => {
    const response = await fetch(addr, { signal: AbortSignal.timeout(20000), redirect: 'error', cache: 'no-store' });
    if (!response.ok) throw new Error(`served identity fetch ${response.status}: ${addr}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const index = await get(u);
  const refs = extractAssetRefs(index.toString('utf8'));
  const files = distFiles();
  if (!files.length || !refs.length) return { proven: false, identity: null, missing: ['no-compiled-build'] };
  const outputs = new Set(files.map(rel => `/${rel}`));
  for (const ref of refs) if (!outputs.has(ref)) {
    return { proven: false, identity: null, missing: [`unknown-entry-asset:${ref}`] };
  }
  // Hash *every file* the trusted local Vite preview could serve, not just the
  // entry script. This includes lazy chunks, source maps, CSS, manifests,
  // service workers, fonts and media. A mismatch between local dist/ and the
  // actual HTTP server invalidates the run rather than silently trusting it.
  const assets = [];
  for (const rel of files) {
    const ref = `/${rel}`;
    const local = readFileSync(path.join(root, 'dist', rel));
    const served = rel === 'index.html' ? index : await get(new URL(ref, u));
    if (!local.equals(served)) return { proven: false, identity: null, missing: [`served-content-mismatch:${ref}`] };
    assets.push({ url: ref, sha: sha256(served), bytes: served.length });
  }
  const result = buildServedIdentity({ indexSha: sha256(index), assets });
  return { ...result, fullClosureFiles: files.length };
}

async function activeProvenance(cfgName, eng, f, browser) {
  const isMain = cfgName.endsWith('@main');
  const gameUrl = isMain ? process.env.GAME_URL_MAIN : url;
  if (!gameUrl) throw new Error(`${cfgName}: GAME_URL_MAIN missing for cross-build arm`);
  // No cross-engine memo: the executing preview and the complete built output
  // are independently re-hashed before each recording and again afterward.
  const served = await servedIdentity(gameUrl);
  const executable = browser.browserType().executablePath();
  const tape = tapes[f.id];
  const parts = {
    ...currentBuildIdentity(),
    tapeSha: tape ? sha256(JSON.stringify(tape)) : null,
    fixtureSha: fixtureSha(f),
    gameUrl,
    gameServedIdentity: served.proven ? served.identity : null,
    engineName: eng,
    engineVersion: browser.version(),
    engineExecutable: executable,
    hz: HZ,
    configKey: `${cfgName}:${JSON.stringify(cfgOf(cfgName))}`,
    noprobe: process.env.NOPROBE === '1',
  };
  return makeProvenance(parts);
}

async function runCell(browser, cfgName, eng, f) {
  const p = cellPath(cfgName, eng, f.id);
  const expected = await activeProvenance(cfgName, eng, f, browser);
  let old = null;
  if (existsSync(p)) old = readFileSync(p, 'utf8');
  const gate = classifyCell(old, expected);
  if (gate.reuse) {
    console.log(`${cfgName} ${eng} ${f.id}: verified cached cell ${gate.identity}`);
    return;
  }
  if (old !== null) {
    if (gate.reason === 'identity-mismatch') console.warn(`CACHE INVALIDATED reason: 'identity-mismatch' parts: ${gate.mismatchParts?.join(',')}`);
    else console.warn(`CACHE INVALIDATED ${cfgName} ${eng} ${f.id}: ${gate.reason}`);
  }
  const isMain = cfgName.endsWith('@main');
  const { ctx, page } = await freshPage(browser, cfgOf(cfgName), isMain ? process.env.GAME_URL_MAIN : undefined);
  try {
    const r = await page.evaluate((x) => window.__ce.play(x), { seed: f.seed, hz: HZ, tape: tapes[f.id], level: levelOf(f), raster: false });
    const n = r.digests.length, buf = new Int32Array(n * 8);
    for (let i = 0; i < n; i++) for (let k = 0; k < 8; k++) buf[i * 8 + k] = r.digests[i][k];
    const cell = stampCell({ cfg: cfgName, engine: eng, fixture: f.id, hz: HZ, ticks: n,
      provenance: expected,
      outcome: { ticks: r.outcome.ticks, crashed: r.outcome.crashed, cause: r.outcome.cause, distanceM: r.outcome.distanceM, score: r.outcome.score },
      tapeDesync: r.tapeCheck.desync ? { tick: r.tapeCheck.desync.tick } : null, simMs: r.simMs, loopMs: r.loopMs, counts: r.counts,
      raw: Buffer.from(new Float64Array(r.raw.flat()).buffer).toString('base64'),
      digests: Buffer.from(buf.buffer).toString('base64') });
    // The source might have changed while Chromium was stepping. Never stamp a live-edited
    // run as though it belonged to the earlier source fingerprint.
    const after = currentBuildIdentity();
    const servedAfter = await servedIdentity(expected.parts.gameUrl);
    if (!servedAfter.proven || servedAfter.identity !== expected.parts.gameServedIdentity) {
      throw new Error('served compiled build changed while measuring; discarding cell');
    }
    if (after.sourceTreeDigest !== expected.parts.sourceTreeDigest || after.rulesetCurrentSha !== expected.parts.rulesetCurrentSha || after.harnessSha !== expected.parts.harnessSha) {
      throw new Error('source changed while measuring; discarding cell');
    }
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(cell));
    console.log(`${cfgName} ${eng} ${f.id}: ${n} ticks, sim ${(r.simMs / n).toFixed(4)} ms/tick, outcome ${r.outcome.distanceM}m/${r.outcome.score}, provenance ${expected.proven ? expected.identity : 'UNPROVEN'}`);
  } finally { await ctx.close(); }
}
async function runEngine(cfgNames, eng) {
  const c = ENG[eng](); const browser = await c.type.launch(c.opts);
  try { for (const cfg of cfgNames) for (const f of fixtures) await runCell(browser, cfg, eng, f); } finally { await browser.close(); }
}
const cmd = process.argv[2];
// ---------------------------------------------------------------- record (Chromium, live autopilot -> committed tape); re-verifies in a fresh context
if (cmd === 'record') {
  const only = process.argv.slice(3); const c = ENG.chromium(); const browser = await c.type.launch(c.opts); const meta = [];
  try {
    for (const f of FIXTURES.filter((x) => !only.length || only.includes(x.id))) {
      const { ctx, page } = await freshPage(browser, { ops: [], mode: 'global' });
      for (let i = 0; i < (f.preRuns || 0); i++) await page.evaluate((x) => window.__ce.play(x), { seed: `${f.seed}-PRE${i + 1}`, hz: 120, style: 'cruise', maxTicks: 700, rngSeed: i + 1 });
      const rec = await page.evaluate((x) => window.__ce.play(x), { seed: f.seed, hz: 120, style: f.style, params: f.params, maxTicks: f.maxTicks, kodiaks: !!f.kodiaks, rngSeed: f.rngSeed || 1 });
      await ctx.close();
      if (!rec.tape) throw new Error(`${f.id}: no tape produced`);
      const v = await freshPage(browser, { ops: [], mode: 'global' });
      const rep = await v.page.evaluate((x) => window.__ce.play(x), { seed: f.seed, hz: 120, tape: rec.tape, level: levelOf(f), raster: false });
      await v.ctx.close();
      await writeFile(path.join(FIXTURES_DIR, `${f.id}.tape.json`), JSON.stringify(rec.tape));
      meta.push({ id: f.id, recorded: rec.outcome, replay: rep.outcome, desync: rep.tapeCheck.desync, endTick: rec.tape.endTick, inputs: rec.tape.inputs.length, checkpoints: rec.tape.checkpoints.length });
      console.log(f.id, JSON.stringify({ ticks: rec.outcome.ticks, crashed: rec.outcome.crashed, cause: rec.outcome.cause, m: rec.outcome.distanceM, score: rec.outcome.score, desync: rep.tapeCheck.desync }));
    }
  } finally { await browser.close(); }
  await writeFile(path.join(FIXTURES_DIR, only.length ? `record-meta-${Date.now()}.json` : 'record-meta.json'), JSON.stringify({ build: 'portable-math (SIM_REVISION 5)', fixtures: meta }, null, 1));
}
if (cmd === 'run') {
  const cfgs = process.argv.slice(3);
  for (const c of cfgs) cfgOf(c);
  await Promise.all(engines.map((e) => runEngine(cfgs, e)));
}

// ---------------------------------------------------------------- report
if (cmd === 'report') {
  const { readdirSync: ls } = await import('node:fs');
  const SUB = ['rng', 'timers', 'terrain', 'kodiaks', 'bsod', 'sled', 'world', 'score'];
  const load = (c, e, f) => {
    const p = cellPath(c, e, f);
    if (!existsSync(p)) return null;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const invalidPayload = cellPayloadProblem(j);
    if (invalidPayload) throw new Error(`Refusing malformed experiment cell (${invalidPayload}): ${p}`);
    const recorded = j.provenance;
    const provenanceError = provenanceProblem(recorded);
    if (provenanceError) throw new Error(`Refusing ${provenanceError}: ${p}`);
    const recalculated = makeProvenance(recorded.parts);
    if (!recalculated.proven || recalculated.identity !== recorded.identity ||
        recalculated.environmentId !== recorded.environmentId || recalculated.buildId !== recorded.buildId) {
      throw new Error(`Tampered provenance identity: ${p}`);
    }
    const fixture = FIXTURES.find(x => x.id === f);
    const actualTape = tapes[f];
    const coordinateError = cellCoordinatesProblem(j, {
      cfg: c, engine: e, fixture: f, hz: HZ,
      configKey: `${c}:${JSON.stringify(cfgOf(c))}`,
      fixtureSha: fixture ? fixtureSha(fixture) : null,
      tapeSha: actualTape ? sha256(JSON.stringify(actualTape)) : null,
      noprobe: process.env.NOPROBE === '1',
    });
    if (coordinateError) throw new Error(`Refusing ${coordinateError}: ${p}`);
    j.d = new Int32Array(Uint8Array.from(Buffer.from(j.digests, 'base64')).buffer);
    j.r = new Float64Array(Uint8Array.from(Buffer.from(j.raw, 'base64')).buffer);
    delete j.digests;
    delete j.raw;
    return j;
  };
  // CAUSAL = every digest group except 'terrain' (derived heightAt/slopeAt probe reads, #161 review). 'terrain' is reported separately.
  const CAUSAL = SUB.filter((s) => s !== 'terrain');
  const first = (a, b, only = CAUSAL) => { const n = Math.min(a.ticks, b.ticks); for (let i = 0; i < n; i++) { const s = []; for (let k = 0; k < 8; k++) if (only.includes(SUB[k]) && a.d[i * 8 + k] !== b.d[i * 8 + k]) s.push(SUB[k]); if (s.length) return { tick: i + 1, subsystems: s }; } return a.ticks !== b.ticks ? { tick: n + 1, subsystems: ['length'] } : null; };
  const maxDelta = (a, b) => { if (!a.r || !b.r) return null; const n = Math.min(a.ticks, b.ticks); let mx = 0, mv = 0; for (let i = 0; i < n; i++) { mx = Math.max(mx, Math.abs(a.r[i * 6] - b.r[i * 6]), Math.abs(a.r[i * 6 + 1] - b.r[i * 6 + 1])); mv = Math.max(mv, Math.abs(a.r[i * 6 + 3] - b.r[i * 6 + 3]), Math.abs(a.r[i * 6 + 4] - b.r[i * 6 + 4])); } return { maxPosPx: mx, maxVelPxPerTick: mv }; };
  const same = (x, y) => x.ticks === y.ticks && ['ticks', 'crashed', 'cause', 'distanceM', 'score'].every((k) => x.outcome[k] === y.outcome[k]);
  const cfgs = existsSync(CELL_CACHE) ? ls(CELL_CACHE).filter((d) => d !== 'count') : [];
  const out = { generatedFrom: 'tools/determinism/portable-math/.cache/attested-v1', hz: HZ, configs: {}, environmentId: null };
  const want = process.argv.slice(3);
  const liveBuild = currentBuildIdentity();
  const liveServed = await servedIdentity(url);
  if (!liveServed.proven) throw new Error(`Cannot publish report for unpinned served build: ${liveServed.missing}`);
  const expectedEnvironment = makeProvenance({ ...liveBuild, gameUrl: url, gameServedIdentity: liveServed.identity, hz: HZ, noprobe: process.env.NOPROBE === '1', tapeSha: 'report-placeholder', fixtureSha: 'report-placeholder', engineName: 'report', engineVersion: 'report', engineExecutable: 'report', configKey: 'report' }).environmentId;
  if (!expectedEnvironment) throw new Error('Cannot establish live build identity for report');
  out.environmentId = expectedEnvironment;
  const checkCell = (cell, label) => { if (!cell) return; if (cell.provenance.environmentId !== expectedEnvironment) throw new Error(`Refusing experiment report: untrusted/different environment for ${label}`); };
  for (const c of (want.length ? want : cfgs)) {
    const row = { perFixture: {}, identicalAcrossEngines: 0, fixturesCompared: 0, twoEngineCompared: 0, twoEngineIdentical: 0, engineCoverage: { chromium: 0, firefox: 0, webkit: 0 }, simMsPerTick: {}, status: 'incomplete' };
    for (const f of FIXTURES) {
      const cells = Object.fromEntries(['chromium', 'firefox', 'webkit'].map((e) => [e, load(c, e, f.id)]));
      for (const [engine, cell] of Object.entries(cells)) checkCell(cell, `${c}/${engine}/${f.id}`);
      if (!cells.chromium) continue;
      for (const e of ['chromium', 'firefox', 'webkit']) if (cells[e]) row.engineCoverage[e]++;
      const r = { ticks: cells.chromium.ticks, outcome: cells.chromium.outcome, measuredEngines: Object.keys(cells).filter(e => cells[e]), missingEngines: Object.keys(cells).filter(e => !cells[e]) };
      r.chromiumDesync = cells.chromium.tapeDesync;
      for (const e of ['firefox', 'webkit']) if (cells[e]) { r[e] = first(cells.chromium, cells[e]); r[e + 'Terrain'] = first(cells.chromium, cells[e], ['terrain']); r[e + 'Desync'] = cells[e].tapeDesync; r[e + 'OutcomeEqual'] = same(cells.chromium, cells[e]); r[e + 'MaxDelta'] = maxDelta(cells.chromium, cells[e]); }
      row.perFixture[f.id] = r;
      if (cells.firefox) { row.twoEngineCompared++; if (!r.firefox && r.firefoxOutcomeEqual && !r.firefoxDesync && !r.chromiumDesync && r.firefoxMaxDelta?.maxPosPx === 0) row.twoEngineIdentical++; }
      if (cells.firefox && cells.webkit) { row.fixturesCompared++; if (!r.firefox && !r.webkit && !r.firefoxDesync && !r.webkitDesync && !r.chromiumDesync && r.firefoxMaxDelta?.maxPosPx === 0 && r.webkitMaxDelta?.maxPosPx === 0) row.identicalAcrossEngines++; if (r.firefoxOutcomeEqual && r.webkitOutcomeEqual) row.outcomeEqual = (row.outcomeEqual || 0) + 1; }
      for (const e of Object.keys(cells)) if (cells[e]) { const m = (row.simMsPerTick[e] = row.simMsPerTick[e] || { ms: 0, ticks: 0 }); m.ms += cells[e].simMs; m.ticks += cells[e].ticks; }
    }
    row.status = row.fixturesCompared === row.engineCoverage.chromium && row.fixturesCompared > 0 && row.identicalAcrossEngines === row.fixturesCompared ? 'three-engine-matched' : 'incomplete';
    for (const e of Object.keys(row.simMsPerTick)) row.simMsPerTick[e] = +(row.simMsPerTick[e].ms / row.simMsPerTick[e].ticks).toFixed(4);
    out.configs[c] = row;
  }
  // how far the portable physics departs from native on Chromium (first divergent tick of 'all' vs 'native', per fixture)
  const dep = {};
  for (const f of FIXTURES) {
    const a = load('native', 'chromium', f.id), b = load('all', 'chromium', f.id);
    checkCell(a, `native/chromium/${f.id}`);
    checkCell(b, `all/chromium/${f.id}`);
    if (a && b) dep[f.id] = { firstDivergentTick: first(a, b)?.tick ?? null, nativeOutcome: a.outcome, portableOutcome: b.outcome };
  }
  out.portableVsNativeOnChromium = dep;
  const o = process.env.OUT || path.join(here, '..', '..', '..', 'docs', 'determinism', 'results', 'portable-math-results.json');
  await mkdir(path.dirname(o), { recursive: true }); await writeFile(o, JSON.stringify(out, null, 1));
  for (const [c, r] of Object.entries(out.configs)) {
    const cols = FIXTURES.map((f) => { const x = r.perFixture[f.id]; if (!x) return '-'; const t = ['firefox', 'webkit'].map(e => x.missingEngines.includes(e) ? 'missing' : (x[e]?.tick ?? 'ok')); return `${t[0]}/${t[1]}`; });
    console.log(c.padEnd(14), `THREE-ENGINE ${r.identicalAcrossEngines}/${r.fixturesCompared} | Chromium+Firefox ${r.twoEngineIdentical}/${r.twoEngineCompared} | ${r.status}`.padEnd(86), cols.join(' ').padEnd(100), JSON.stringify(r.engineCoverage));
  }
}

// ---------------------------------------------------------------- perf (run on an otherwise idle machine, one engine at a time)
//   node experiment.mjs perf chromium 5 [cfg...]   -> alternates configs, REPS fresh-context runs each, prints median ms/tick of simTick and of the whole frame loop
if (cmd === 'perf') {
  const eng = process.argv[3] || 'chromium', reps = Number(process.argv[4] || 5), cfgs = process.argv.slice(5).length ? process.argv.slice(5) : ['native', 'all'];
  const c = ENG[eng](); const browser = await c.type.launch(c.opts); const res = {};
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  try {
    for (const f of fixtures) for (let rep = 0; rep < reps; rep++) for (const cfg of cfgs) {
      const isMain = cfg.endsWith('@main'); const { ctx, page } = await freshPage(browser, cfgOf(cfg.replace('@main', '')), isMain ? process.env.GAME_URL_MAIN : undefined);
      const r = await page.evaluate((x) => window.__ce.play(x), { seed: f.seed, hz: HZ, tape: tapes[f.id], level: levelOf(f), raster: false });
      await ctx.close();
      const k = `${cfg}|${f.id}`; (res[k] = res[k] || { sim: [], loop: [], ticks: r.digests.length }); res[k].sim.push(r.simMs / r.digests.length); res[k].loop.push(r.loopMs / r.digests.length);
    }
  } finally { await browser.close(); }
  const summary = {};
  for (const [k, v] of Object.entries(res)) { const [cfg, fx] = k.split('|'); (summary[cfg] = summary[cfg] || {})[fx] = { ticks: v.ticks, simMsPerTickMedian: +med(v.sim).toFixed(4), loopMsPerTickMedian: +med(v.loop).toFixed(4), simMin: +Math.min(...v.sim).toFixed(4), simMax: +Math.max(...v.sim).toFixed(4) }; }
  const outp = process.env.OUT || path.join(here, '..', '..', '..', 'docs', 'determinism', 'results', `portable-math-perf-${eng}.json`);
  await mkdir(path.dirname(outp), { recursive: true }); await writeFile(outp, JSON.stringify({ engine: eng, reps, hz: HZ, note: 'ms per 120 Hz sim tick; simTick = RunScene.simTick wall time (incl. physics, excl. digest hook); loop = whole frame loop incl. renderFrame + digest hook', summary }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}
