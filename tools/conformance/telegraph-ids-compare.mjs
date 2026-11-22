/**
 * Issue #119 Phase 2 (stable-id TelegraphTracker): before/after evidence that re-keying the tracker changed no tick
 * outcome. Diagnostic, non-authoritative; to be replaced by the #152 contract when published.
 *
 *   # serve a build, then (once per build, e.g. origin/main and this branch):
 *   GAME_URL=http://localhost:8471/ OUT=after.json node tools/conformance/telegraph-ids-compare.mjs
 *   node tools/conformance/telegraph-ids-compare.mjs --compare before.json after.json
 *
 * Runs the causal-isolation probe's fixtures (default hazards,kodiak,tricks) at the baseline cadence and records, per
 * tick, the full diagnostic digest (sled, physics RNG, Matter, hazards, score, telegraph marks, teleAtMs, SFX cues)
 * plus the ordered SFX/event cue list, then compares two such files for exact equality.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runCase } from './causal-isolation-probe.mjs';

const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const args = process.argv.slice(2);

if (args[0] === '--compare') {
  const a = JSON.parse(readFileSync(args[1], 'utf8'));
  const b = JSON.parse(readFileSync(args[2], 'utf8'));
  let bad = 0;
  for (const f of Object.keys(a.fixtures)) {
    const x = a.fixtures[f]; const y = b.fixtures[f];
    const same = x && y && x.digestHash === y.digestHash && x.cueHash === y.cueHash && x.ticks === y.ticks;
    if (!same) bad++;
    console.log(`${f.padEnd(8)} ticks ${x.ticks}/${y.ticks} cues ${x.cueCount}/${y.cueCount} warn ${x.warnCues}/${y.warnCues} hop ${x.hopCues}/${y.hopCues} teleStamps ${x.teleStamps}/${y.teleStamps} digest ${x.digestHash}/${y.digestHash} cues# ${x.cueHash}/${y.cueHash} ${same ? 'IDENTICAL' : 'DIFFERENT'}`);
  }
  process.exit(bad ? 1 : 0);
}

const fixtures = (process.env.FIXTURES || 'hazards,kodiak,tricks').split(',');
const out = { gameUrl: process.env.GAME_URL || 'http://localhost:8411/', fixtures: {} };
for (const f of fixtures) {
  const r = await runCase(f, 'baseline-repeat', null);
  const cues = r.states.flatMap((s) => [...(s.sfx || []).map((q) => ['sfx', s.tick, ...q]), ...(s.events || []).map((q) => ['evt', s.tick, ...q])]);
  const teleStamps = Math.max(0, ...r.states.map((s) => s.telegraph?.warnedAt?.length ?? 0));
  const warnCues = cues.filter((c) => c[0] === 'sfx' && c[2] === 'groundWarn').length;
  const hopCues = cues.filter((c) => c[0] === 'sfx' && c[2] === 'hopCue').length;
  out.fixtures[f] = { ticks: r.digests.length, digestHash: sha(r.digests), cueHash: sha(cues), cueCount: cues.length, teleStamps, warnCues, hopCues, errors: r.errors, meta: r.meta };
  console.log(f, out.fixtures[f].ticks, 'ticks', cues.length, 'cues', warnCues, 'groundWarn', hopCues, 'hopCue', teleStamps, 'tele stamps', out.fixtures[f].digestHash);
}
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
process.exit(0);
