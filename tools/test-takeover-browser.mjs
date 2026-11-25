/**
 * #72 Replay Takeover: real-Chromium proof on the BUILT game (vite build + vite preview of its output).
 *
 *   CHROMIUM_EXECUTABLE=/run/current-system/sw/bin/google-chrome node tools/test-takeover-browser.mjs
 *
 * Env: BSB_TAKEOVER_DIST=<dir of an existing build> (default: build into a temp dir), BSB_TAKEOVER_SEED / BSB_TAKEOVER_LEAD
 * (the scripted run), BSB_TAKEOVER_OUT=<file> (JSON report), BSB_TAKEOVER_QUICK=1 (skip the 14,400-tick throughput run).
 *
 * What it proves (see the report it prints):
 *  1. one REAL run is recorded in Chromium by a deterministic scripted driver (keyboard / InputRouter injection) that hits
 *     real hazards with the BSOD pursuit active and ends in a real crash. It is an ordinary credited run (regression, step 7).
 *  2. for N in {early, hazard/contact, close-to-BSOD, 1 tick before the end}: (a) the takeover state at N (the game's own
 *     13-channel fingerprint AND the Heavy kit digests, an ORACLE only, injected here and never imported by src/) equals an
 *     uninterrupted GHOST_REPLAY of the same tape; (b) after handoff, the original tape's remaining pads fed through the LIVE
 *     input path reproduce every per-tick fingerprint, the crash tick and the cause; (c) different input diverges and still
 *     ends unranked. Each fresh page ends with ALL storage byte-identical to before.
 *  3. negative controls each refuse / abort visibly, end at TITLE and start no ranked run.
 *  4. the handoff key is consumed (no hop edge on tick N+1); retries from the same N give the same state-at-N fingerprint.
 *  5. a 14,400+ tick tape: seek throughput in ticks/s.
 */
import { createServer, preview, build } from 'vite';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTakeoverDescriptor, takeoverEligible } from '../src/systems/replay/Takeover.js';
import { decodePad } from '../src/systems/ghost/GhostTape.js';
import { NON_CAUSAL } from '../src/systems/replay/fingerprintSchemas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SEED = process.env.BSB_TAKEOVER_SEED || 'bot4';
const LEAD = Number(process.env.BSB_TAKEOVER_LEAD || 0.28);
const QUICK = process.env.BSB_TAKEOVER_QUICK === '1';
const ONLY = process.env.BSB_TAKEOVER_ONLY ? new Set(process.env.BSB_TAKEOVER_ONLY.split(',')) : null; // ui,cases,neg,key,throughput (debugging aid)
const NCASES = process.env.BSB_TAKEOVER_NCASES ? new Set(process.env.BSB_TAKEOVER_NCASES.split(',')) : null; // early,hazardOrContact,closeToBsod,oneBeforeEnd
const want = (k) => !ONLY || ONLY.has(k);
const FIXED_UTC = '2026-01-05T12:00:00.000Z';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail === undefined ? undefined : detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && !ok ? ` :: ${JSON.stringify(detail).slice(0, 400)}` : ''}`); };

// ---------------------------------------------------------------------------------------------- page-side helpers
// The Heavy kit is injected as a TEST ORACLE only (like tools/savestate-experiment/browser-experiment.mjs).
const matterKitSrc = readFileSync(path.join(root, 'tools/savestate-experiment/matter-snapshot-kit.js'), 'utf8').replace(/^export /gm, '')
  + '\nwindow.__ssMatterKit = createMatterSnapshotKit(Phaser.Physics.Matter.Matter);\n';
const gameKitSrc = readFileSync(path.join(root, 'tools/savestate-experiment/game-state-kit.js'), 'utf8');

/** Installed in every page. Everything the proof drives goes through the real InputRouter / real KeyboardEvents. */
function installHelpers() {
  const g = window.__bbGame;
  const tk = window.__tk = {
    g, t: 0, dt: 1000 / 120, R: null, held: new Set(), events: [], errors: [],
    reg: (k) => g.registry.get(k),
    run: () => g.scene.getScene('RunScene'),
    router: () => g.registry.get('inputRouter'),
    step(n = 1) { for (let i = 0; i < n; i++) { tk.t += tk.dt; g.headlessStep(tk.t, tk.dt); } },
    /** The game's own 13-channel frame fingerprint (GhostRecorder._fingerprint with a throwaway receiver). */
    fp(run = tk.run()) {
      const rcv = { fingerprints: [], fingerprintErrorCount: 0, fingerprintErrors: [] };
      tk.R.prototype._fingerprint.call(rcv, run.simClock.tick, run);
      if (rcv.fingerprintErrorCount || rcv.fingerprints.length !== 1) throw new Error('fingerprint capture failed ' + JSON.stringify(rcv.fingerprintErrors));
      return rcv.fingerprints[0].combined;
    },
    key(code, down, extra = {}) {
      const map = { Space: [' ', 32], Enter: ['Enter', 13], KeyT: ['t', 84], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], Comma: [',', 188], Period: ['.', 190], ShiftLeft: ['Shift', 16], Escape: ['Escape', 27] };
      const [key, keyCode] = map[code];
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key, keyCode, which: keyCode, bubbles: true, cancelable: true, ...extra }));
    },
    /** Apply the wanted held set. Space is a REAL keyboard event (hop + confirm); the rest go through the pad the keyboard feeds. */
    hold(wanted, edgeHop) {
      const pad = tk.router().pad;
      for (const n of [...tk.held]) if (!wanted.has(n)) { if (n === 'hop') tk.key('Space', false); else pad.setButton(n, false, 'keyboard'); tk.held.delete(n); }
      for (const n of wanted) {
        if (n === 'hop' && tk.held.has('hop') && edgeHop) { tk.key('Space', false); tk.held.delete('hop'); }
        if (!tk.held.has(n)) { if (n === 'hop') tk.key('Space', true); else pad.setButton(n, true, 'keyboard'); tk.held.add(n); }
      }
    },
    releaseAll() { tk.hold(new Set()); },
    scenes: () => g.scene.getScenes(true).map((s) => s.sys.settings.key),
    async snapshot() {
      const out = { ls: {}, idb: {}, reg: {} };
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.ls[k] = localStorage.getItem(k); }
      const norm = (v) => JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? { u8: Array.from(x) } : x instanceof Map ? { map: [...x.entries()] } : x instanceof Set ? { set: [...x] } : x));
      const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      for (const d of (await indexedDB.databases())) {
        const db = await req(indexedDB.open(d.name));
        out.idb[d.name] = {};
        for (const sn of [...db.objectStoreNames]) {
          const st = db.transaction(sn, 'readonly').objectStore(sn);
          out.idb[d.name][sn] = norm({ keys: await req(st.getAllKeys()), rows: await req(st.getAll()) });
        }
        db.close();
      }
      const store = g.registry.get('saveStore');
      out.reg.profile = norm(g.registry.get('profile'));
      out.reg.saveStore = norm(Object.fromEntries(Object.entries(store || {}).filter(([, v]) => typeof v !== 'function' && !(v && typeof v === 'object' && v.constructor && !['Object', 'Array', 'Map', 'Set'].includes(v.constructor.name)))));
      out.reg.ghosts = norm({ courses: g.registry.get('ghostLibrary')?.courses, tapes: [...(g.registry.get('ghostLibrary')?.tapes?.keys() || [])] });
      for (const k of ['lastRecord', 'lastAwards', 'lastGhostTape', 'lastCrash', 'lastEvidenceStatus', 'missions']) out.reg[k] = norm(g.registry.get(k));
      return JSON.stringify(out);
    },
    /** Boot a fresh run of `seed` from the Title exactly like the canonical A/A tool does (sync tick-zero scene). */
    startRun(seed, regSet) {
      g.loop.sleep();
      g.scene.getScene('TitleScene').startRun(seed);
      g.scene.stop('TitleScene');
      for (const [k, v] of Object.entries(regSet || {})) g.registry.set(k, v);
      g.scene.start('RunScene');
      g.headlessStep(0, 0);
    },
  };
  // observe the lifecycle events (RUN_START payloads, RUN_END, RUN_ABORT) for the no-ranked-run assertions
  for (const [name, evt] of Object.entries({ runStart: 'bb:runStart', runEnd: 'bb:runEnd', runAbort: 'bb:runAbort', crash: 'bb:crash', hazardHit: 'bb:hazardHit', nearMiss: 'bb:nearMiss', landing: 'bb:landing', newBest: 'bb:newBest', mission: 'bb:missionCompleted', takeoverState: 'bb:takeoverState' })) {
    g.events.on(evt, (p) => tk.events.push({ name, tick: tk.run()?.simClock?.tick ?? null, p: JSON.parse(JSON.stringify(p ?? null)) }));
  }
  window.addEventListener('error', (e) => tk.errors.push(String(e.message)));
  return tk;
}

/** The scripted bot, run IN PAGE on the live sim state: hop ahead of ground crash hazards, push when slow. */
function installBot(lead) {
  const tk = window.__tk;
  tk.bot = { st: { hopUntil: 0, hopPrev: false }, lead };
  tk.botWanted = () => {
    const run = tk.run(), s = run.sled, st = tk.bot.st, tick = run.simClock.tick + 1;
    let dxMin = Infinity;
    for (const list of run.hazards.values()) for (const h of list) {
      if (h.hit || !h.def.onHit || h.def.onHit.effect !== 'crash' || h.def.placement === 'air') continue;
      const dx = h.cx - s.x;
      if (dx > -40 && dx < dxMin) dxMin = dx;
    }
    const speed = Math.max(60, s.speed);
    if (dxMin < Math.max(80, speed * tk.bot.lead) && dxMin > -30 && s.grounded) st.hopUntil = tick + 6;
    const hopping = tick <= st.hopUntil;
    const edge = hopping && !st.hopPrev;
    st.hopPrev = hopping;
    const wanted = new Set();
    if (s.grounded && s.speed < 260) wanted.add('push');
    if (hopping) wanted.add('hop');
    return { wanted, edge };
  };
}

// ------------------------------------------------------------------------------------------------------------ harness
let tmpDist = null, server = null, browser = null, origin = null;
async function boot() {
  const dist = process.env.BSB_TAKEOVER_DIST;
  let outDir = dist ? path.resolve(dist) : null;
  if (!outDir) {
    tmpDist = mkdtempSync(path.join(tmpdir(), 'bsb-takeover-build-'));
    outDir = tmpDist;
    await build({ root, base: '/', logLevel: 'error', build: { outDir, emptyOutDir: true } });
  }
  server = await preview({ root, base: '/', build: { outDir }, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  origin = `http://127.0.0.1:${server.httpServer.address().port}/`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
}

