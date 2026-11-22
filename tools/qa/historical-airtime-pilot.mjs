/** #131: explicitly rerun one committed synthetic historical tape on its pinned historical source build. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { REG } from '../../src/constants.js';
import { EVIDENCE_STATUS_KEY, RULESET_KEY } from '../../src/systems/replay/evidenceCapture.js';
import { EVIDENCE_DB } from '../../src/systems/replay/evidenceStore.js';
import { assertPrivateAirtimeChecks, replayFrames, replayKeys } from '../sim/benchmark-replay.mjs';
import { pilotWithinDeadline } from '../sim/hands-off-pilot.js';
import { summarizeAirtime } from '../sim/replay-airtime.js';
import { HISTORICAL_TAPE_BYTES, HISTORICAL_TAPE_SHA256, validatePinnedHistoricalAirtimeTape } from './historical-airtime-guards.js';

const entry = '/assets/index-C4kk2_Bs.js';
const COMMIT = '1e0e52469a7574893349b3f9afa8f0c90ccebe31';
const RULESET = 'sha256:ecb2017a49d367024bfb9f1e008fa35eb9c1c980fb7101cfb846615db7c78c27';
const pins = {
  [entry]:'0137e86b9d5e11b92acd98acd352ce83ce2200fef3864a87a9ead3fe8910e263',
  '/assets/runtimeRuleset-BFBG_iSe.js':'fd13d363e7a94fbdbb34e62571f8ed3330256518433581066ddf0114042572a3',
  '/assets/ecb2017a49d367024bfb9f1e008fa35eb9c1c980fb7101cfb846615db7c78c27-Qs3sMEdr.js':'1a8be5e9d1a57fa86434c3a3227928cc12afd0b554fafe779117ae4bf05b4f9c',
};
const FIXTURE = new URL('../conformance/fixtures/cross-engine/collision-heavy.tape.json', import.meta.url);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const k = { ...replayKeys, rule:RULESET_KEY, awards:REG.LAST_AWARDS, saves:REG.SAVE_STORE,
  ghosts:REG.GHOSTS, evidence:EVIDENCE_STATUS_KEY, evidenceDb:EVIDENCE_DB };
class PilotError extends Error {}
const requirePilot = (ok, message) => { if (!ok) throw new PilotError(message); };

async function readFixture() {
  const file = await open(FIXTURE, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat(), cap = HISTORICAL_TAPE_BYTES;
    requirePilot(stat.isFile() && stat.size === cap, 'The committed synthetic fixture has the wrong size.');
    const buf = Buffer.alloc(cap + 1);
    let i = 0;
    while (i < buf.length) {
      const { bytesRead } = await file.read(buf, i, buf.length - i, i);
      if (!bytesRead) break;
      i += bytesRead;
    }
    requirePilot(i === cap, 'The committed synthetic fixture has the wrong size.');
    try { return validatePinnedHistoricalAirtimeTape(buf.subarray(0, i)); }
    catch { throw new PilotError('The committed synthetic fixture failed its byte pin or historical shape check.'); }
  } finally { await file.close(); }
}

function initializeReplay({ k, tape }) {
  const game = window.__bbGame, reg = game.registry, run = game.scene.getScene(k.run);
  game.loop.sleep();
  reg.set(k.tape, tape);
  game.scene.stop(k.title);
  game.scene.start(k.run);
  game.step(0, 0);
  if (!run.sys.isActive() || run.simClock.tick !== 0 || !run.tapePlayer || run.tapePlayer.tape !== tape || run.ghostRecorder) {
    throw new Error('Native historical replay did not initialize at tick zero.');
  }
  const body = run.sled.body;
  const pose = [body.position.x, body.position.y, body.angle, body.velocity.x, body.velocity.y, body.angularVelocity];
  if (run.seed !== tape.seed || run.biomeMask !== tape.biomeMask || run.startedAt !== tape.startedAt ||
    run.dailyRuleId !== tape.dailyRuleId || run.dailyOfficial || run.bsodGym || run.dailyMode === 'draft' ||
    run.settings.controlLayout !== tape.controlLayout || run.magnetsDrop !== tape.magnetsDrop ||
    run.kodiaksOn !== tape.kodiaksOn || run.kodiakPackMode !== tape.kodiakPackMode ||
    run.appliedBoosts.length !== 0 || run.upgradeRun.enabled || Object.keys(run.upgradeRun.ranks).length !== 0 ||
    !pose.every((v,i) => Object.is(v,tape.startPose[i])) || !Object.entries(tape.random).every(([name,value]) =>
      name === 'version' ? run.runRandom.version === value : run.runRandom[name]?.state === value) ||
    !Object.entries(tape.bsod.initial).every(([name,value]) => Object.is(run.bsod[name],value))) {
    throw new Error('Historical replay did not reconstruct the pinned starting configuration.');
  }
}

async function trial(browser, url, tape) {
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
        if (dest.origin !== url.origin || !['GET','HEAD'].includes(request.method())) return await route.abort();
        const response = await route.fetch({ maxRedirects:0 });
        if (closing) return;
        if (response.status() >= 300 && response.status() < 400) return await route.abort();
        if (Object.hasOwn(pins, dest.pathname)) {
          if (response.status() !== 200 || sha(await response.body()) !== pins[dest.pathname]) {
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
    await page.clock.setFixedTime(new Date(tape.startedAt));
    await page.goto(url.href, { waitUntil:'domcontentloaded', timeout:20_000 });
    const boot = await page.locator('script[type=module][src]').getAttribute('src', { timeout:5_000 });
    requirePilot(!failed && boot === entry && checked.has(entry), 'Use the pinned compiled historical preview.');
    await page.waitForFunction(({ k, id }) => window.__bbGame?.scene?.isActive(k.title) &&
      window.__bbGame.registry.get(k.rule)?.rulesetId === id, { k, id:RULESET }, { timeout:15_000 });
    requirePilot(!failed && Object.keys(pins).every((p) => checked.has(p)), 'Pinned historical ruleset modules were not loaded.');
    await page.evaluate(initializeReplay, { k, tape });
    const result = await pilotWithinDeadline(page.evaluate(replayFrames, {
      tickLimit:tape.endTick, measure:false, keys:k, observeGrounded:true,
    }), 45_000);
    const saved = await page.evaluate(async (k) => {
      const reg = window.__bbGame.registry;
      return Boolean(reg.get(k.record) || reg.get(k.latestTape) || reg.get(k.awards) || reg.get(k.evidence) ||
        (await reg.get(k.saves).getRecentRuns(1)).length || reg.get(k.ghosts).courses.size || reg.get(k.ghosts).tapes.size ||
        (await indexedDB.databases()).some(({ name }) => name === k.evidenceDb));
    }, k);
    requirePilot(!failed && !saved, 'Historical replay had browser errors or produced a save.');
    return { ...result, pageInfo:{ entry:boot } };
  } catch (error) {
    const fixed = /Native historical replay did not initialize at tick zero\.|Historical replay did not reconstruct the pinned starting configuration\./
      .exec(String(error?.message));
    throw (error instanceof PilotError ? error : new PilotError(fixed?.[0] ?? 'Historical browser replay failed or timed out.'));
  } finally { closing = true; await context.close(); }
}

async function main() {
  let args;
  try { args = parseArgs({ options:{ 'use-synthetic-fixture':{ type:'boolean' }, url:{ type:'string' } } }).values; }
  catch { throw new PilotError('Use only --use-synthetic-fixture and --url. Player tapes are not accepted.'); }
  requirePilot(args['use-synthetic-fixture'] === true, 'Pass --use-synthetic-fixture to opt in to the one committed fixture.');
  const port = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/$/.exec(args.url)?.[1];
  requirePilot(port && Number(port) <= 65535, 'Use an HTTP 127.0.0.1 historical preview root with an explicit port.');
  const url = new URL(args.url), tape = await readFixture();
  const browser = await chromium.launch({ headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE,
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist','--mute-audio'] });
  let report;
  try {
    const a = await trial(browser, url, tape), b = await trial(browser, url, tape);
    try {
      assertPrivateAirtimeChecks(a, tape);
      assertPrivateAirtimeChecks(b, tape, a, 2);
    } catch { throw new PilotError('Historical replay did not match all exact checkpoints and repeated completed-tick observations.'); }
    report = {
      kind:'local-historical-synthetic-airtime', reportVersion:1, chromium:browser.version(),
      scope:'Opt-in synthetic QA only, re-simulated on the historical source build. No current-build compatibility or player claim.',
      source:{ commit:COMMIT, packageVersion:'2.16.0', rulesetId:RULESET, simRevision:1, checkedModulesSha256:pins },
      fixture:{ id:'collision-heavy', sha256:HISTORICAL_TAPE_SHA256,
        versions:{ tape:tape.version, physics:tape.physicsVersion, tickHz:tape.simTickHz, kodiak:tape.kodiakVersion, rng:tape.runRandomVersion } },
      replay:{ freshRuns:2, nativeCheckpointsPerRun:a.checked, matchedGroundedAndStateEveryCompletedTick:true,
        savedRunsGhostsAwardsOrEvidence:false },
      airtime:summarizeAirtime(a.grounded, tape.simTickHz),
    };
  } finally { await browser.close(); }
  console.log(JSON.stringify(report,null,2));
}

main().catch((error) => {
  console.error(`Historical airtime: ${error instanceof PilotError ? error.message : 'Local proof did not complete.'}`);
  process.exitCode = 1;
});
