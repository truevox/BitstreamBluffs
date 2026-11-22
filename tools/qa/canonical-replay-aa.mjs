/** #129: one newly captured v1.1 A/A control, verified in the pinned compiled game. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { REG, SCENES } from '../../src/constants.js';
import { EVT } from '../../src/events.js';
import { CHECKPOINT_EVERY } from '../../src/systems/ghost/GhostTape.js';
import { digestOf } from '../../src/systems/replay/canonicalSha256.js';
import { EVIDENCE_STATUS_KEY, RULESET_KEY } from '../../src/systems/replay/evidenceCapture.js';
import { EVIDENCE_DB, EVIDENCE_STORE } from '../../src/systems/replay/evidenceStore.js';
import { FP_SUBSYSTEMS } from '../../src/systems/replay/fingerprintSchemas.js';
import { assertCanonicalFrameMatch, bindCanonicalCapture } from './canonical-aa-guards.js';

const sourceCommit = 'ca5850cabf2f03bbb6832393ef22c4a49f1006e7';
const entry = '/assets/index-C4kk2_Bs.js';
const scriptPins = {
  [entry]: '0137e86b9d5e11b92acd98acd352ce83ce2200fef3864a87a9ead3fe8910e263',
  '/assets/runtimeRuleset-BFBG_iSe.js': 'fd13d363e7a94fbdbb34e62571f8ed3330256518433581066ddf0114042572a3',
  '/assets/ecb2017a49d367024bfb9f1e008fa35eb9c1c980fb7101cfb846615db7c78c27-Qs3sMEdr.js': '1a8be5e9d1a57fa86434c3a3227928cc12afd0b554fafe779117ae4bf05b4f9c',
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const preset = { seed: 'sim-05', biomeMask: 0, rule: 'featherweight', fixedUtc: '2026-01-05T12:00:00.000Z',
  tickHz: 120, fatalTick: 984, fatalCause: 'hazard', fatalHazard: 'packetSpike' };
const keys = { reg: REG, scenes: SCENES, crash: EVT.CRASH, status: EVIDENCE_STATUS_KEY,
  ruleset: RULESET_KEY, db: EVIDENCE_DB, dbStore: EVIDENCE_STORE };

async function trial(browser, url, rulesetId, tape) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  const errors = [], checked = new Set();
  let closing = false, timer;
  const routeError = (error) => {
    if (!closing || !/disposed|closed|cancelled|canceled/i.test(String(error))) errors.push('Browser or route failure');
  };
  try {
    await context.route('**/*', async (route) => {
      try {
        const request = route.request(), target = new URL(request.url());
        if (target.origin !== url.origin || !['GET', 'HEAD'].includes(request.method())) return await route.abort();
        const response = await route.fetch({ maxRedirects: 0 });
        if (closing) return;
        if (response.status() >= 300 && response.status() < 400) return await route.abort();
        if (Object.hasOwn(scriptPins, target.pathname)) {
          if (response.status() !== 200 || sha(await response.body()) !== scriptPins[target.pathname]) {
            errors.push('Pinned compiled module bytes differ');
            return await route.abort();
          }
          checked.add(target.pathname);
        }
        await route.fulfill({ response });
      } catch (error) { routeError(error); if (!closing) await route.abort().catch(routeError); }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close().catch(routeError));
    const page = await context.newPage();
    page.on('pageerror', routeError);
    await page.clock.setFixedTime(new Date(preset.fixedUtc));
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const boot = await page.locator('script[type=module][src]').getAttribute('src', { timeout: 5000 });
    if (errors.length || boot !== entry || !checked.has(entry)) throw new Error('Use the pinned compiled game preview');
    await page.waitForFunction(({ k, id }) => window.__bbGame?.scene?.isActive(k.scenes.TITLE) &&
      window.__bbGame.registry.get(k.ruleset)?.rulesetId === id, { k: keys, id: rulesetId }, { timeout: 15000 });
    if (errors.length || !Object.keys(scriptPins).every((path) => checked.has(path))) throw new Error('Pinned ruleset modules were not loaded');
    const out = await Promise.race([
      page.evaluate(async ({ p, k, tape }) => {
        const require = (condition, message) => { if (!condition) throw new Error(message); };
        const game = window.__bbGame, reg = game.registry, run = game.scene.getScene(k.scenes.RUN);
        game.loop.sleep();
        game.scene.getScene(k.scenes.TITLE).startRun(p.seed);
        game.scene.stop(k.scenes.TITLE);
        game.scene.start(k.scenes.RUN);
        game.headlessStep(0, 0);
        require(run.sys.isActive() && run.simClock.tick === 0 && run.ghostRecorder && !run.tapePlayer &&
          !run.dailyOfficial && !run.bsodGym && run.seed === p.seed && run.settings.controlLayout === 'tricksRight' &&
          !run.appliedBoosts.length && !run.upgradeRun.enabled && !run.magnetsDrop && !run.kodiaksOn,
        'Could not initialize the stock recording scene');
        // Acquire the compiled observer from a zero-tick normal scene. The detached
        // recorder never receives input or a save call. Restart into the real TapePlayer.
        const Recorder = run.ghostRecorder.constructor, observer = new Recorder({});
        if (tape) {
          game.scene.stop(k.scenes.RUN);
          reg.set(k.reg.GHOST_REPLAY, tape);
          game.scene.start(k.scenes.RUN);
          game.headlessStep(0, 0);
        }
        require(run.sys.isActive() && run.simClock.tick === 0 && Boolean(run.tapePlayer) === Boolean(tape) &&
          Boolean(run.ghostRecorder) !== Boolean(tape) && (!tape || run.tapePlayer.tape === tape) && run.seed === p.seed && run.biomeMask === p.biomeMask &&
          run.dailyRuleId === p.rule && !run.dailyOfficial && !run.bsodGym,
        'Could not initialize the matched stock trial');
        const source = run.ghostRecorder, events = [];
        const crash = (e) => {
          if (e.fatal === true && e.negated === false && e.runId === run.runId) events.push([run.simClock.tick, e.cause, e.hazardId ?? null, e.x, e.y, e.speedPxS]);
        };
        game.events.on(k.crash, crash);
        const tickMethod = run.simTick, hadOwn = Object.hasOwn(run, 'simTick');
        run.simTick = function (...args) {
          const result = tickMethod.apply(this, args);
          // Same point as GhostRecorder.afterTick: after a completed sim tick, before render/display updates.
          if (!this.crashed) observer._fingerprint(this.simClock.tick, this);
          return result;
        };
        try {
          const dt = 1000 / p.tickHz;
          for (let tick = 1; tick <= p.fatalTick && !run.crashed; tick++) {
            game.headlessStep(tick * dt, dt);
            require(run.simClock.tick === tick, 'Fixed clock did not step exactly one tick');
          }
        } finally {
          game.events.off(k.crash, crash);
          if (hadOwn) run.simTick = tickMethod; else delete run.simTick;
        }
        const fatal = events[0], completed = p.fatalTick - 1;
        require(run.crashed && events.length === 1 && run.simClock.tick === p.fatalTick && run.simClock.droppedMs === 0 &&
          fatal[0] === p.fatalTick && fatal[1] === p.fatalCause && fatal[2] === p.fatalHazard && fatal.slice(3).every(Number.isFinite),
        'Did not reproduce the exact natural fatal tick and category');
        require(observer.fingerprintErrorCount === 0 && observer.fingerprints.length === completed, 'Incomplete canonical fingerprint capture');
        const result = { frames: observer.fingerprints, fatal, completed };
        if (tape) {
          const store = reg.get(k.reg.SAVE_STORE), ghosts = reg.get(k.reg.GHOSTS);
          require(run.tapePlayer.checked === tape.checkpoints.length && run.tapePlayer.desync === null,
            'TapePlayer did not match every native exact checkpoint');
          require(!reg.get(k.reg.LAST_RECORD) && !reg.get(k.reg.LAST_GHOST_TAPE) && !reg.get(k.reg.LAST_AWARDS) &&
            !reg.get(k.status) && (await store.getRecentRuns(1)).length === 0 && ghosts.courses.size === 0 && ghosts.tapes.size === 0,
          'Playback wrote a run, award, ghost or evidence');
          return result;
        }
        const saved = reg.get(k.reg.LAST_GHOST_TAPE);
        require(source.fingerprintErrorCount === 0 && saved?.endTick === completed && saved.mode === 'normal' &&
          saved.edgeRows === 'every-tick' && saved.inputs.length === 1 && saved.inputs[0].join(',') === '1,6,0',
        'Native recording did not produce the expected stock neutral tape');
        return { ...result, tape: saved, native: source.fingerprints };
      }, { p: preset, k: keys, tape }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Replay trial timed out')), 45000); }),
    ]);
    if (!tape) {
      await page.waitForFunction((status) => Boolean(window.__bbGame.registry.get(status)), keys.status, { timeout: 12000 });
      const evidence = await page.evaluate(async (k) => {
        const status = window.__bbGame.registry.get(k.status);
        if (!status.ok || !status.durable) throw new Error('Native canonical evidence did not reach disposable IndexedDB');
        const request = (req) => new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(new Error('Could not read stored canonical evidence'));
        });
        const open = indexedDB.open(k.db);
        open.onupgradeneeded = () => open.transaction.abort(); // never create a database from the reader
        const db = await request(open);
        try {
          const row = await request(db.transaction(k.dbStore, 'readonly').objectStore(k.dbStore).get(status.digest));
          if (!(row?.bytes instanceof Uint8Array) || row.bytes.length > 262144) throw new Error('Invalid native evidence bytes');
          return { status, bytes: Array.from(row.bytes) };
        } finally { db.close(); }
      }, keys);
      out.status = evidence.status;
      out.bytes = Uint8Array.from(evidence.bytes);
    }
    if (errors.length) throw new Error('Browser or route errors during canonical trial');
    return out;
  } finally {
    clearTimeout(timer);
    closing = true;
    await context.close();
  }
}