async function freshPage({ kit = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.clock.setFixedTime(new Date(FIXED_UTC));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.isActive('TitleScene') && window.__bbGame.registry.get('currentRuleset') && window.__bbGame.registry.get('currentBuildId'), null, { timeout: 40000 });
  if (kit) { await page.addScriptTag({ content: matterKitSrc }); await page.addScriptTag({ content: gameKitSrc }); }
  await page.evaluate(`(${installHelpers.toString()})(); 0`);
  await page.evaluate(`(${installBot.toString()})(${LEAD}); 0`);
  return { ctx, page, errors, close: () => ctx.close() };
}

/** Step frames until `pred()` (in page) or the cap; returns pred's final value. */
const until = (page, predSrc, cap = 3000) => page.evaluate(({ predSrc, cap }) => {
  const f = new Function('tk', `return (${predSrc})(tk);`);
  for (let i = 0; i < cap; i++) { if (f(window.__tk)) return true; window.__tk.step(1); }
  return !!f(window.__tk);
}, { predSrc, cap });

// -------------------------------------------------------------------------------------------------- 1. record a run
async function recordRun() {
  const P = await freshPage({ kit: true });
  const { page } = P;
  const rec = await page.evaluate(async (seed) => {
    const tk = window.__tk;
    tk.startRun(seed);
    const run = tk.run();
    tk.R = run.ghostRecorder.constructor; // the compiled recorder class: gives us the game's own fingerprint method
    const before = { hold: 0 };
    const fps = [], gaps = [];
    const ev = { hazardHit: [], nearMiss: [], landing: [] };
    for (const k of Object.keys(ev)) window.__bbGame.events.on({ hazardHit: 'bb:hazardHit', nearMiss: 'bb:nearMiss', landing: 'bb:landing' }[k], () => ev[k].push(run.simClock.tick));
    let n = 0;
    while (!run.crashed && n < 40000) {
      const { wanted, edge } = tk.botWanted();
      tk.hold(wanted, edge);
      tk.step(1); n++;
      fps[run.simClock.tick] = tk.fp(run);
      gaps[run.simClock.tick] = run.bsodState ? run.bsodState.gapPx : null;
    }
    tk.releaseAll();
    return { ticks: run.simClock.tick, crashed: run.crashed, fps, gaps, ev, n };
  }, SEED);
  await until(page, '(tk)=>tk.g.registry.get("lastGhostTape") && tk.g.scene.isActive("GameOverScene")', 6000);
  // let the deferred evidence write settle before the baseline
  await page.waitForFunction(() => window.__bbGame.registry.get('lastEvidenceStatus'), null, { timeout: 15000 });
  const info = await page.evaluate(() => {
    const tk = window.__tk, r = tk.g.registry;
    return { tape: JSON.parse(JSON.stringify(r.get('lastGhostTape'))), lastCrash: JSON.parse(JSON.stringify(r.get('lastCrash'))), record: JSON.parse(JSON.stringify(r.get('lastRecord'))),
      awards: JSON.parse(JSON.stringify(r.get('lastAwards') ?? null)), evidence: JSON.parse(JSON.stringify(r.get('lastEvidenceStatus'))),
      events: tk.events, scenes: tk.scenes(), profile: JSON.parse(JSON.stringify(r.get('profile'))),
      ghostCourses: r.get('ghostLibrary').courses.size, ghostTapes: r.get('ghostLibrary').tapes.size, runs: (r.get('saveStore').runs || []).length };
  });
  return { P, rec, info };
}

