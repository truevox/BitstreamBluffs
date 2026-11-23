/** #77: native stock neutral panel in an exact loopback build; developer QA only. */
import { createHash } from 'node:crypto';
import { REG } from '../../src/constants.js';
import { EVIDENCE_STATUS_KEY, RULESET_KEY } from '../../src/systems/replay/evidenceCapture.js';
import { EVIDENCE_DB } from '../../src/systems/replay/evidenceStore.js';
import { PILOT_KEYS, pilotWithinDeadline } from './hands-off-pilot.js';
import { BUILD, PANEL, inspectCapture, parsePanelOptions, reportTrial } from './hands-off-panel.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const keys = { ...PILOT_KEYS, rule: RULESET_KEY, evidence: EVIDENCE_STATUS_KEY, awards: REG.LAST_AWARDS, evidenceDb: EVIDENCE_DB };

// Serialized into the pinned compiled preview. Only the ordinary seed/mask route and normal TapePlayer startup are set.
async function drivePanelTrial({ p, k, seed, tape }) {
  const require = (ok, message) => { if (!ok) throw new Error(message); };
  const game = window.__bbGame, reg = game.registry, run = game.scene.getScene(k.run);
  game.loop.sleep();
  reg.set(k.seed, seed); reg.set(k.mask, p.biomeMask); reg.set(k.dailyOfficial, false);
  game.scene.stop(k.title);
  game.scene.start(k.run);
  game.headlessStep(0, 0);
  require(run.sys.isActive() && run.simClock.tick === 0 && run.ghostRecorder && !run.tapePlayer,
    'Could not initialize the stock normal recorder');
  // A detached recorder reads the existing native fingerprint method in playback without recording or saving a run.
  const Recorder = run.ghostRecorder.constructor;
  const observer = tape ? new Recorder({}) : run.ghostRecorder;
  if (tape) {
    game.scene.stop(k.run);
    reg.set(k.replay, tape);
    game.scene.start(k.run);
    game.headlessStep(0, 0);
  }
  require(run.sys.isActive() && run.simClock.tick === 0 && run.seed === seed && run.biomeMask === p.biomeMask &&
    Boolean(run.tapePlayer) === Boolean(tape) && Boolean(run.ghostRecorder) !== Boolean(tape) &&
    (!tape || run.tapePlayer.tape === tape) && !run.bsodGym && !run.dailyOfficial && run.dailyMode !== 'draft' &&
    run.dailyRuleId === p.dailyRuleId && run.startedAt === Date.parse(p.calendarUtc) &&
    run.settings.controlLayout === p.controlLayout && run.appliedBoosts.length === 0 && !run.upgradeRun.enabled &&
    !Object.keys(run.upgradeRun.ranks).length && !run.kodiaksOn && !run.magnetsDrop && run.kodiakPackMode === 'same',
  'Could not initialize a matched stock neutral trial');

  let fatal = null, fatalCount = 0, reachedTick = null, peakM = 0;
  const onCrash = (e) => {
    if (e.fatal === true && e.negated === false && e.runId === run.runId) {
      fatalCount++;
      fatal = { tick: run.simClock.tick, cause: e.cause, hazardId: e.hazardId ?? null, x: e.x, y: e.y,
        speedPxS: e.speedPxS, distanceM: (e.x - run.startX) / p.pixelsPerMeter };
    }
  };
  game.events.on(k.crash, onCrash);
  const simTick = run.simTick, hadOwn = Object.hasOwn(run, 'simTick');
  if (tape) run.simTick = function (...args) {
    const result = simTick.apply(this, args);
    // Match native recorder phase and cadence. Never fingerprint the fatal tick as a completed tick.
    if (!this.crashed && this.simClock.tick % p.checkpointEvery === 0) observer._fingerprint(this.simClock.tick, this);
    return result;
  };
  try {
    const dt = 1000 / p.tickHz;
    for (let tick = 1; tick <= p.limitTicks && !run.crashed; tick++) {
      game.headlessStep(tick * dt, dt);
      require(run.simClock.tick === tick && run.simClock.droppedMs === 0, 'Unexpected fixed-step cadence');
      if (!run.crashed) {
        const meters = (run.sled.x - run.startX) / p.pixelsPerMeter;
        require(Number.isFinite(meters), 'Nonfinite distance in stock trial');
        peakM = Math.max(peakM, meters);
        if (reachedTick === null && meters >= p.targetM) reachedTick = tick;
      }
    }
  } finally {
    game.events.off(k.crash, onCrash);
    if (tape) {
      if (hadOwn) run.simTick = simTick; else delete run.simTick;
    }
  }
  const ticks = run.simClock.tick;
  require(run.crashed ? fatalCount === 1 && fatal.tick === ticks : fatalCount === 0 && ticks === p.limitTicks,
    'Ambiguous terminal state in stock trial');
  const observations = { seed, ticks, peakM, reachedTick, fatal, fingerprints: observer.fingerprints,
    fingerprintErrors: observer.fingerprintErrorCount };
  if (!tape) return { ...observations, inputs: observer.inputs, tape: reg.get(k.tape) ?? null };

  // The native ghost/score reads are checked within the fresh playback context, never written by this probe.
  const store = reg.get(k.saveStore), ghosts = reg.get(k.ghostLibrary);
  const playbackSaved = Boolean(reg.get(k.record) || reg.get(k.tape) || reg.get(k.awards) || reg.get(k.evidence) ||
    (await store.getRecentRuns(1)).length || ghosts.courses.size || ghosts.tapes.size ||
    (await indexedDB.databases()).some(({ name }) => name === k.evidenceDb));
  return { ...observations, checked: run.tapePlayer.checked, desync: run.tapePlayer.desync, playbackSaved };
}

