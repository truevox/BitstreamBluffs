#!/usr/bin/env node
/**
 * W2 reachability evidence: measure every single-run mission target against REAL simulated runs played
 * under every one of the 8 DailyPatch rules.
 *
 * Why this exists: Luna's W2 audit (finding 1) rejected the original compatibility test because it only
 * asserted "the rule has a nonzero modifier" and scaled airtime by 1/sqrt(gravityMul) instead of running
 * the game. This script runs the game. It reports, per rule, the measured maxima for each metric a
 * single-run template can use, then lists any template target that exceeds what was actually observed.
 *
 * Two bot policies are swept and the best result per rule per metric is kept: `hop` is the stronger
 * distance/shard/near-miss player, `flip` is the only one that tricks at all. Neither composes trick
 * chains, so `bestCombo` is reported as measured-but-bot-limited and the x2 ceiling is derived from
 * SCORING in tests/src/missions.test.js instead.
 *
 *   node tools/sim/mission-reachability.mjs [--seeds 8] [--maxM 20000] [--policies hop,flip]
 *
 * Exit code 1 if any single-run target is unreachable in any rule.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);

const args = { seeds: 6, maxM: 8000, maxSec: 300, policies: 'hop,flip' };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) args[k.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
}

const { DailyPatch } = await import(path.join(root, 'src/systems/DailyPatch.js'));
const missions = JSON.parse(readFileSync(path.join(root, 'src/data/missions/missions.json'), 'utf8'));

const RULES = ['none', ...DailyPatch.RULES.map((r) => r.id)];

async function freePort() {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

// Serve the repo the way vite preview does: a static server over dist/ is not enough (the harness
// imports /src/*.js), so use `vite` through its dev server like the other sim tools do.
const port = await freePort();
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], {
  cwd: root, stdio: 'ignore',
});
const url = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 200; i++) {
  try { const r = await fetch(url); if (r.ok) break; } catch (e) { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 100));
}

const outDir = path.join(root, 'tools/sim/.reach');
mkdirSync(outDir, { recursive: true });

const POLICIES = String(args.policies).split(',').map((s) => s.trim()).filter(Boolean);
const perRule = {};
try {
  for (const policy of POLICIES) {
    for (const rule of RULES) {
      const outJson = path.join(outDir, `${rule}.${policy}.json`);
      await new Promise((res, rej) => {
        const p = spawn(process.execPath, [
          path.join(here, 'run.mjs'), '--seeds', String(args.seeds), '--policy', policy,
          '--maxM', String(args.maxM), '--maxSec', String(args.maxSec), '--workers', '4',
          '--rule', rule, '--out', outJson, '--quiet',
        ], { cwd: root, stdio: 'inherit' });
        p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`run.mjs exit ${c} for rule ${rule} policy ${policy}`))));
      });
      const data = JSON.parse(readFileSync(outJson, 'utf8'));
      const runs = data.results || [];
      // Best of every policy so far, per metric: the question is "can this target be reached at all",
      // so the strongest observed player is the right evidence, not the average one.
      const max = (f) => runs.reduce((a, r) => Math.max(a, f(r) || 0), 0);
      const cur = perRule[rule] || {};
      perRule[rule] = {
        runs: (cur.runs || 0) + runs.length,
        policies: [...new Set([...(cur.policies || []), policy])],
        distanceM: Math.max(cur.distanceM || 0, max((r) => r.distM)),
        score: Math.max(cur.score || 0, max((r) => r.score)),
        shards: Math.max(cur.shards || 0, max((r) => r.shards)),
        nearMisses: Math.max(cur.nearMisses || 0, max((r) => r.nearMisses)),
        tricks: Math.max(cur.tricks || 0, max((r) => Object.values(r.tricks || {}).reduce((a, b) => a + b, 0))),
        maxAirtimeMs: Math.max(cur.maxAirtimeMs || 0, max((r) => r.maxAirtimeMs)),
        bestCombo: Math.max(cur.bestCombo || 0, max((r) => r.bestCombo)),
      };
      const m = perRule[rule];
      process.stderr.write(`${rule.padEnd(14)} ${policy.padEnd(5)} dist ${m.distanceM} score ${m.score} shards ${m.shards} nm ${m.nearMisses} air ${m.maxAirtimeMs} combo ${m.bestCombo}\n`);
    }
  }
} finally {
  vite.kill('SIGTERM');
}

const METRIC = {
  distanceM: 'distanceM', score: 'score', shards: 'shards', nearMisses: 'nearMisses',
  tricks: 'tricks', maxAirtimeMs: 'maxAirtimeMs', bestCombo: 'bestCombo',
};

const failures = [];
const advisory = [];
for (const t of missions.templates) {
  if (!t || t.type !== 'singleRun' || !METRIC[t.metric] || !(t.target > 0)) continue;
  // bestCombo is the one metric no bot policy exercises: chaining flips/helicopters into one combo is a
  // skill the harness does not have, so a shortfall here is a limit of the measurement, not evidence of
  // an impossible mission. Its ceiling is proven arithmetically from SCORING in tests/src/missions.test.js.
  if (t.metric === 'bestCombo') {
    for (const rule of RULES) {
      const seen = perRule[rule].bestCombo;
      if (t.target > seen) advisory.push({ id: t.id, metric: t.metric, target: t.target, rule, seen });
    }
    continue;
  }
  for (const rule of RULES) {
    const seen = perRule[rule][METRIC[t.metric]];
    if (t.target > seen) failures.push({ id: t.id, metric: t.metric, target: t.target, rule, seen });
  }
}

const report = { args, policies: POLICIES, perRule, failures, advisory };
writeFileSync(path.join(outDir, 'reachability.json'), JSON.stringify(report, null, 1));

if (advisory.length) {
  const targets = [...new Set(advisory.map((a) => `${a.id} (x${a.target})`))];
  console.log(`\nADVISORY — combo targets above what the bots achieved (${targets.length}); bots cannot chain tricks,`);
  console.log(`so this is a measurement limit. Ceiling is proven from SCORING in tests/src/missions.test.js:`);
  for (const t of targets) console.log(`  ${t}`);
}
if (failures.length) {
  console.log(`\nUNREACHABLE (${failures.length}):`);
  for (const f of failures.slice(0, 40)) console.log(`  ${f.id} needs ${f.metric} ${f.target}, best measured under ${f.rule}: ${f.seen}`);
} else {
  console.log(`\nAll single-run targets are reachable under every daily rule (${RULES.length} rules x ${args.seeds} seeds).`);
}
console.log(`wrote ${path.join(outDir, 'reachability.json')}`);
process.exit(failures.length ? 1 : 0);
