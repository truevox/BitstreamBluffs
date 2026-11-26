/** #79: scripted fixture-only bridge between replay events and a stored strip. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { EVT } from '../../src/events.js';
import { REG } from '../../src/constants.js';
import { decodeTrace, TRACE_EVERY } from '../../src/systems/ghost/GhostTape.js';
import { openDownhillRunTrace } from '../../src/systems/downhill-run-strip.js';

const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:8293/');
assert.equal(url.href, url.origin + '/', 'Use the normal entry at the loopback root');
assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1', 'HTTP loopback only');
const entry = '/assets/main-BFWlldkw.js';
const pins = new Map([
  ['/', 'c1ac859e52422d49e3aae2b3f4f988973bf38bafc2fe7381bf5eb72f005c71ac'],
  [entry, '44324233172df184b0104aa3ad304c311f9305a8286a5018386788b7ec2da538'],
]);
const harness = fileURLToPath(new URL('../conformance/cross-engine-page.js', import.meta.url));
const fixture = { seed: 'CE120-BUMP3', hz: 120, style: 'reckless', params: { hopEvery: 400 }, rngSeed: 9 };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function run(browser, { tape, maxTicks }) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  const errors = [], verified = new Set();
  let closing = false;
  try {
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        const target = new URL(request.url());
        if (target.origin !== url.origin || !['GET', 'HEAD'].includes(request.method())) return await route.abort();
        const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
        if (closing) return;
        const pin = pins.get(target.pathname);
        if (pin) {
          assert.equal(target.search, '');
          assert.equal(response.status(), 200);
          // Check the exact bytes delivered to the page, not a separate probe.
          assert.equal(sha(await response.body()), pin, `Wrong compiled bytes at ${target.pathname}`);
          verified.add(target.pathname);
        }
        if (response.status() >= 300 && response.status() < 400) return await route.abort();
        await route.fulfill({ response });
      } catch (error) {
        if (!closing) errors.push(error);
        await route.abort().catch(() => {});
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error));
    // Pin the seeded day, not the fade/elapsed clocks used by Title.
    await page.addInitScript((base) => {
      const RealDate = Date, start = RealDate.now();
      function TestDate(...args) { return new RealDate(...(args.length ? args : [TestDate.now()])); }
      TestDate.prototype = RealDate.prototype;
      TestDate.now = () => base + RealDate.now() - start;
      TestDate.parse = RealDate.parse;
      TestDate.UTC = RealDate.UTC;
      window.Date = TestDate;
    }, tape?.startedAt || Date.parse('2026-11-21T12:00:00Z'));
    await page.addInitScript({ path: harness });
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForFunction(() => window.__bbGame?.scene.isActive('TitleScene') && window.__ce,
        null, { timeout: 20000 });
    } catch (error) { throw errors[0] ?? error; }
    assert.deepEqual(verified, new Set(pins.keys()), 'Both exact assets must have loaded');
    const result = await page.evaluate(async ({ opts, eventName, keys }) => {
      const game = window.__bbGame, run = game.scene.getScene('RunScene');
      const events = [];
      const observe = (event) => {
        if (event.fatal) events.push({ tick: run.simClock.tick, cause: event.cause,
          x: event.x, y: event.y, sameRun: event.runId === run.runId, negated: event.negated });
      };
      game.events.on(eventName, observe);
      let result;
      try {
        result = await Promise.race([
          window.__ce.play(opts),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Fixture did not finish')), 25000)),
        ]);
      } finally { game.events.off(eventName, observe); }
      const store = game.registry.get(keys.SAVE_STORE);
      const ghosts = game.registry.get(keys.GHOSTS);
      if (!store || !ghosts) throw new Error('Local stores were unavailable');
      const writes = !!(game.registry.get(keys.LAST_RECORD) || game.registry.get(keys.LAST_GHOST_TAPE) ||
        (await store.getRecentRuns(1)).length || ghosts.courses.size || ghosts.tapes.size);
      return { ...result, events, writes, droppedMs: run.simClock.droppedMs,
        replayHasRecorder: !!opts.tape && !!run.ghostRecorder };
    }, { opts: { ...fixture, tape, maxTicks }, eventName: EVT.CRASH,
      keys: { SAVE_STORE: REG.SAVE_STORE, GHOSTS: REG.GHOSTS, LAST_RECORD: REG.LAST_RECORD,
        LAST_GHOST_TAPE: REG.LAST_GHOST_TAPE } });
    assert.equal(errors.length, 0, String(errors[0] ?? ''));
    assert.equal(result.droppedMs, 0);
    if (tape) assert.deepEqual([result.writes, result.replayHasRecorder], [false, false]);
    return result;
  } finally {
    closing = true;
    await context.close();
  }
}

function matchesPoses(tape, raw) {
  const stored = decodeTrace(tape);
  const count = Math.floor(tape.endTick / TRACE_EVERY);
  if (stored.length !== 3 * count || raw.length < tape.endTick) return false;
  for (let i = 0; i < count; i++) {
    for (let axis = 0; axis < 3; axis++) {
      if (!Object.is(stored[i * 3 + axis], Math.fround(raw[(i + 1) * TRACE_EVERY - 1][axis]))) return false;
    }
  }
  return true;
}

function markerFor(tape, replay) {
  if (replay.tapeCheck.desync || replay.tapeCheck.checked !== tape.checkpoints.length ||
      replay.outcome.ticks !== tape.endTick + 1 || !replay.outcome.crashed ||
      !matchesPoses(tape, replay.raw) || replay.events.length !== 1) return null;
  const [event] = replay.events;
  if (!event.sameRun || event.negated !== false || event.tick !== tape.endTick + 1 ||
      event.cause !== 'terrain' || ![event.x, event.y].every(Number.isFinite)) return null;
  return { tick: event.tick, category: event.cause, x: event.x, y: event.y };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const live = await run(browser, { maxTicks: 2400 });
  assert.deepEqual([live.outcome.ticks, live.outcome.cause, live.tape.endTick, live.tape.checkpoints.length],
    [937, 'terrain', 936, 7]);
  assert.equal(live.events.length, 1);
  const replay = await run(browser, { tape: live.tape });
  assert.deepEqual(replay.events, live.events, 'Live and replay fatal events differed');
  assert.equal(matchesPoses(live.tape, live.raw), true);
  const marker = markerFor(live.tape, replay);
  assert.ok(marker, 'Expected a matching independent replay witness');
  const strip = openDownhillRunTrace(JSON.stringify(live.tape));
  const final = strip.sample(strip.count - 1);
  assert.deepEqual([strip.count, final.tick], [234, 936]);
  const gap = Math.hypot(marker.x - final.x, marker.y - final.y);
  assert.ok(gap > 0, 'A fatal marker must not silently snap to the final pose');

  // A valid change to only the pose drawing, not the causal input/checkpoints.
  const bytes = Buffer.from(live.tape.trace, 'base64');
  bytes.writeFloatLE(bytes.readFloatLE(0) + 8, 0);
  const altered = { ...live.tape, trace: bytes.toString('base64') };
  const moved = await run(browser, { tape: altered });
  assert.deepEqual(moved.tapeCheck, replay.tapeCheck);
  assert.deepEqual(moved.events, replay.events);
  assert.deepEqual(moved.raw, replay.raw);
  assert.equal(markerFor(altered, moved), null);

  // The recorder fallback labels a bounded nonfatal run as a crash. Prove
  // clean replay across its claimed fatal tick before refusing the marker.
  const cutoff = await run(browser, { maxTicks: 464 });
  assert.deepEqual([cutoff.outcome.crashed, cutoff.tape.endTick, cutoff.tape.cause,
    cutoff.tape.checkpoints.length, cutoff.events.length], [false, 464, 'crash', 3, 0]);
  const short = await run(browser, { tape: cutoff.tape });
  assert.deepEqual([short.outcome.ticks, short.outcome.crashed, short.tapeCheck.checked, short.events.length],
    [465, false, 3, 0]);
  assert.ok(!short.tapeCheck.desync && matchesPoses(cutoff.tape, short.raw));
  assert.equal(markerFor(cutoff.tape, short), null);
  console.log(`RUN_STRIP_FATAL_WITNESS_PASS terrain=${marker.tick} last=${final.tick} poses=${strip.count} gapPx=${gap.toFixed(3)} edited=refused cutoff=refused`);
} finally { await browser.close(); }