async function trial(browser, url, seed, tape = null) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  const checked = new Set();
  let closing = false, failed = false;
  const onError = (error) => {
    if (!closing || !/closed|disposed|cancelled|canceled/i.test(String(error))) failed = true;
  };
  try {
    await context.route('**/*', async (route) => {
      try {
        const request = route.request(), target = new URL(request.url());
        if (target.origin !== url.origin || !['GET', 'HEAD'].includes(request.method())) return await route.abort();
        const response = await route.fetch({ maxRedirects: 0 });
        if (closing) return;
        if (response.status() >= 300 && response.status() < 400) return await route.abort();
        if (Object.hasOwn(BUILD.modules, target.pathname)) {
          if (response.status() !== 200 || sha(await response.body()) !== BUILD.modules[target.pathname]) {
            failed = true;
            return await route.abort();
          }
          checked.add(target.pathname);
        }
        await route.fulfill({ response });
      } catch (error) { onError(error); if (!closing) await route.abort().catch(onError); }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close().catch(onError));
    const page = await context.newPage();
    page.on('pageerror', onError);
    await page.clock.setFixedTime(new Date(PANEL.calendarUtc));
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const entry = await page.locator('script[type=module][src]').getAttribute('src', { timeout: 5000 });
    if (entry !== BUILD.entry || !checked.has(entry) || failed) throw new Error('Use the pinned compiled game preview');
    await page.waitForFunction(({ keys: k, id }) => window.__bbGame?.scene.isActive(k.title) &&
      window.__bbGame.registry.get(k.rule)?.rulesetId === id, { keys, id: BUILD.rulesetId }, { timeout: 15000 });
    if (failed || Object.keys(BUILD.modules).some((path) => !checked.has(path))) throw new Error('Pinned ruleset modules were not loaded');
    const result = await pilotWithinDeadline(page.evaluate(drivePanelTrial, { p: PANEL, k: keys, seed, tape }), 45000);
    if (failed) throw new Error('Browser or route error');
    return result;
  } finally {
    closing = true;
    await context.close();
  }
}

async function main() {
  const { help, url } = parsePanelOptions(process.argv.slice(2));
  if (help) {
    console.log('Usage: node tools/sim/scan-hands-off.mjs [--url http://127.0.0.1:PORT/]');
    return;
  }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const rows = [];
  try {
    await Promise.all([0, 1, 2].map(async (worker) => {
      for (let i = worker; i < PANEL.seeds.length; i += 3) {
        const seed = PANEL.seeds[i], capture = await trial(browser, url, seed);
        const replay = inspectCapture(seed, capture) === 'needs-replay' ? await trial(browser, url, seed, capture.tape) : null;
        rows[i] = reportTrial(seed, capture, replay);
      }
    }));
  } finally { await browser.close(); }
  const { biomeMask, targetM, calendarUtc, dailyRuleId, tickHz, limitTicks } = PANEL;
  console.log(JSON.stringify({
    kind: 'local-stock-hands-off-panel', version: 1,
    scope: 'fixed developer QA; no ranking, Daily selection or historical compatibility claim',
    build: { assertedSourceCommit: BUILD.assertedSourceCommit, rulesetId: BUILD.rulesetId,
      checkedModuleSha256: BUILD.modules, wholeBuildAuthenticated: false },
    browser: browser.version(),
    stock: { biomeMask, targetM, calendarUtc, dailyRuleId, tickHz, limitTicks, renderedEveryTick: false },
    rows,
  }, null, 2));
}

main().catch((error) => {
  // Refrain from printing Playwright's page data, tape data, or filesystem paths.
  const message = String(error?.message ?? '').split('\n', 1)[0];
  const expected = /^(The fixed panel |Use an HTTP |Use the pinned |Pinned ruleset |Could not initialize |Unexpected fixed-step |Nonfinite distance |Ambiguous terminal |Pilot browser trial timed out|Browser or route |Unexpected panel seed|Invalid captured |Capture did not |Native fingerprint |Invalid native |Incomplete native |Capped trial |Invalid natural |Native tape |Playback |Unqualified trial)/;
  process.stderr.write(`Hands-off panel: ${expected.test(message) ? message : 'Local proof did not complete'}\n`);
  process.exitCode = 1;
});
