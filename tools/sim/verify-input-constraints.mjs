/** #71: verify a same-build local tape before reporting its input constraints. */
import { parseArgs } from 'node:util';
import { localUrl, readAirtimeTape, runCrashBrief } from './benchmark-replay.mjs';
import { evaluateInputConstraints, hopEdgeBudget } from './input-constraints.js';

class Diagnostic extends Error {}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: {
      url: { type: 'string', default: 'http://127.0.0.1:8293/' }, build: { type: 'string' }, tape: { type: 'string' },
      'max-hop-edges': { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } }));
  } catch { throw new Diagnostic('Use --help for accepted options'); }
  if (values.help) {
    console.log('Usage: node tools/sim/verify-input-constraints.mjs --build FULL_GIT_COMMIT --tape FILE [--url HTTP_LOOPBACK] [--max-hop-edges 0–120]');
    return;
  }
  if (!/^[0-9a-f]{40}$/i.test(values.build ?? '') || !values.tape) {
    throw new Diagnostic('Provide a full 40-hex Git build commit and an explicit saved --tape');
  }
  let url, budget, tape;
  try { url = localUrl(values.url); }
  catch { throw new Diagnostic('Use an HTTP loopback game preview URL without credentials'); }
  try { budget = hopEdgeBudget(values['max-hop-edges']); }
  catch { throw new Diagnostic('Hop edge budget must be a whole number from 0 to 120'); }
  try { tape = await readAirtimeTape(values.tape); }
  catch { throw new Diagnostic('Use a readable, bounded, complete compatible normal-run tape'); }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
    .catch(() => { throw new Diagnostic('Could not launch local Chromium for constraint verification'); });
  let replay;
  try {
    // Use the exact in-memory parsed tape for the two replays and the later
    // audit. Never reread a mutable path or hand results from another tape in.
    replay = (await runCrashBrief(browser, url, tape, 2)).replay;
  } catch { throw new Diagnostic('Saved replay did not verify in two fresh local playbacks'); }
  finally { await browser.close().catch(() => { throw new Diagnostic('Local Chromium did not close cleanly'); }); }
  const { observed, candidates } = evaluateInputConstraints(tape, budget);
  console.log(JSON.stringify({
    kind: 'local-replay-input-constraint-audit', reportVersion: 1,
    scope: 'candidate rules for recorded input only; not a player, course, Daily or ranked result',
    interval: 'all replayed input through the reproduced fatal tick',
    build: { sameBuildAsserted: true, independentlyVerified: false },
    replay: { freshRuns: replay.freshRuns, checkpointsCheckedPerRun: replay.checkpointsCheckedPerRun,
      matchedStateAndFatalEvent: replay.matchedStateAndFatalEvent, savedRunsOrTapes: replay.savedRunsOrTapes },
    observed, candidates,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Input constraint audit: ${error instanceof Diagnostic ? error.message : 'Verification did not complete'}`);
  process.exitCode = 1;
});