// --------------------------------------------------------------------------------------------------------- main
async function main() {
  await boot();
  const report = { seed: SEED, lead: LEAD, origin: 'vite preview of the built game', cases: [], negatives: [], notes: [] };
  try {
    // ============================================================ 1. the real recording (= the ordinary-run regression)
    console.log(`recording seed=${SEED} lead=${LEAD} ...`);
    const t0 = Date.now();
    const { P: main, rec, info } = await recordRun();
    const tape = info.tape, endTick = tape.endTick;
    report.recording = { ticks: rec.ticks, endTick, wallMs: Date.now() - t0, crashCause: info.lastCrash.cause, distanceM: info.record.distanceM, inputsRows: tape.inputs.length,
      hazardHits: rec.ev.hazardHit.length, nearMisses: rec.ev.nearMiss.length, landings: rec.ev.landing.length, rulesetId: tape.rulesetId, buildId: tape.buildId, mode: tape.mode };
    console.log(JSON.stringify(report.recording));
    check('record: a real run ended in a real crash (BSOD pursuit)', rec.crashed && endTick >= 3000 && ['bsod', 'hazard', 'chasm', 'badLanding'].includes(info.lastCrash.cause), report.recording);
    check('record: tape is stamped with this build\'s rulesetId + buildId and is mode normal', tape.mode === 'normal' && tape.rulesetId === (await main.page.evaluate(() => window.__bbGame.registry.get('currentRuleset').rulesetId)) && /^sha256:/.test(tape.buildId || ''), { rulesetId: tape.rulesetId, buildId: tape.buildId });
    // regression: an ordinary run still records, credits and saves normally
    check('regression: ordinary run saved a RunRecord, credited XP/awards, ghost tape + evidence', !!info.record && info.record.score > 0 && !!info.awards && info.ghostTapes >= 1 && info.runs >= 1 && info.evidence.ok === true && info.events.some((e) => e.name === 'runEnd') && info.events.filter((e) => e.name === 'runStart').every((e) => e.p.practice === false),
      { score: info.record?.score, awards: !!info.awards, ghostTapes: info.ghostTapes, runs: info.runs, evidence: info.evidence });

    // choose N: early / hazard-or-contact / close to the BSOD / one tick before the end
    const evTicks = [...rec.ev.hazardHit, ...rec.ev.nearMiss].filter((t) => t > 300 && t < endTick - 400).sort((a, b) => a - b);
    const midLanding = rec.ev.landing.filter((t) => t > 600 && t < endTick - 400);
    const nHazard = evTicks.length ? evTicks[Math.floor(evTicks.length / 2)] : midLanding[Math.floor(midLanding.length / 2)];
    let nBsod = 0, best = Infinity;
    for (let t = 600; t < endTick - 300; t++) { const g = rec.gaps[t]; if (g != null && g > 0 && g < best) { best = g; nBsod = t; } }
    const Ns = { early: 360, hazardOrContact: nHazard, closeToBsod: nBsod, oneBeforeEnd: endTick - 1 };
    report.Ns = { ...Ns, hazardEventKind: evTicks.length ? 'hazardHit/nearMiss' : 'landing', bsodGapPxAtN: best };
    console.log('N cases', JSON.stringify(report.Ns));
    for (const [k, N] of Object.entries(Ns)) check(`N ${k}=${N} is takeover-eligible`, takeoverEligible(tape, N, { rulesetId: tape.rulesetId }).ok, { N });

    // ============================================================ 2. UI path + zero side effects + retry (main page, real scenes)
    if (want('ui')) await guarded('ui path', () => uiPathAndSideEffects(main, tape, rec, Ns));

    // ============================================================ 3. per-N fresh pages: (a) (b) (c)
    if (want('cases')) for (const [kind, N] of Object.entries(Ns)) if (!NCASES || NCASES.has(kind)) report.cases.push(await guarded(`case ${kind}`, () => perNCase(kind, N, tape, rec, info)));

    // ============================================================ 4. negative controls
    if (want('neg')) report.negatives = await guarded('negative controls', () => negativeControls(main, tape, Ns));

    // ============================================================ 5. handoff key
    if (want('key')) await guarded('handoff key', () => handoffKey(tape, rec, Ns));

    await main.close();

    // ============================================================ 6. throughput on a >= 14,400 tick tape
    if (!QUICK && want('throughput')) report.throughput = await guarded('throughput', () => throughput(tape, rec));
    else report.notes.push('throughput skipped (BSB_TAKEOVER_QUICK=1)');
  } finally {
    const failed = results.filter((r) => !r.ok);
    report.summary = { total: results.length, passed: results.length - failed.length, failed: failed.length, failedNames: failed.map((r) => r.name) };
    report.results = results;
    if (process.env.BSB_TAKEOVER_OUT) writeFileSync(process.env.BSB_TAKEOVER_OUT, JSON.stringify(report, null, 1));
    console.log('REPORT ' + JSON.stringify({ ...report, results: undefined }));
    await browser?.close().catch(() => {});
    await server?.close?.().catch?.(() => {});
    if (tmpDist) rmSync(tmpDist, { recursive: true, force: true });
    process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
  }
}

/** One section failing (a thrown error is a FAIL) must not hide the others. */
async function guarded(name, fn) {
  try { return await fn(); } catch (e) { check(`SECTION ${name} completed without an exception`, false, String((e && e.message) || e).split('\n')[0]); return null; }
}

// ------------------------------------------------------------------------------------------------ pieces (filled below)
// per-tick pad schedule for the original tape's pads from tick `from+1` through endTick (decoded in Node, applied in page)
function padSchedule(tape, from) {
  const out = [];
  let i = 0, at = 0, bits = 0, tilt = 0, changeTick = -1;
  const rows = tape.inputs;
  let next = rows.length ? rows[0][0] : Infinity;
  for (let tick = 1; tick <= tape.endTick + 1; tick++) { // +1: the crash happens on the tick AFTER the recorder's endTick (its last survived tick)
    while (i < rows.length && tick >= next) { bits = rows[i][1]; tilt = rows[i][2]; changeTick = next; i++; next = i < rows.length ? next + rows[i][0] : Infinity; }
    if (tick <= from) continue;
    const pad = decodePad(bits, tilt);
    const edge = changeTick === tick ? pad.pressed : {};
    const names = [];
    if (pad.push) names.push('push');
    if (pad.hop) names.push('hop');
    if (pad.tuck) names.push('tuck');
    if (pad.brakeHeld) names.push('brake');
    if (pad.airBrake) names.push('airBrake');
    if (pad.parachute) names.push('parachute');
    if (pad.divebomb) names.push('divebomb');
    if (pad.corkscrew) names.push('corkscrew');
    if (pad.heli > 0) names.push('heliRight'); else if (pad.heli < 0) names.push('heliLeft');
    if (pad.tilt < 0) names.push('tiltBack'); else if (pad.tilt > 0) names.push('tiltForward');
    out.push({ names, edgeHop: !!edge.hop });
  }
  return out;
}

