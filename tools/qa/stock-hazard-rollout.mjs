/** #127: one pinned stock hazard comparison in the compiled game; developer QA only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { SCENES } from '../../src/constants.js';
import { EVT } from '../../src/events.js';

const sourceCommit = '0c8c6c1d9b272fb19d8dba36322e0e26448d219d';
const entry = '/assets/index-CCcOfMwf.js';
const bundleSha256 = '39ab0e5c7022a59e6114af3b7d60bffbbd2c0206722401fd5b2f1dd9f895d36e';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:8293/' } } });
assert.match(values.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'Use an HTTP loopback preview root with explicit port');
const url = new URL(values.url);
const preset = Object.freeze({ seed: 'sim-11', biomeMask: 0, fixedUtc: '2026-01-05T12:00:00.000Z', rule: 'featherweight',
  tickHz: 120, hopTick: 2537, lateTick: 2568, holdTicks: 54, maxTick: 3000, clearancePx: 20,
  target: { id: 'packetSpike', chunk: 5, spawnX: 10363, spawnY: 3921.5571441816296 } });

async function trial(browser, pressTick) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  let closing = false, pinned = false, timer;
  const errors = [];
  try {
    await context.route('**/*', async (route) => {
      try {
        const request = route.request(), target = new URL(request.url());
        if (target.origin !== url.origin || !['GET', 'HEAD'].includes(request.method())) return await route.abort();
        const response = await route.fetch({ maxRedirects: 0 });
        if (closing) return;
        if (response.status() >= 300 && response.status() < 400) return await route.abort();
        if (target.href === new URL(entry, url).href && request.resourceType() === 'script') {
          assert.equal(response.status(), 200, 'Compiled game module was not served');
          assert.equal(sha(await response.body()), bundleSha256, 'Wrong compiled game module SHA-256');
          pinned = true;
        }
        await route.fulfill({ response });
      } catch (error) {
        if (closing && /disposed|has been closed|cancelled|canceled/i.test(String(error))) return;
        errors.push(String(error));
        if (!closing) await route.abort().catch(() => {});
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(new Date(preset.fixedUtc));
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const boot = await page.locator('script[type=module][src]').getAttribute('src', { timeout: 5000 });
    assert.deepEqual(errors, [], 'Game preview errors');
    assert.ok(pinned && boot === entry, 'Use the pinned compiled game preview');
    await page.waitForFunction((key) => window.__bbGame?.scene?.isActive(key), SCENES.TITLE, { timeout: 20000 });
    return await Promise.race([
      page.evaluate(({ p, pressTick, scenes, evt }) => {
        const require = (condition, message) => { if (!condition) throw new Error(message); };
        const game = window.__bbGame;
        game.loop.sleep();
        game.scene.getScene(scenes.TITLE).startRun(p.seed);
        // Bypass only the timed title transition; the normal RunScene builds the stock course.
        game.scene.stop(scenes.TITLE);
        game.scene.start(scenes.RUN);
        game.step(0, 0);
        const run = game.scene.getScene(scenes.RUN), sled = run.sled;
        require(Boolean(game.renderer.gl) && run.sys.isActive() && run.simClock.tick === 0 && run.seed === p.seed &&
          run.biomeMask === p.biomeMask && run.dailyRuleId === p.rule && run.startedAt === Date.parse(p.fixedUtc) &&
          run.settings.controlLayout === 'tricksRight' && !run.dailyOfficial && !run.bsodGym && !run.tapePlayer &&
          Boolean(run.ghostRecorder) && !run.appliedBoosts.length && !run.upgradeRun.enabled &&
          Object.keys(run.upgradeRun.ranks).length === 0 && !run.magnetsDrop && !run.kodiaksOn,
        'Trial did not start in the pinned normal stock game');
        const inspect = () => ({ tick: run.simClock.tick, x: sled.x, y: sled.y, vx: sled.vx, vy: sled.vy,
          angle: sled.body.angle, grounded: sled.grounded, shield: run.shieldCharges, invulnerableMs: sled.invulnerableMs, speedBoostMs: run.boostMs });
        const initial = inspect(), hops = [], targetHits = [], landings = [], fatal = [], pickups = [], expirations = [];
        let target, targetInfo, clearance = null, earlyState, lateState, protectedTicks = 0, interference = 0, down = false;
        const targetIsLive = () => target && !target.destroyed && run.hazards.get(p.target.chunk)?.includes(target);
        const key = (on) => {
          window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code: 'Space', bubbles: true, cancelable: true }));
          down = on;
        };
        const onHit = (e) => {
          if (target && e.hazardId === target.def.id && e.x === target.cx && e.y === target.cy) targetHits.push(run.simClock.tick);
        };
        const onCrash = ({ fatal: isFatal, cause, hazardId }) => {
          if (isFatal === true) fatal.push({ tick: run.simClock.tick, cause, hazardId, exactTarget: run._crashHazard === target });
          else interference++;
        };
        const onLanding = ({ quality }) => {
          if (clearance && quality !== 'crash') landings.push({ tick: run.simClock.tick, quality });
        };
        const interrupt = () => { interference++; };
        const pickup = ({ id, durationMs, charges }) => pickups.push({ tick: run.simClock.tick, id, durationMs, charges });
        const expire = ({ id, reason }) => expirations.push({ tick: run.simClock.tick, id, reason });
        const listeners = [[evt.HAZARD_HIT, onHit], [evt.CRASH, onCrash], [evt.LANDING, onLanding],
          [evt.RESPAWN, interrupt], [evt.POWERUP_COLLECTED, pickup], [evt.POWERUP_EXPIRED, expire]];
        for (const [name, receive] of listeners) game.events.on(name, receive);
        try {
          const dt = 1000 / p.tickHz;
          for (let tick = 1; tick <= p.maxTick && !run.crashed; tick++) {
            if (!target) {
              target = run.hazards.get(p.target.chunk)?.find((h) => h.def.id === p.target.id &&
                h.spawn.x === p.target.spawnX && h.spawn.y === p.target.spawnY);
              if (target) targetInfo = { center: [target.cx, target.cy], right: target.body.bounds.max.x };
            }
            if (tick === p.hopTick || tick === p.lateTick && pressTick !== p.hopTick) {
              require(targetIsLive() && target.hit === false && !run.shieldCharges && sled.invulnerableMs === 0 && run.boostMs === 0,
                'Exact unhit target or unprotected approach missing');
              if (tick === p.hopTick) earlyState = inspect(); else lateState = inspect();
            }
            if (tick === pressTick) { require(sled.grounded, 'Scheduled hop did not start grounded'); key(true); }
            if (down && tick === pressTick + p.holdTicks) key(false);
            // Use Phaser’s normal scene/simulation update without drawing each frame.
            game.headlessStep(tick * dt, dt);
            require(run.simClock.tick === tick, 'Fixed-tick schedule stalled or diverged');
            if (run.shieldCharges > 0 || sled.invulnerableMs > 0) protectedTicks++;
            if (run._hopped) hops.push({ tick, atMs: run._lastHopMs, airborne: !sled.grounded, vy: sled.vy });
            if (!clearance && !run.crashed && targetIsLive() && !target.hit &&
                sled.body.bounds.min.x > target.body.bounds.max.x + p.clearancePx) {
              clearance = { tick, trailingBound: sled.body.bounds.min.x, sensorRight: target.body.bounds.max.x };
            }
          }
          require(target && earlyState && run.simClock.droppedMs === 0 && protectedTicks === 0 && interference === 0,
            'Run had protection, respawn, negated crash or missing fixed-tick evidence');
          return { initial, earlyState, lateState: lateState ?? null, target: targetInfo, targetHit: target.hit,
            targetHits, hops, clearance, landings, fatal, pickups, expirations, end: { tick: run.simClock.tick, crashed: run.crashed, x: sled.x, y: sled.y } };
        } finally {
          if (down) key(false);
          for (const [name, receive] of listeners) game.events.off(name, receive);
        }
      }, { p: preset, pressTick, scenes: SCENES, evt: EVT }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Stock rollout trial exceeded 60 seconds')), 60000); }),
    ]);
  } finally {
    clearTimeout(timer);
    closing = true;
    await context.close();
    assert.deepEqual(errors, [], 'Browser or preview errors');
  }
}

