/** #129: one bounded stock normal fixture on two separately compiled adjacent releases. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { REG } from '../../src/constants.js';
import { CHECKPOINT_EVERY } from '../../src/systems/ghost/GhostTape.js';
import { tapeCompatible } from '../../src/systems/ghost/GhostLibrary.js';
import { EVIDENCE_STATUS_KEY, RULESET_KEY } from '../../src/systems/replay/evidenceCapture.js';
import { EVIDENCE_DB } from '../../src/systems/replay/evidenceStore.js';
import { FP_SUBSYSTEMS } from '../../src/systems/replay/fingerprintSchemas.js';
import { PILOT, PILOT_KEYS, pilotWithinDeadline } from '../sim/hands-off-pilot.js';
import { compareStockAdjacentArms } from './stock-adjacent-ab-guards.js';

const builds = [
  {
    commit: '06c3a954e71519a076faedcd482dc248837fc471', version: '2.19.6', simRevision: 3,
    ruleset: 'sha256:0416d4bbba29eaef24ecafceb5e9e8b93a7d6591e4c2dd3b6b5f4a783eae8fc4',
    entry: '/assets/index-tD9q_TrK.js',
    modules: {
      '/assets/index-tD9q_TrK.js': '875c42dbbc14bd2da7245f902dadf2757299fd094365ab65c200c4c4c8e5dfeb',
      '/assets/runtimeRuleset-CzltZB1H.js': '688c413414ac7e6abb3bbd447765fe09d64d8f3270c0e390fa343bd67216e28c',
      '/assets/0416d4bbba29eaef24ecafceb5e9e8b93a7d6591e4c2dd3b6b5f4a783eae8fc4-w3vCvWN1.js': 'd7a541f3eab5b2e025926a6e443d60f5b1b4fdfa0b423f77978dc44cd4aae546',
    },
  },
  {
    commit: 'f765b5e41e9b9fc2a7077c44ad9e3fb38d4b3730', version: '2.19.7', simRevision: 4,
    ruleset: 'sha256:89e2cdab9ef00590149b8bf3953626320171b8eae0c8e6fe6013e1c4f5965cbc',
    entry: '/assets/index-BmkxY13L.js',
    modules: {
      '/assets/index-BmkxY13L.js': '3ee8f69b4960900fccaad961d9e8cc920e37ac198608934804496fc9759db2ed',
      '/assets/runtimeRuleset-BB2umlg7.js': '6077cfa8d1c836e0a6ccf63a2070487bd09dcff0b40c83fff84c4042484249cd',
      '/assets/89e2cdab9ef00590149b8bf3953626320171b8eae0c8e6fe6013e1c4f5965cbc-B0qeDDef.js': '3efa212f77eece30883b9410e5e8c603badd22e87a4fe91f365646dd29fab2e0',
    },
  },
];
const p = { ...PILOT, checkpointEvery: CHECKPOINT_EVERY };
const k = { ...PILOT_KEYS, rule: RULESET_KEY, awards: REG.LAST_AWARDS, evidence: EVIDENCE_STATUS_KEY, evidenceDb: EVIDENCE_DB };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
class ProofError extends Error {}
const requireProof = (ok, message) => { if (!ok) throw new ProofError(message); };

function previewUrl(value) {
  const port = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/$/.exec(value)?.[1];
  requireProof(port && Number(port) <= 65535, 'Use two HTTP 127.0.0.1 preview roots with explicit ports.');
  return new URL(value);
}

/** Runs inside one clean browser context. No controls, terrain, physics or crash are injected. */
async function witness({ p, k, tape }) {
  const require = (ok, message) => { if (!ok) throw new Error(message); };
  const game = window.__bbGame, reg = game.registry, run = game.scene.getScene(k.run);
  game.loop.sleep();
  reg.set(k.seed, p.seed);
  reg.set(k.mask, p.biomeMask);
  reg.set(k.dailyOfficial, false);
  game.scene.stop(k.title);
  game.scene.start(k.run);
  game.headlessStep(0, 0);
  require(run.sys.isActive() && run.simClock.tick === 0 && run.ghostRecorder && !run.tapePlayer,
    'Stock recorder unavailable');
  const header = run.ghostRecorder.header;
  const Recorder = run.ghostRecorder.constructor;
  const observer = tape ? new Recorder({}) : run.ghostRecorder;
  if (tape) {
    game.scene.stop(k.run);
    reg.set(k.replay, tape);
    game.scene.start(k.run);
    game.headlessStep(0, 0);
  }
  require(run.sys.isActive() && run.simClock.tick === 0 &&
    Boolean(run.ghostRecorder) !== Boolean(tape) && Boolean(run.tapePlayer) === Boolean(tape) &&
    (!tape || run.tapePlayer.tape === tape) && run.seed === p.seed && run.biomeMask === p.biomeMask &&
    !run.dailyOfficial && !run.bsodGym && run.dailyMode !== 'draft' && run.dailyRuleId === p.dailyRuleId &&
    run.startedAt === Date.parse(p.calendarUtc) && run.settings.controlLayout === p.controlLayout &&
    run.appliedBoosts.length === 0 && !run.upgradeRun.enabled && Object.keys(run.upgradeRun.ranks).length === 0 &&
    run.magnetsDrop === false && run.kodiaksOn === false && run.kodiakPackMode === 'same', 'Stock configuration mismatch');

  const rows = [], terminals = [];
  const onCrash = (e) => {
    if (e.fatal === true && e.negated === false && e.runId === run.runId) {
      terminals.push({ tick:run.simClock.tick, cause:e.cause, hazardId:e.hazardId ?? null, x:e.x, y:e.y, speedPxS:e.speedPxS });
    }
  };
  game.events.on(k.crash, onCrash);
  const original = run.simTick, hadOwn = Object.hasOwn(run, 'simTick');
  run.simTick = function (...args) {
    const result = original.apply(this, args);
    if (!this.crashed) {
      const body = this.sled.body, tick = this.simClock.tick;
      rows.push({ tick, x:body.position.x, y:body.position.y, angle:body.angle,
        vx:body.velocity.x, vy:body.velocity.y, angularVelocity:body.angularVelocity,
        score:this.score.getTotal(), grounded:this.sled.grounded });
      if (tape && tick % p.checkpointEvery === 0) observer._fingerprint(tick, this);
    }
    return result;
  };
  const dt = 1000 / p.simTickHz;
  try {
    for (let tick = 1; tick <= p.deadlineSeconds * p.simTickHz && !run.crashed; tick++) {
      game.headlessStep(tick * dt, dt);
      require(run.simClock.tick === tick && run.simClock.droppedMs === 0, 'Fixed-tick stepping failed');
    }
  } finally {
    game.events.off(k.crash, onCrash);
    if (hadOwn) run.simTick = original; else delete run.simTick;
  }
  require(run.crashed && terminals.length === 1 && terminals[0].tick === rows.length + 1 &&
    run.simClock.tick === terminals[0].tick, 'No single natural finish within the fixed cap');
  const out = { header, rows, terminal:terminals[0], fps:observer.fingerprints, fpErrors:observer.fingerprintErrorCount };
  if (!tape) return { ...out, tape:reg.get(k.tape) ?? null };
  const store = reg.get(k.saveStore), ghosts = reg.get(k.ghostLibrary);
  return { ...out, checked:run.tapePlayer.checked, desync:run.tapePlayer.desync,
    wrote:Boolean(reg.get(k.record) || reg.get(k.tape) || reg.get(k.awards) || reg.get(k.evidence) ||
      (await store.getRecentRuns(1)).length || ghosts.courses.size || ghosts.tapes.size ||
      (await indexedDB.databases()).some(({ name }) => name === k.evidenceDb)) };
}