async function launchTakeoverInPage(page, descriptor) {
  await page.evaluate((d) => {
    const g = window.__bbGame, reg = g.registry;
    for (const s of g.scene.getScenes(true)) if (s.sys.settings.key !== 'RunScene') g.scene.stop(s.sys.settings.key);
    g.scene.stop('RunScene');
    reg.set('takeoverDescriptor', d);
    reg.set('seed', d.tape.seed); reg.set('biomeMask', d.tape.biomeMask);
    reg.set('dailyOfficial', false); reg.set('dailyMode', 'classic'); reg.set('bsodGymMode', false); reg.remove('guestPracticeTape'); reg.remove('ghostReplay');
    window.__tk.events.length = 0;
    g.scene.start('RunScene');
    g.headlessStep(0, 0);
  }, JSON.parse(JSON.stringify(descriptor)));
}

async function seekToReady(page, cap = 4000) {
  return page.evaluate((cap) => {
    const tk = window.__tk;
    for (let i = 0; i < cap; i++) { const r = tk.run(); const ph = r && r.takeover && r.takeover.phase; if (ph !== 'seeking') return ph || 'none'; tk.step(1); }
    return 'timeout';
  }, cap);
}

async function perNCase(kind, N, tape, rec, info) {
  console.log(`case ${kind} N=${N}`);
  const out = { kind, N };
  const endTick = tape.endTick;
  const descriptor = buildTakeoverDescriptor({ tape, tick: N, source: 'proof' });
  // ---- oracle: an uninterrupted GHOST_REPLAY of the same tape, one tick per frame, in a FRESH page
  const O = await freshPage({ kit: true });
  const oracle = await O.page.evaluate(({ tape, N, seed }) => {
    const tk = window.__tk;
    tk.startRun(seed);
    tk.R = tk.run().ghostRecorder.constructor;
    tk.g.scene.stop('RunScene');
    tk.g.registry.set('ghostReplay', tape);
    tk.g.scene.start('RunScene'); tk.g.headlessStep(0, 0);
    const run = tk.run();
    if (!run.tapePlayer || run.simClock.tick !== 0) throw new Error('oracle replay scene did not start');
    while (run.simClock.tick < N) tk.step(1);
    return { tick: run.simClock.tick, fp: tk.fp(run), digests: window.__ssGameKit.digests(run), desync: run.tapePlayer.desync, leafs: (() => { const c = window.__ssGameKit.capture(run).game; return JSON.stringify({ sled: c.sled, hazards: c.hazards, runRandom: c.runRandom }); })() };
  }, { tape, N, seed: tape.seed });
  await O.close();
  const O_leafs = oracle.leafs;
  check(`(a) oracle replay reached N=${N} with no desync`, oracle.tick === N && !oracle.desync, { tick: oracle.tick });
  check(`(a) oracle replay fingerprint at N equals the recording's own per-tick fingerprint`, oracle.fp === rec.fps[N], { got: oracle.fp, want: rec.fps[N] });

  // ---- takeover page: attempt 1 (state at N, then (b) exact suffix), attempt 2 via the end screen's RETRY ((6) + (c))
  const T = await freshPage({ kit: true });
  const base = await T.page.evaluate((seed) => { const tk = window.__tk; tk.startRun(seed); tk.R = tk.run().ghostRecorder.constructor; return 0; }, tape.seed);
  await launchTakeoverInPage(T.page, descriptor);
  const empty = await T.page.evaluate(() => window.__tk.snapshot());
  const phase1 = await seekToReady(T.page);
  const a1 = await T.page.evaluate(() => { const tk = window.__tk, r = tk.run(); return { tick: r.simClock.tick, fp: tk.fp(r), digests: window.__ssGameKit.digests(r), leafs: (() => { const c = window.__ssGameKit.capture(r).game; return JSON.stringify({ sled: c.sled, hazards: c.hazards, runRandom: c.runRandom }); })(), unranked: r.unrankedPractice, tp: !!r.tapePlayer, rec: !!r.ghostRecorder, seekTicks: r.takeover.seekTicks, seekMs: r.takeover.seekMs, startPractice: tk.events.filter((e) => e.name === 'runStart').map((e) => e.p) }; });
  check(`(a) N=${N} ${kind}: takeover reached READY at exactly N`, phase1 === 'ready' && a1.tick === N && a1.seekTicks === N, { phase1, tick: a1.tick });
  check(`(a) N=${N} ${kind}: 13-channel fingerprint at N == uninterrupted GHOST_REPLAY == the recording`, a1.fp === oracle.fp && a1.fp === rec.fps[N], { takeover: a1.fp, oracle: oracle.fp, recording: rec.fps[N] });
  const dKeys = Object.keys(oracle.digests);
  const diff = dKeys.filter((k) => JSON.stringify(oracle.digests[k]) !== JSON.stringify(a1.digests[k]));
  // The three kit keys that hash whole RunScene-owned objects (sled, hazards, runRandom) also contain fields the game's OWN
  // classification (fingerprintSchemas.NON_CAUSAL) calls presentation: sled.pose / squash / windPomAnchor, hazard spin / _lastDraw,
  // the visual* RNG streams. They are written by renderFrame / Sled.render / Hazard.update, which a seek skips by design
  // ("skip only draw, fx, audio and particles"). Every OTHER key (matter.*, terrain, camera, pool, ids, ...) must be identical, and
  // for those three the differing LEAVES must all be presentation fields.
  const leafKeys = ['sled', 'hazards', 'runRandom'];
  const hardDiff = diff.filter((k) => !leafKeys.includes(k));
  let leafReport = { leaves: [], bad: [] };
  if (diff.some((k) => leafKeys.includes(k))) {
    const [cA, cB] = [await O_leafs, a1.leafs];
    leafReport = presentationOnly(cA, cB);
  }
  check(`(a) N=${N} ${kind}: Heavy-kit digests() at N equal the uninterrupted GHOST_REPLAY on every sim key (${dKeys.length} keys; sled/hazards/runRandom only differ in NON_CAUSAL presentation leaves)`, hardDiff.length === 0 && leafReport.bad.length === 0, { hardDiff, bad: leafReport.bad.slice(0, 8), presentationLeaves: leafReport.leaves.slice(0, 12) });
  out.presentationLeavesDiffering = [...new Set(leafReport.leaves.map((l) => l.replace(/\.__obj/g, '').replace(/\.\d+/g, '.#')))];
  check(`N=${N} ${kind}: READY is unranked: practice+takeover RUN_START, no recorder, tape driver present`, a1.unranked === true && a1.startPractice.length === 1 && a1.startPractice[0].practice === true && a1.startPractice[0].takeover === true && a1.rec === false && a1.tp === true, a1);

  // ---- READY key (real Space): handoff; keep Space down only if the original pad at N+1 holds hop (so no edge, no phantom)
  const sched = padSchedule(tape, N);
  const b = await T.page.evaluate(async ({ N, sched, fps, endTick }) => {
    const tk = window.__tk, run = tk.run();
    tk.key('Space', true); tk.held.add('hop'); // the READY key: a REAL keyboard event
    tk.step(1);
    if (run.takeover.phase !== 'live' || run.simClock.tick !== N) return { error: 'handoff failed ' + run.takeover.phase + '@' + run.simClock.tick };
    const mism = [];
    let firstBad = null, crashTick = null;
    for (let i = 0; i < sched.length && !run.crashed; i++) {
      tk.hold(new Set(sched[i].names), sched[i].edgeHop);
      tk.step(1);
      const t = run.simClock.tick;
      if (fps[t] !== undefined && tk.fp(run) !== fps[t]) { if (firstBad === null) firstBad = t; mism.push(t); if (mism.length > 5) break; }
    }
    tk.releaseAll();
    crashTick = run.crashed ? run.simClock.tick : null;
    return { crashTick, cause: run.takeover.cause, firstBad, mism: mism.length, endTick, rows: run.ghostRecorder ? run.ghostRecorder.inputs.length : null };
  }, { N, sched, fps: rec.fps.map((v) => v ?? null), endTick });
  const expectedCrashTick = endTick + 1; // the recorder's endTick is the last SURVIVED tick; the crash happens on the next one
  check(`(b) N=${N} ${kind}: original pads through the LIVE input path reproduce every per-tick fingerprint to the end`, !b.error && b.firstBad === null && b.mism === 0, b);
  check(`(b) N=${N} ${kind}: same crash tick (${expectedCrashTick}) and cause (${info.lastCrash.cause})`, b.crashTick === expectedCrashTick && b.cause === info.lastCrash.cause, { crashTick: b.crashTick, cause: b.cause, want: [expectedCrashTick, info.lastCrash.cause] });

  // ---- the crash ends at the TakeoverEnd screen, never GameOver; nothing was written
  await until(T.page, '(tk)=>tk.g.scene.isActive("TakeoverEndScene")', 600);
  const end1 = await T.page.evaluate(() => { const tk = window.__tk; return { scenes: tk.scenes(), events: tk.events.map((e) => [e.name, e.p && (e.p.reason || e.p.practice)]), tape: tk.reg('lastTakeoverTape') ? { mode: tk.reg('lastTakeoverTape').mode, takeoverTick: tk.reg('lastTakeoverTape').takeoverTick, endTick: tk.reg('lastTakeoverTape').endTick, inputsEqualParent: null } : null, lastRecord: tk.reg('lastRecord') ?? null, lastGhostTape: tk.reg('lastGhostTape') ?? null }; });
  check(`N=${N} ${kind}: crash ends at TakeoverEndScene (not GameOver); RUN_ABORT takeover-ended practice+takeover; no RUN_END`, end1.scenes.includes('TakeoverEndScene') && !end1.scenes.includes('GameOverScene') && !end1.events.some((e) => e[0] === 'runEnd') && end1.events.some((e) => e[0] === 'runAbort' && e[1] === 'takeover-ended') && end1.lastRecord === null && end1.lastGhostTape === null, end1);
  const tkTape = await T.page.evaluate(() => JSON.parse(JSON.stringify(window.__tk.reg('lastTakeoverTape'))));
  check(`N=${N} ${kind}: the in-memory takeover tape is mode takeover, replays the parent's inputs/checkpoints exactly`, tkTape && tkTape.mode === 'takeover' && tkTape.takeoverTick === N && tkTape.endTick === endTick && JSON.stringify(tkTape.inputs) === JSON.stringify(tape.inputs) && JSON.stringify(tkTape.checkpoints) === JSON.stringify(tape.checkpoints) && tkTape.parentDigest === descriptor.parentDigest, { mode: tkTape?.mode, endTick: tkTape?.endTick, rowsEqual: tkTape && JSON.stringify(tkTape.inputs) === JSON.stringify(tape.inputs) });

  // ---- attempt 2 through the real RETRY button path (after the end screen's input grace): independent attempt, same state at N
  await T.page.waitForTimeout(800);
  await T.page.evaluate(() => { window.__tk.events.length = 0; window.__tk.key('Enter', true); window.__tk.key('Enter', false); });
  await until(T.page, '(tk)=>tk.g.scene.isActive("RunScene")', 200);
  const phase2 = await seekToReady(T.page);
  const a2 = await T.page.evaluate(() => { const tk = window.__tk, r = tk.run(); return { tick: r.simClock.tick, fp: tk.fp(r), src: r.takeover.descriptor.source, digests: window.__ssGameKit.digests(r) }; });
  // matter.ids hashes Matter's process-global monotonic id counter (Common._nextId), which a second run in the same page continues: not state.
  const diff2 = Object.keys(a1.digests).filter((k) => k !== 'matter.ids' && JSON.stringify(a1.digests[k]) !== JSON.stringify(a2.digests[k]));
  check(`(6) N=${N} ${kind}: RETRY from the end screen gives the SAME state-at-N fingerprint and every kit digest except Matter's global id counter as attempt 1 (independent attempt, source=retry)`, phase2 === 'ready' && a2.tick === N && a2.fp === a1.fp && diff2.length === 0 && a2.src === 'retry', { phase2, fp: [a1.fp, a2.fp], src: a2.src, diff2 });

  // ---- (c) divergence: different live input diverges and still ends unranked
  const c = await T.page.evaluate(async ({ N, fps, endTick }) => {
    const tk = window.__tk, run = tk.run();
    tk.key('Space', true); tk.held.add('hop'); tk.step(1);
    tk.hold(new Set());
    let diverged = null, n = 0;
    while (!run.crashed && n < 9000) {
      // coast with a constant tilt: nothing like the original script
      tk.hold(new Set(['tiltForward']));
      tk.step(1); n++;
      const t = run.simClock.tick;
      if (diverged === null && fps[t] !== undefined && tk.fp(run) !== fps[t]) diverged = t;
    }
    tk.releaseAll();
    return { diverged, crashed: run.crashed, ticks: run.simClock.tick, cause: run.takeover.cause };
  }, { N, fps: rec.fps.map((v) => v ?? null), endTick });
  await until(T.page, '(tk)=>tk.g.scene.isActive("TakeoverEndScene")', 600);
  const fin = await T.page.evaluate(async () => { const tk = window.__tk; return { snap: await tk.snapshot(), runEnd: tk.events.some((e) => e.name === 'runEnd'), runStarts: tk.events.filter((e) => e.name === 'runStart').map((e) => e.p), aborts: tk.events.filter((e) => e.name === 'runAbort').map((e) => e.p), scenes: tk.scenes() }; });
  check(`(c) N=${N} ${kind}: different live input diverges from the original (first at tick ${c.diverged}) and the run ends unranked at the end screen`, c.diverged !== null && c.diverged > N && c.crashed && !fin.runEnd && fin.runStarts.every((p) => p.practice === true && p.takeover === true) && fin.aborts.every((p) => p.practice === true) && fin.scenes.includes('TakeoverEndScene'), { c, runStarts: fin.runStarts, aborts: fin.aborts });
  // storage after BOTH takeover attempts (incl. both crash endings) vs the pre-takeover snapshot (taken after a plain boot run: the
  // boot run is not a takeover, so compare against a snapshot taken right after the takeover launch, before any takeover play)
  check(`(3) N=${N} ${kind}: localStorage, profile, runs/leaderboard, GhostLibrary IDB and evidence IDB byte-identical across two full takeover attempts`, fin.snap === empty || sameStorage(empty, fin.snap), { before: empty.length, after: fin.snap.length });
  check(`N=${N} ${kind}: no page errors`, T.errors.length === 0, T.errors);
  await T.close();
  out.oracleFp = oracle.fp; out.takeoverFp = a1.fp; out.crashTick = b.crashTick; out.cause = b.cause; out.divergedAt = c.diverged; out.seekTicks = a1.seekTicks; out.seekMs = Math.round(a1.seekMs);
  void base;
  return out;
}

