/**
 * #78 synthetic-only check of the shipped crash brief and comparator.
 * Run from the repo root with a local production preview. No supplied tape,
 * player profile, upload, or gameplay/replay implementation change.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { readAirtimeTape } from './benchmark-replay.mjs';

const build = '044ebd4b68b4c80134cde5ec35f661b471a2e0b0';
const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:8293/');
assert.equal(url.href, url.origin + '/', 'Use the normal game entry at the loopback root');
assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1', 'HTTP loopback only');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
async function verifyAsset(path, expected) {
  const response = await fetch(new URL(path, url), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  assert.ok(response.ok, 'Could not read pinned build asset');
  assert.equal(sha256(Buffer.from(await response.arrayBuffer())), expected, 'Unexpected preview bytes');
}
await verifyAsset('/', '7aa0dae7b211090dc348c6438450beda020d9e1cebd8e307dbcff800a99c995a');
await verifyAsset('/assets/main-h41TAaSg.js', '49d8dfbf2a56727b258b130c4948bbfe43de72b4b6a01c0e54a73bcba5afe359');

const options = { seed: 'CE120-BUMP3', hz: 120, style: 'reckless', params: { hopEvery: 400 }, rngSeed: 9 };
async function capture(browser, maxTicks) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, serviceWorkers: 'block' });
  let closing = false;
  const errors = [];
  try {
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        if (new URL(request.url()).origin !== url.origin || !['GET', 'HEAD'].includes(request.method())) {
          await route.abort();
          return;
        }
        const response = await route.fetch({ maxRedirects: 0 });
        if (closing) return;
        if (response.status() >= 300 && response.status() < 400) await route.abort();
        else await route.fulfill({ response });
      } catch {
        if (!closing) {
          errors.push('request');
          await route.abort().catch(() => {});
        }
      }
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    page.on('pageerror', () => errors.push('page'));
    // Match the conformance recorder: pin the day while letting Phaser's
    // Title fade and frame clocks continue to advance.
    await page.addInitScript(() => {
      const RealDate = Date, start = RealDate.now(), day = RealDate.parse('2026-11-21T12:00:00Z');
      function TestDate(...args) { return new RealDate(...(args.length ? args : [TestDate.now()])); }
      TestDate.prototype = RealDate.prototype;
      TestDate.now = () => day + RealDate.now() - start;
      TestDate.parse = RealDate.parse;
      TestDate.UTC = RealDate.UTC;
      window.Date = TestDate;
    });
    await page.addInitScript({ path: 'tools/conformance/cross-engine-page.js' });
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__bbGame?.scene.getScene('TitleScene')?.sys.isActive() && window.__ce,
      null, { timeout: 30000 });
    const result = await Promise.race([
      page.evaluate(async (args) => {
        const { tape, outcome } = await window.__ce.play(args);
        return { tape, tick: outcome.ticks, crashed: outcome.crashed, cause: outcome.cause };
      }, { ...options, maxTicks }),
      page.waitForTimeout(25000).then(() => { throw new Error('Synthetic capture did not finish'); }),
    ]);
    assert.equal(errors.length, 0, 'Capture had a page or asset error');
    return result;
  } finally {
    closing = true;
    await context.close();
  }
}

function cli(file, args) {
  const child = spawnSync(process.execPath, [file, ...args], {
    encoding: 'utf8', timeout: 135000, maxBuffer: 16 * 1024,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  return child;
}

const dir = await mkdtemp(join(tmpdir(), 'bsb-crash-brief-smoke-'));
try {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let good, cutoff;
  try {
    good = await capture(browser, 2400);
    cutoff = await capture(browser, 464);
  } finally {
    await browser.close();
  }
  assert.deepEqual([good.tick, good.crashed, good.cause, good.tape?.endTick], [937, true, 'terrain', 936]);
  assert.deepEqual([cutoff.tick, cutoff.crashed, cutoff.tape?.endTick, cutoff.tape?.cause], [464, false, 464, 'crash']);
  const goodPath = join(dir, 'terrain.tape.json'), cutoffPath = join(dir, 'cutoff.tape.json');
  await writeFile(goodPath, JSON.stringify(good.tape), { flag: 'wx' });
  // Model a false crash claim: make only the scripted cutoff's run metadata
  // structurally valid. Leave inputs, checkpoints, pose trace and end tick alone.
  const tape = cutoff.tape;
  await writeFile(cutoffPath, JSON.stringify({ ...tape, endedAt: tape.startedAt,
    runId: tape.startedAt + '-' + tape.seed }), { flag: 'wx' });
  const validatedCutoff = await readAirtimeTape(cutoffPath);
  assert.equal(validatedCutoff.checkpoints.length, 3);
  // Crash-brief checks the fatal event before checkpoints, so refusal alone
  // cannot distinguish a clean nonfatal boundary from a failed playback.
  // Independently verify the same bytes with the strict saved-tape runner.
  const cutoffPlayback = cli('tools/sim/benchmark-replay.mjs',
    ['--url', url.href, '--airtime-build', build, '--tape', cutoffPath, '--repeats', '2']);
  assert.equal(cutoffPlayback.status, 0, cutoffPlayback.stderr.trim());
  assert.equal(cutoffPlayback.stderr, '');
  const cutoffProof = JSON.parse(cutoffPlayback.stdout);
  assert.equal(cutoffProof.airtime.observedTicks, 464);
  assert.deepEqual(cutoffProof.replay, { freshRuns: 2, checkpointsCheckedPerRun: 3,
    matchedGroundedAndStateEveryTick: true, savedRunsOrTapes: false });

  const brief = (path) => cli('tools/sim/benchmark-replay.mjs',
    ['--url', url.href, '--crash-brief-build', build, '--tape', path, '--repeats', '2']);
  const positive = brief(goodPath);
  assert.equal(positive.status, 0, positive.stderr.trim());
  assert.equal(positive.stderr, '');
  const result = JSON.parse(positive.stdout);
  assert.deepEqual(result.crash, { category: 'terrain' });
  assert.deepEqual(result.replay, { freshRuns: 2, checkpointsCheckedPerRun: 7,
    matchedStateAndFatalEvent: true, savedRunsOrTapes: false });
  const negative = brief(cutoffPath);
  assert.equal(negative.status, 1);
  assert.equal(negative.stdout, '');
  assert.equal(negative.stderr.trim(), 'Replay did not emit exactly one fatal crash on the expected tick');

  const report = join(dir, 'terrain.brief.json');
  await writeFile(report, positive.stdout, { flag: 'wx' });
  const compare = (other) => cli('tools/sim/compare-crash-briefs.mjs',
    ['--require-match', '--observed', report, '--reference', other]);
  for (const [other, status, label] of [[report, 0, 'match'],
    ['tests/fixtures/crash-brief/packet-spike-v1.json', 2, 'mismatch']]) {
    const comparison = compare(other);
    assert.equal(comparison.stderr, '');
    assert.equal(comparison.status, status);
    assert.equal(JSON.parse(comparison.stdout).status, label);
  }
  console.log('CRASH_BRIEF_CHAIN_PASS terrain=2x7 cutoff=2x3+refused compare=0/2');
} finally {
  await rm(dir, { recursive: true, force: true });
}