async function trial(browser, url, build, stagedTape) {
  const context = await browser.newContext({ viewport:{ width:960, height:540 }, serviceWorkers:'block' });
  const checked = new Set();
  let failed = false, closing = false;
  const routeError = (error) => {
    if (!closing || !/disposed|closed|cancelled|canceled/i.test(String(error))) failed = true;
  };
  try {
    await context.route('**/*', async (route) => {
      try {
        const request = route.request(), dest = new URL(request.url());
        if (dest.origin !== url.origin || !['GET', 'HEAD'].includes(request.method())) return await route.abort();
        const response = await route.fetch({ maxRedirects:0 });
        if (closing) return;
        if (response.status() >= 300 && response.status() < 400) return await route.abort();
        if (Object.hasOwn(build.modules, dest.pathname)) {
          if (response.status() !== 200 || sha(await response.body()) !== build.modules[dest.pathname]) {
            failed = true;
            return await route.abort();
          }
          checked.add(dest.pathname);
        }
        await route.fulfill({ response });
      } catch (error) { routeError(error); if (!closing) await route.abort().catch(routeError); }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close().catch(routeError));
    const page = await context.newPage();
    page.on('pageerror', routeError);
    await page.clock.setFixedTime(new Date(p.calendarUtc));
    await page.goto(url.href, { waitUntil:'domcontentloaded', timeout:20_000 });
    const boot = await page.locator('script[type=module][src]').getAttribute('src', { timeout:5_000 });
    requireProof(!failed && boot === build.entry && checked.has(boot), 'Use the pinned compiled game previews in A/B order.');
    await page.waitForFunction(({ k, id }) => window.__bbGame?.scene?.isActive(k.title) &&
      window.__bbGame.registry.get(k.rule)?.rulesetId === id, { k, id:build.ruleset }, { timeout:15_000 });
    requireProof(!failed && Object.keys(build.modules).every((path) => checked.has(path)), 'Pinned active ruleset modules were not loaded.');
    const result = await pilotWithinDeadline(page.evaluate(witness, { p, k, tape:stagedTape }), 45_000);
    requireProof(!failed, 'Browser or route failed during an isolated trial.');
    return result;
  } finally { closing = true; await context.close(); }
}

function matchesCadence(row, count) {
  return row.fpErrors === 0 && row.fps.length === count && row.fps.every((f, i) =>
    f.tick === (i + 1) * CHECKPOINT_EVERY && /^xxh32x2:[0-9a-f]{16}$/.test(f.combined) &&
    Object.keys(f.subsystems).length === FP_SUBSYSTEMS.length &&
    FP_SUBSYSTEMS.every((name) => /^xxh32x2:[0-9a-f]{16}$/.test(f.subsystems[name])));
}

async function measure(browser, url, build) {
  let phase = 'capture';
  try {
    const live = await trial(browser, url, build, null);
    const { header, tape, terminal, rows } = live;
    const count = Math.floor(rows.length / CHECKPOINT_EVERY);
    requireProof(tapeCompatible(tape) && header.mode === 'normal' && header.edgeRows === 'every-tick' &&
      Object.entries(header).every(([key,value]) => Object.hasOwn(tape,key) && isDeepStrictEqual(tape[key],value)) &&
      tape.endTick === rows.length && isDeepStrictEqual(tape.inputs, [[1,6,0]]) &&
      count > 0 && tape.checkpoints.length === count &&
      tape.checkpoints.every((row,i) => row.length === 8 && row[0] === (i+1) * CHECKPOINT_EVERY &&
        row.every(Number.isFinite) && Number.isSafeInteger(row[7])) && matchesCadence(live,count),
    'Native capture did not match the fixed neutral tape and checkpoint shape.');
    phase = 'native repeat';
    for (let i = 0; i < 2; i++) {
      const played = await trial(browser, url, build, tape);
      requireProof(played.checked === count && played.desync === null && played.wrote === false &&
        matchesCadence(played, count) && isDeepStrictEqual(played.header, header) &&
        isDeepStrictEqual(played.rows, rows) && isDeepStrictEqual(played.fps, live.fps) &&
        isDeepStrictEqual(played.terminal, terminal), 'Native same-build repeat did not match or wrote data.');
    }
    return { match:{ header, inputs:tape.inputs }, rows, terminal, nativeCheckpoints:count };
  } catch (error) {
    const known = /Stock recorder unavailable|Stock configuration mismatch|Fixed-tick stepping failed|No single natural finish within the fixed cap/.exec(String(error?.message));
    const details = error instanceof ProofError ? error.message : known?.[0] ?? 'Local browser proof failed or timed out.';
    throw new ProofError(`${build.version} ${phase}: ${details}`);
  }
}

async function main() {
  let flags;
  try { flags = parseArgs({ options:{ a:{ type:'string' }, b:{ type:'string' } } }).values; }
  catch { throw new ProofError('Use --a and --b with the fixed compiled loopback previews.'); }
  const a = previewUrl(flags.a), b = previewUrl(flags.b);
  requireProof(a.origin !== b.origin, 'Use separate loopback origins for A and B.');
  const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE,
    args:['--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  let report;
  try {
    const ar = await measure(browser, a, builds[0]);
    const br = await measure(browser, b, builds[1]);
    report = { kind:'local-stock-adjacent-replay-ab', version:1, chromium:browser.version(),
      scope:'One synthetic neutral fixture. Native replay only within each compiled build; no historical compatibility or player claim.',
      builds, fixture:{ seed:p.seed, biomeMask:p.biomeMask, date:p.calendarUtc, dailyRuleId:p.dailyRuleId,
        controlLayout:p.controlLayout, kodiaks:false, loadout:'none', tickHz:p.simTickHz, tickCap:p.deadlineSeconds*p.simTickHz },
      freshNativeReplaysPerBuild:2, result:compareStockAdjacentArms(ar, br) };
  } finally { await browser.close(); }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`Stock A/B: ${error instanceof ProofError ? error.message : 'Local proof did not complete.'}`);
  process.exitCode = 1;
});