/** Differing leaves between two kit captures, and which of them are NOT presentation per the game's own NON_CAUSAL table. */
function presentationOnly(aJson, bJson) {
  const A = JSON.parse(aJson), B = JSON.parse(bJson), leaves = [], bad = [];
  const isPresentation = (path) => {
    const seg = path.split('.').filter((x) => x && x !== '__obj');
    if (seg[0] === 'runRandom') return /^visual/.test(seg[1] || '');
    const table = seg[0] === 'sled' ? NON_CAUSAL.Sled : seg[0] === 'hazards' ? NON_CAUSAL.Hazard : null;
    return !!table && seg.slice(1).some((x) => Object.hasOwn(table, x) && /presentation|draw|render|animation/i.test(table[x]));
  };
  const walk = (a, b, path) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`); return; }
    leaves.push(path);
    if (!isPresentation(path)) bad.push([path, a, b]);
  };
  walk(A, B, '');
  return { leaves, bad };
}

/** Storage snapshots may differ only in registry objects that the takeover itself legitimately holds (none of the persisted stores). */
function sameStorage(a, b) {
  const A = JSON.parse(a), B = JSON.parse(b);
  return JSON.stringify(A.ls) === JSON.stringify(B.ls) && JSON.stringify(A.idb) === JSON.stringify(B.idb) &&
    ['profile', 'saveStore', 'ghosts', 'lastRecord', 'lastAwards', 'lastGhostTape', 'lastCrash', 'lastEvidenceStatus', 'missions'].every((k) => A.reg[k] === B.reg[k]);
}

async function uiPathAndSideEffects(main, tape, rec, Ns) {
  const { page } = main;
  console.log('UI path + side effects (main page, real scenes)');
  // A run that qualifies for the leaderboard opens the initials prompt, where T is a letter: skip it with Esc first (the same
  // thing a player does), let the deferred leaderboard write settle, THEN take the baseline.
  for (let i = 0; i < 4; i++) {
    const st = await page.evaluate(() => { const go = window.__tk.g.scene.getScene('GameOverScene'); if (go.skipReveal) go.skipReveal(); window.__tk.step(40); return { entry: !!go.entry }; });
    if (!st.entry) { if (i >= 1) break; else continue; }
    await page.evaluate(() => { window.__tk.key('Escape', true); window.__tk.key('Escape', false); window.__tk.step(5); });
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.__tk.step(10));
  const before = await page.evaluate(() => window.__tk.snapshot());
  // Game Over -> T opens the picker (real key), banner/eligibility, scrubbing keys, Enter launches
  await page.evaluate(() => { window.__tk.key('KeyT', true); window.__tk.key('KeyT', false); });
  const opened = await until(page, '(tk)=>!!tk.g.scene.getScene("GameOverScene").takeoverPicker', 40);
  const pk0 = await page.evaluate(() => { const p = window.__tk.g.scene.getScene('GameOverScene').takeoverPicker; return p && { tick: p.tick, max: p.max, ok: p.elig.ok, banner: p.constructor.name }; });
  check('UI: T on Game Over opens the picker; the last run is eligible; scrub range is [1, endTick-1]', opened && pk0 && pk0.ok === true && pk0.max === tape.endTick - 1, pk0);
  const scrub = await page.evaluate(() => {
    const tk = window.__tk, p = () => tk.g.scene.getScene('GameOverScene').takeoverPicker, st = (n = 3) => tk.step(n);
    const out = [];
    const t0 = p().tick;
    tk.key('ArrowLeft', true); tk.key('ArrowLeft', false); st(); out.push(['left', p().tick - t0]);
    const t1 = p().tick;
    tk.key('ShiftLeft', true, { shiftKey: true }); tk.key('ArrowRight', true, { shiftKey: true }); tk.key('ArrowRight', false, { shiftKey: true }); tk.key('ShiftLeft', false); st(); out.push(['shift+right', p().tick - t1]);
    const t2 = p().tick;
    tk.key('Comma', true); tk.key('Comma', false); st(); out.push(['comma', p().tick - t2]);
    const t3 = p().tick;
    tk.key('Period', true); tk.key('Period', false); st(); out.push(['period', p().tick - t3]);
    return out;
  });
  const want = { left: -120, 'shift+right': 600, comma: -1, period: 1 };
  check('UI: picker scrubbing: Left = 1 s, Shift+Right = 5 s, "," = -1 tick, "." = +1 tick', scrub.every(([k, d]) => d === want[k]), scrub);
  // pick a tick (setTick is the same code path the keys use) and launch with Enter
  const target = Ns.hazardOrContact;
  await page.evaluate((n) => window.__tk.g.scene.getScene('GameOverScene').takeoverPicker.setTick(n), target);
  await page.evaluate(() => { window.__tk.key('Enter', true); window.__tk.key('Enter', false); });
  await until(page, '(tk)=>tk.g.scene.isActive("RunScene") && tk.run().takeover', 200);
  const ph = await seekToReady(page);
  const ui1 = await page.evaluate(() => { const tk = window.__tk, r = tk.run(); return { tick: r.simClock.tick, fp: tk.fp(r), src: r.takeover.descriptor.source, hud: tk.g.scene.getScene('UIScene')?.practiceTag?.visible, hudText: tk.g.scene.getScene('UIScene')?.practiceTag?.main?.text }; });
  check('UI: Enter on the picker starts the takeover from the real tape: READY at the chosen tick, HUD tag TAKEOVER // UNRANKED', ph === 'ready' && ui1.tick === target && ui1.fp === rec.fps[target] && ui1.src === 'last-run' && ui1.hud === true && /TAKEOVER/.test(ui1.hudText || ''), ui1);
  // PAUSE in READY: ranked items hidden, RESTART = retry from the same tick (never a new ranked run)
  await page.evaluate(() => { window.__tk.key('Escape', true); window.__tk.key('Escape', false); });
  await until(page, '(tk)=>tk.g.scene.isActive("PauseScene")', 30);
  const pz = await page.evaluate(() => { const p = window.__tk.g.scene.getScene('PauseScene'); return { takeoverRun: p.takeoverRun, gym: p.gymPractice, title: p.panel?.titleText?.main?.text ?? null }; });
  check('UI: Pause during a takeover is marked takeover (ranked items hidden)', pz.takeoverRun === true && pz.gym === true, pz);
  await page.evaluate(() => { window.__tk.g.scene.getScene('PauseScene').restart(); window.__tk.g.headlessStep(window.__tk.t += 8.33, 8.33); });
  await until(page, '(tk)=>tk.g.scene.isActive("RunScene") && tk.run().takeover', 60);
  const ph2 = await seekToReady(page);
  const rs = await page.evaluate(() => { const tk = window.__tk, r = tk.run(); return { tick: r.simClock.tick, fp: tk.fp(r), src: r.takeover.descriptor.source, starts: tk.events.filter((e) => e.name === 'runStart').map((e) => e.p) }; });
  check('UI: Pause > RESTART = retry from the SAME tick of the same tape, unranked (not a new ranked run)', ph2 === 'ready' && rs.tick === target && rs.fp === ui1.fp && rs.src === 'retry' && rs.starts.every((p) => p.practice === true && p.takeover === true), rs);
  // play a bit, then QUIT from the pause menu: end screen, tape kept in memory only
  await page.evaluate(() => { const tk = window.__tk; tk.key('Space', true); tk.step(1); tk.key('Space', false); tk.step(60); });
  await page.evaluate(() => { window.__tk.key('Escape', true); window.__tk.key('Escape', false); });
  await until(page, '(tk)=>tk.g.scene.isActive("PauseScene")', 30);
  await page.evaluate(() => { window.__tk.g.scene.getScene('PauseScene').quit(); });
  await until(page, '(tk)=>tk.g.scene.isActive("TakeoverEndScene")', 60);
  const q = await page.evaluate(() => { const tk = window.__tk; return { scenes: tk.scenes(), tape: tk.reg('lastTakeoverTape') && { mode: tk.reg('lastTakeoverTape').mode, endTick: tk.reg('lastTakeoverTape').endTick }, abort: tk.events.filter((e) => e.name === 'runAbort').map((e) => e.p).at(-1), runEnd: tk.events.some((e) => e.name === 'runEnd') }; });
  check('UI: Pause > QUIT in a live takeover ends at the takeover end screen with RUN_ABORT takeover-ended (practice, takeover), tape in memory, no RUN_END', q.scenes.includes('TakeoverEndScene') && !q.runEnd && q.abort && q.abort.reason === 'takeover-ended' && q.abort.practice === true && q.abort.takeover === true && q.tape && q.tape.mode === 'takeover' && q.tape.endTick > target, q);
  // finish via a real crash ending too (zero-side-effects must include it): retry, hand over, coast to the crash
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__tk.key('Enter', true); window.__tk.key('Enter', false); });
  await until(page, '(tk)=>tk.g.scene.isActive("RunScene") && tk.run().takeover', 200);
  await seekToReady(page);
  await page.evaluate(() => { const tk = window.__tk; tk.key('Space', true); tk.step(1); tk.key('Space', false); tk.held.clear(); });
  const crashed = await until(page, '(tk)=>tk.run().crashed', 12000);
  await until(page, '(tk)=>tk.g.scene.isActive("TakeoverEndScene")', 600);
  const after = await page.evaluate(() => window.__tk.snapshot());
  check('UI: a coasting takeover reaches a real crash and the end screen', crashed, {});
  check('(3) main page: localStorage, profile, runs, leaderboard, GhostLibrary IDB and evidence IDB byte-identical before vs after the picker, pause, quit and crash endings', sameStorage(before, after), { before: before.length, after: after.length });
  const ls = JSON.parse(before).ls, ls2 = JSON.parse(after).ls;
  check('(3) no tutorial / tuck-hint flag written during takeover', JSON.stringify(ls) === JSON.stringify(ls2), { a: Object.keys(ls), b: Object.keys(ls2) });
  check('main page: no page errors', main.errors.length === 0, main.errors);
}

async function negativeControls(main, tape, Ns) {
  const { page } = main;
  const out = [];
  const N = Ns.hazardOrContact;
  const clone = () => JSON.parse(JSON.stringify(tape));
  const HOP_EDGE = 1 << 12;
  const mk = (tp, tick = N, over = {}) => ({ ...buildTakeoverDescriptor({ tape: tape, tick, source: 'neg' }), tape: tp, tick, ...over });
  const cases = [];
  { const t = clone(); const i = t.inputs.findIndex((r) => r[1] & HOP_EDGE); t.inputs[i][1] &= ~HOP_EDGE; cases.push(['tampered tape (mutated input row before N)', buildTakeoverDescriptor({ tape: t, tick: Math.min(endTickOf(tape) - 1, Math.max(N, (t.inputs.slice(0, i + 1).reduce((s, r) => s + r[0], 0)) + 500)), source: 'neg' }), 'desync']); }
  { const t = clone(); t.simRevision = tape.simRevision - 1; cases.push(['simRevision mismatch', mk(t), 'sim-revision']); }
  { const t = clone(); delete t.rulesetId; cases.push(['unstamped (older-build) tape', mk(t, N, { rulesetId: undefined }), 'older-build']); }
  { const t = clone(); t.checkpoints = t.checkpoints.slice(0, 1); cases.push(['truncated prefix', mk(t), 'prefix-uncovered']); }
  cases.push(['tick out of range', { ...buildTakeoverDescriptor({ tape, tick: N, source: 'neg' }), tick: tape.endTick + 9 }, 'tick']);
  for (const [name, desc, reason] of cases) {
    const r = await page.evaluate(async ({ d }) => {
      const tk = window.__tk, g = tk.g;
      for (const s of g.scene.getScenes(true)) g.scene.stop(s.sys.settings.key);
      g.registry.set('takeoverDescriptor', d); g.registry.set('seed', d.tape.seed); g.registry.set('biomeMask', d.tape.biomeMask);
      g.registry.set('dailyOfficial', false); g.registry.set('bsodGymMode', false);
      tk.events.length = 0;
      const lastTapeBefore = g.registry.get('lastGhostTape')?.runId;
      g.scene.start('RunScene'); g.headlessStep(0, 0);
      let n = 0;
      while (n++ < 4000 && !g.scene.isActive('TitleScene')) tk.step(1);
      tk.step(3);
      const find = (o, depth = 0) => { const hits = []; const walk = (x, d) => { if (!x || d > 8) return; if (x.main && typeof x.main.text === 'string') hits.push(x.main.text); (x.list || []).forEach((c) => walk(c, d + 1)); }; walk(o, depth); return hits; };
      const title = g.scene.getScene('TitleScene');
      const texts = find({ list: title.children.list });
      const run = tk.run();
      return {
        title: g.scene.isActive('TitleScene'), runActive: g.scene.isActive('RunScene'), recorder: !!(run && run.ghostRecorder), sled: !!(run && run.sled),
        starts: tk.events.filter((e) => e.name === 'runStart').map((e) => e.p), aborts: tk.events.filter((e) => e.name === 'runAbort').map((e) => e.p), runEnd: tk.events.some((e) => e.name === 'runEnd'),
        notice: texts.filter((t) => /TAKEOVER CANCELLED/.test(t)).length, noticeLeft: g.registry.get('takeoverNotice') ?? null,
        lastTapeUnchanged: g.registry.get('lastGhostTape')?.runId === lastTapeBefore, phase: run?.takeover?.phase ?? null, abort: run?.takeover?.abort?.reason ?? null,
      };
    }, { d: JSON.parse(JSON.stringify(desc)) });
    const refusedEarly = reason !== 'desync';
    const ok = r.title && !r.runActive && !r.recorder && !r.runEnd && r.starts.every((p) => p.practice === true && p.takeover === true) && (refusedEarly ? r.starts.length === 0 : true) &&
      r.aborts.some((p) => p.practice === true && p.takeover === true && (refusedEarly ? p.reason === 'takeover-refused' && p.why === reason : p.reason === 'takeover-aborted' && p.why === 'desync')) && r.notice >= 1 && r.noticeLeft === null && r.lastTapeUnchanged;
    check(`negative: ${name} -> refuses (${reason}), notice shown, ends at TITLE, no ranked run / no recorder / no non-practice RUN_START`, ok, r);
    out.push({ name, reason, ...r });
    // back to a known scene for the next control
    await page.evaluate(() => { const tk = window.__tk; tk.step(2); });
  }
  const noRank = await page.evaluate(() => window.__tk.events.filter((e) => e.name === 'runStart' && e.p.practice !== true).length);
  check('negative controls: not one RUN_START without practice:true fired', noRank === 0, { noRank });
  return out;
}
const endTickOf = (t) => t.endTick;

async function handoffKey(tape, rec, Ns) {
  console.log('handoff key');
  const N = Ns.early;
  const P = await freshPage({ kit: true });
  await P.page.evaluate((seed) => { const tk = window.__tk; tk.startRun(seed); tk.R = tk.run().ghostRecorder.constructor; }, tape.seed);
  const run = async (readyCode, holdAfter, freshPressAtNext) => {
    await launchTakeoverInPage(P.page, buildTakeoverDescriptor({ tape, tick: N, source: 'key' }));
    await seekToReady(P.page);
    return P.page.evaluate(({ readyCode, holdAfter, freshPressAtNext, N }) => {
      const tk = window.__tk, r = tk.run();
      tk.key(readyCode, true);
      tk.step(1); // READY consumed here: no tick runs
      const atHandoff = { phase: r.takeover.phase, tick: r.simClock.tick };
      if (!holdAfter) tk.key(readyCode, false);
      if (freshPressAtNext) { tk.key(readyCode, false); tk.key(readyCode, true); }
      tk.step(3);
      if (holdAfter || freshPressAtNext) tk.key(readyCode, false);
      tk.step(1);
      // decode the recorded rows that apply AFTER tick N
      let at = 0; const rows = [];
      for (const row of r.ghostRecorder.inputs) { at += row[0]; if (at > N) rows.push({ tick: at, bits: row[1], edges: (row[1] >> 12) & 63 }); }
      return { atHandoff, tickAfter: r.simClock.tick, rows };
    }, { readyCode, holdAfter, freshPressAtNext, N });
  };
  const space = await run('Space', true, false);
  check('(5) handoff key: Space held through the first live ticks records hop HELD but NO edge bits on ticks N+1..N+3', space.atHandoff.phase === 'live' && space.atHandoff.tick === N && space.rows.some((r) => r.tick === N + 1 && ((r.bits >> 7) & 1) === 1) && space.rows.filter((r) => r.tick <= N + 3).every((r) => r.edges === 0), space);
  const enter = await run('Enter', true, false);
  check('(5) handoff key: Enter (confirm) as the READY key produces no edge bit either', enter.atHandoff.phase === 'live' && enter.rows.filter((r) => r.tick <= N + 3).every((r) => r.edges === 0), enter);
  const control = await run('Space', true, true);
  check('(5) negative control: a FRESH Space press after handoff DOES record a hop edge (so the check can fail)', control.rows.some((r) => r.tick > N && (r.edges & 1) === 1), control);
  check('(5) no page errors', P.errors.length === 0, P.errors);
  await P.close();
}

async function throughput(tape, rec) {
  console.log('throughput (14,400+ tick tape)');
  // the main recording is used when it is long enough; else a second, longer scripted run is recorded
  let useTape = tape, ticks = tape.endTick;
  if (ticks < 14400) {
    console.log(`main tape is ${ticks} ticks; recording a longer run for the throughput measurement`);
    const alt = await recordAlt();
    useTape = alt.tape; ticks = useTape.endTick;
  }
  const N = ticks - 1;
  const P = await freshPage({ kit: true });
  await P.page.evaluate((seed) => { const tk = window.__tk; tk.startRun(seed); tk.R = tk.run().ghostRecorder.constructor; }, useTape.seed);
  await launchTakeoverInPage(P.page, buildTakeoverDescriptor({ tape: useTape, tick: N, source: 'throughput' }));
  const wall0 = Date.now();
  const r = await P.page.evaluate(({ N }) => {
    const tk = window.__tk;
    const t0 = performance.now();
    let frames = 0, maxFrameTicks = 0, maxFrameMs = 0, last = 0;
    for (let i = 0; i < 20000; i++) {
      const run = tk.run();
      if (run.takeover.phase !== 'seeking') break;
      const f0 = performance.now();
      tk.step(1); frames++;
      const f1 = performance.now();
      maxFrameTicks = Math.max(maxFrameTicks, run.simClock.tick - last); last = run.simClock.tick;
      maxFrameMs = Math.max(maxFrameMs, f1 - f0);
    }
    const run = tk.run();
    return { phase: run.takeover.phase, tick: run.simClock.tick, seekTicks: run.takeover.seekTicks, seekMs: run.takeover.seekMs, wallMs: performance.now() - t0, frames, maxFrameTicks, maxFrameMs, fp: tk.fp(run) };
  }, { N });
  void wall0;
  const tps = r.seekTicks / (r.seekMs / 1000);
  const out = { tapeTicks: ticks, N, ...r, ticksPerSecSeekOnly: Math.round(tps), ticksPerSecWall: Math.round(r.seekTicks / (r.wallMs / 1000)), seekSecondsFor2Min: Math.round((14400 / tps) * 100) / 100 };
  check(`throughput: seek of a ${ticks}-tick prefix completes to READY at N, bounded per frame`, r.phase === 'ready' && r.tick === N && r.maxFrameTicks <= 1500, out);
  check('throughput: state at the end of the long seek matches the recording (when the long tape is the main tape)', useTape !== tape || r.fp === rec.fps[N], { got: r.fp, want: rec.fps[N] });
  await P.close();
  console.log('THROUGHPUT ' + JSON.stringify(out));
  return out;
}

async function recordAlt() {
  const P = await freshPage({ kit: true });
  const seedAlt = process.env.BSB_TAKEOVER_LONG_SEED || 'bot6';
  await P.page.evaluate((seed) => {
    const tk = window.__tk; tk.startRun(seed); tk.R = tk.run().ghostRecorder.constructor;
    const run = tk.run(); let n = 0;
    while (!run.crashed && n < 40000) { const { wanted, edge } = tk.botWanted(); tk.hold(wanted, edge); tk.step(1); n++; }
    tk.releaseAll();
  }, seedAlt);
  await until(P.page, '(tk)=>tk.g.registry.get("lastGhostTape")', 600);
  const tape = await P.page.evaluate(() => JSON.parse(JSON.stringify(window.__tk.g.registry.get('lastGhostTape'))));
  await P.close();
  return { tape };
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 2; });