async function main() {
  const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:8293/' } } });
  assert.match(values.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'Use an HTTP loopback preview root with explicit port');
  const url = new URL(values.url);
  const pointer = JSON.parse(await readFile(new URL('../ruleset/current.json', import.meta.url), 'utf8'));
  const rules = JSON.parse(await readFile(new URL(`../../${pointer.archivePath}`, import.meta.url), 'utf8'));
  assert.ok(digestOf(rules) === pointer.rulesetId, 'Archived ruleset bytes disagree with the checked-out ruleset id');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let report;
  try {
    const live = await trial(browser, url, pointer.rulesetId, null);
    const v = bindCanonicalCapture(live, pointer.rulesetId, rules, CHECKPOINT_EVERY);
    const a = await trial(browser, url, pointer.rulesetId, live.tape);
    const b = await trial(browser, url, pointer.rulesetId, live.tape);
    for (const next of [a, b]) {
      if (!isDeepStrictEqual(next.fatal, live.fatal) || next.completed !== live.completed) {
        throw new Error('Separate fatal signature or completed interval diverged');
      }
      await assertCanonicalFrameMatch(v.causalDigest, live.completed, live.frames, next.frames);
    }
    await assertCanonicalFrameMatch(v.causalDigest, live.completed, a.frames, b.frames);
    report = { kind: 'local-canonical-same-build-aa', reportVersion: 1, sourceCommit, chromium: browser.version(),
      scope: 'new stock fixture; same build and engine only; no historical A/B or identity claim',
      compiledEntrySha256: scriptPins[entry], rulesetId: pointer.rulesetId, bundleDigest: v.bundleDigest,
      tapeDigest: v.manifest.causal.input.tapeDigest, causalDigest: v.causalDigest, seed: preset.seed, biomeMask: preset.biomeMask,
      replay: { freshRuns: 2, matchedNativeCheckpointsPerRun: live.native.length, completedTicks: live.completed,
        matchedSubsystems: FP_SUBSYSTEMS, frameFingerprintDigest: sha(JSON.stringify(live.frames)),
        matchedSeparateFatalSignature: true, fatalTick: preset.fatalTick, fatalCategory: preset.fatalCause, fatalHazard: preset.fatalHazard },
    };
  } finally { await browser.close(); }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  // Only fixed diagnostics, never Playwright's attached evidence/page data or local path details.
  const message = String(error?.message ?? '').split('\n', 1)[0];
  const known = /^(Incomplete |Missing |Canonical |Native |Wrong canonical |Separate fatal |Use an HTTP |Use the pinned |Pinned ruleset |Archived ruleset )/;
  console.error(`Canonical A/A: ${known.test(message) ? message : 'Local proof did not complete'}`);
  process.exitCode = 1;
});
