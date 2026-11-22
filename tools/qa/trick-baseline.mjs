/** #157: fixed stock keyboard baseline in the real built game. No runtime imports this tool. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { REG, SCENES } from '../../src/constants.js';
import { EVT } from '../../src/events.js';

const fixturePath = new URL('./fixtures/trick-baseline-sim11.json', import.meta.url);
const keys = new Set(['Space', 'ArrowLeft', 'KeyW', 'KeyA', 'ArrowDown']);
const hex = (text, length) => typeof text === 'string' && text.length === length && /^[a-f0-9]+$/.test(text);
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:8293/' } } });
const url = new URL(values.url);
assert.ok(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) &&
  url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash, 'Use an HTTP loopback preview root URL');

const raw = await readFile(fixturePath);
assert.ok(raw.length <= 16384, 'Fixed input fixture exceeds 16 KiB');
const fixture = JSON.parse(raw);
assert.ok(fixture.version === 1 && fixture.seed === 'sim-11' && fixture.biomeMask === 0 &&
  fixture.fixedUtc === '2026-01-05T12:00:00.000Z' && fixture.rule === 'featherweight' && fixture.tickHz === 120 &&
  hex(fixture.sourceCommit, 40) && hex(fixture.entrySha256, 64) && /^\/assets\/index-[\w-]+\.js$/.test(fixture.entry),
'Unexpected stock baseline fixture header');
assert.ok(Number.isInteger(fixture.endTick) && fixture.endTick > 0 && fixture.endTick <= 2000 &&
  Array.isArray(fixture.edges) && fixture.edges.length > 0 && fixture.edges.length <= 512, 'Invalid fixed input bounds');
const held = new Set();
let previous = 0, frameKeys = new Set();
for (const edge of fixture.edges) {
  assert.ok(Array.isArray(edge) && edge.length === 3, 'Invalid key transition');
  const [tick, code, down] = edge;
  assert.ok(Number.isInteger(tick) && tick > 0 && tick >= previous && tick <= fixture.endTick &&
    keys.has(code) && typeof down === 'boolean' && held.has(code) !== down, 'Invalid key transition');
  if (tick !== previous) frameKeys = new Set();
  assert.ok(!frameKeys.has(code), 'Multiple transitions for the same key on one tick');
  frameKeys.add(code);
  if (down) held.add(code); else held.delete(code);
  previous = tick;
}

async function drive(browser) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  const errors = [];
  let closing = false, verifiedEntry = false;
  try {
    await context.route('**/*', async (route) => {
      try {
        const req = route.request(), target = new URL(req.url());
        if (target.origin !== url.origin || !['GET', 'HEAD'].includes(req.method())) return await route.abort();
        const res = await route.fetch({ maxRedirects: 0 });
        if (closing) return;
        if (res.status() >= 300 && res.status() < 400) return await route.abort();
        if (target.href === new URL(fixture.entry, url).href && req.resourceType() === 'script') {
          assert.equal(res.status(), 200, 'Pinned game entry was not served');
          assert.equal(sha256(await res.body()), fixture.entrySha256, 'Preview game bundle differs from the stock baseline pin');
          verifiedEntry = true;
        }
        await route.fulfill({ response: res });
      } catch (error) {
        if (closing && /disposed|has been closed|cancelled|canceled/i.test(String(error))) return;
        errors.push(String(error));
        if (!closing) await route.abort().catch(() => {});
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.clock.setFixedTime(new Date(fixture.fixedUtc));
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const entry = await page.locator('script[type=module][src]').getAttribute('src', { timeout: 5000 });
    assert.deepEqual(errors, [], 'Browser or preview errors');
    assert.ok(verifiedEntry && entry === fixture.entry, 'Use the pinned compiled preview, not Vite dev or a different build');
    await page.waitForFunction((title) => window.__bbGame?.scene?.isActive(title), SCENES.TITLE, { timeout: 15000 });
    let timer;
    try {
      return await Promise.race([
        page.evaluate(async ({ f, scenes, reg, evt }) => {
          const game = window.__bbGame;
          const title = game.scene.getScene(scenes.TITLE);
          game.loop.sleep();
          title.startRun(f.seed);
          // Skip only the menu's animation so the actual RunScene starts at tick zero.
          game.scene.stop(scenes.TITLE);
          game.scene.start(scenes.RUN);
          game.step(0, 0);
          const run = game.scene.getScene(scenes.RUN), sled = run.sled;
          if (!run.sys.isActive() || run.seed !== f.seed || run.biomeMask !== f.biomeMask ||
              run.settings.controlLayout !== 'tricksRight' || run.dailyOfficial || run.bsodGym || run.tapePlayer ||
              run.appliedBoosts.length || Object.keys(run.upgradeRun?.ranks ?? {}).length || run.magnetsDrop || run.kodiaksOn ||
              run.simClock.tick !== 0 || run.dailyRuleId !== f.rule || run.startedAt !== Date.parse(f.fixedUtc)) {
            throw new Error('Run did not start in the pinned stock, non-Official normal configuration');
          }
          const input = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup',
            { code, bubbles: true, cancelable: true }));
          const landings = []; let pending = [], hot = [0, 0, 0], lastHot = hot, inAir = false, interruptions = 0, bankTotal = 0;
          const captureTrick = ({ type, count, value }) => pending.push([run.simClock.tick, type, count, value]);
          const captureLand = ({ quality, bankedPoints, bonusPoints, airtimeMs }) => {
            bankTotal += bankedPoints + bonusPoints;
            if (run.score.getSnapshot().trickPoints !== bankTotal) throw new Error('Landing did not bank the reported points');
            landings.push({ tick: run.simClock.tick, quality, banked: bankedPoints, bonus: bonusPoints, airtimeMs: Math.round(airtimeMs),
              deployed: [...(inAir ? hot : lastHot)], tricks: pending });
            pending = [];
          };
          const interrupt = () => { interruptions++; };
          const watchers = [[evt.TRICK, captureTrick], [evt.LANDING, captureLand], [evt.CRASH, interrupt],
            [evt.RESPAWN, interrupt], [evt.POWERUP_COLLECTED, interrupt]];
          for (const [event, fn] of watchers) game.events.on(event, fn);
          const held = new Set();
          try {
            let index = 0;
            const dt = 1000 / f.tickHz;
            for (let tick = 1; tick <= f.endTick; tick++) {
              while (f.edges[index]?.[0] === tick) {
                const [, code, down] = f.edges[index++];
                input(code, down);
                if (down) held.add(code); else held.delete(code);
              }
              game.step(tick * dt, dt);
              if (run.simClock.tick !== tick || run.crashed || interruptions) throw new Error('Baseline run was interrupted');
              if (!sled.grounded && !inAir) { inAir = true; hot = [0, 0, 0]; }
              if (sled.grounded && inAir) { inAir = false; lastHot = hot; }
              if (inAir) {
                hot[0] += Number(sled.corkscrewActive);
                hot[1] += Number(sled.parachuteMs > 0);
                hot[2] += Number(sled.airBrakeActive);
              }
            }
            if (index !== f.edges.length || pending.length || run.simClock.droppedMs !== 0) {
              throw new Error('Baseline did not end with all inputs and landings accounted for');
            }
            const store = game.registry.get(reg.SAVE_STORE), ghosts = game.registry.get(reg.GHOSTS);
            if (game.registry.get(reg.LAST_RECORD) || game.registry.get(reg.LAST_GHOST_TAPE) ||
                (await store?.getRecentRuns(1))?.length !== 0 || ghosts?.courses?.size !== 0 || ghosts?.tapes?.size !== 0) {
              throw new Error('Baseline must not save a run or ghost tape');
            }
            const score = run.score.getSnapshot();
            const b = sled.body;
            return { landings, trickPoints: score.trickPoints, terminal: [run.simClock.tick, b.position.x, b.position.y,
              b.angle, b.velocity.x, b.velocity.y, score.distanceM, score.total] };
          } finally {
            for (const code of held) input(code, false);
            for (const [event, fn] of watchers) game.events.off(event, fn);
          }
        }, { f: fixture, scenes: SCENES, reg: REG, evt: EVT }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Stock baseline exceeded a 45-second trial limit')), 45000); }),
      ]);
    } finally { clearTimeout(timer); }
  } finally {
    closing = true;
    await context.close();
    assert.deepEqual(errors, [], 'Browser or preview errors');
  }
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let observed, browserVersion;
try {
  browserVersion = browser.version();
  observed = await drive(browser);
  let lastLanding = 0, bankedTotal = 0;
  assert.equal(observed.landings.length, 3, 'The baseline must bank three separate landings');
  for (const { tick, quality, banked, bonus, deployed, tricks } of observed.landings) {
    assert.ok(['good', 'perfect'].includes(quality) && banked > 0 && deployed.every((ticks) => ticks > 0) &&
      tricks.every(([at, , , value]) => at > lastLanding && at <= tick && value > 0),
    'A clean, positive bank and all three active controls are required on each flight');
    assert.deepEqual(tricks.filter(([, type]) => type === 'corkscrew').map(([, , count]) => count), [1, 2, 3, 4],
      'Require four accumulated corkscrews on each flight');
    for (const type of ['airBrake', 'parachute']) {
      assert.ok(tricks.some(([, actual]) => actual === type), 'The flight must score both air brake and parachute');
    }
    lastLanding = tick;
    bankedTotal += banked + bonus;
  }
  assert.equal(observed.trickPoints, bankedTotal, 'Landing banks and bonuses must reconcile to the final trick score');
  assert.deepEqual(observed.landings, fixture.expected.landings, 'Stock landing or trick events changed');
  assert.equal(observed.trickPoints, fixture.expected.trickPoints, 'Stock banked trick points changed');
  assert.ok(observed.terminal.every(Number.isFinite), 'Nonfinite final run state');
  assert.deepEqual(await drive(browser), observed, 'Two fresh Chromium runs diverged');
} finally { await browser.close(); }
console.log(JSON.stringify({ kind: 'local-stock-trick-baseline', sourceCommit: fixture.sourceCommit,
  bundleSha256: fixture.entrySha256, fixtureSha256: sha256(raw), browserVersion, seed: fixture.seed, biomeMask: fixture.biomeMask,
  fixedUtc: fixture.fixedUtc, rule: fixture.rule, freshIdenticalRuns: 2, landings: observed.landings,
  trickPoints: observed.trickPoints, observedStateSha256: sha256(JSON.stringify(observed)) }, null, 2));