function validate(cases) {
  const [neutral, timed, late] = cases.map(({ result }) => result);
  // Same naturally collected early speed burst in all arms. No changed pickup
  // or active boost can explain the comparison at the target.
  for (const result of [neutral, timed, late]) {
    assert.deepEqual(result.pickups, [{ tick: 1425, id: 'packetBurst', durationMs: 3000, charges: 0 }]);
    assert.deepEqual(result.expirations, neutral.expirations, 'Pickup expiration differed between arms');
    assert.ok(result.expirations.length === 1 && result.expirations[0].id === 'packetBurst' &&
      result.expirations[0].reason === 'timeout' && result.expirations[0].tick > 1425 && result.expirations[0].tick < preset.hopTick,
    'Shared Packet Burst did not expire before either input');
  }
  for (const result of [timed, late]) {
    assert.deepEqual(result.initial, neutral.initial, 'Trials did not have the same stock start');
    assert.deepEqual(result.earlyState, neutral.earlyState, 'Trials diverged before the first input');
    assert.deepEqual(result.target, neutral.target, 'Trials did not observe the identical generated sensor');
  }
  assert.deepEqual(late.lateState, neutral.lateState, 'Late control did not share neutral pre-input state');
  for (const [result, fatalTick] of [[neutral, 2570], [late, 2571]]) {
    assert.deepEqual(result.fatal, [{ tick: fatalTick, cause: 'hazard', hazardId: preset.target.id, exactTarget: true }]);
    assert.deepEqual(result.targetHits, [fatalTick]);
    assert.ok(result.targetHit && result.end.crashed && result.end.tick === fatalTick && !result.clearance);
  }
  assert.deepEqual(neutral.hops, []);
  for (const [result, tick] of [[timed, preset.hopTick], [late, preset.lateTick]]) {
    assert.deepEqual(result.hops.map((h) => h.tick), [tick], 'Expected exactly one actual hop pulse');
    assert.ok(Number.isFinite(result.hops[0].atMs) && result.hops[0].airborne && result.hops[0].vy < 0,
      'Expected actual airborne takeoff on recorded hop tick');
  }
  assert.deepEqual(timed.targetHits, []);
  assert.deepEqual(timed.fatal, []);
  assert.ok(!timed.targetHit && !timed.end.crashed && timed.end.tick === preset.maxTick);
  assert.ok(timed.clearance?.tick === 2590 && timed.clearance.trailingBound > timed.clearance.sensorRight + preset.clearancePx);
  assert.deepEqual(timed.landings[0], { tick: 2645, quality: 'good' });
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const cases = [];
const browserVersion = browser.version();
try {
  for (const [name, input] of [['neutral', null], ['timed-hop', preset.hopTick], ['late-hop', preset.lateTick]]) {
    const result = await trial(browser, input);
    assert.deepEqual(await trial(browser, input), result, `Fresh ${name} repeats diverged`);
    cases.push({ name, spacePressedAt: input, result });
  }
  validate(cases);
} finally { await browser.close(); }
console.log(JSON.stringify({ kind: 'local-stock-hazard-rollout', sourceCommit, bundleSha256, browserVersion,
  stepping: 'Phaser headlessStep at 120 Hz; no per-tick rendering', freshTrialsPerArm: 2, preset, evidenceSha256: sha(JSON.stringify(cases)), cases }, null, 2));
