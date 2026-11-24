#!/usr/bin/env node
/** Issue #128: source-verified, bounded real-simulator pursuit stress test. Never modifies gameplay. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndSummarize, markdownReport } from './lib/analysis.mjs';
import { readSourceIdentity, assertSourceUnchanged } from './lib/source-identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ALL_POLICIES = ['handsOff', 'flip', 'canopyHop', 'canopyFlip'];
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function options(argv) {
  const vals = { seeds: '12', policies: ALL_POLICIES.join(','), maxSec: '180', maxM: '100000', workers: '3', sampleMs: '5000' };
  const valid = new Set([...Object.keys(vals), 'outDir']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], eq = arg.indexOf('=');
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!valid.has(key) || Object.hasOwn(vals, `_${key}`)) throw new Error(`unrecognized or duplicated option --${key}`);
    if (arg === `--${key}` && (!argv[i + 1] || argv[i + 1].startsWith('--'))) throw new Error(`--${key} needs an explicit value`);
    vals[`_${key}`] = true;
    vals[key] = eq === -1 ? argv[++i] : arg.slice(eq + 1);
  }
  const integer = (key, min, max) => {
    const n = Number(vals[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key} must be in [${min}, ${max}]`);
    return n;
  };
  const seedList = /^\d+$/.test(vals.seeds)
    ? Array.from({ length: integer('seeds', 1, 96) }, (_, i) => `sim-${String(i + 1).padStart(2, '0')}`)
    : vals.seeds.split(',').map((s) => s.trim());
  if (!seedList.length || seedList.length > 96 || new Set(seedList).size !== seedList.length || seedList.some((s) => !s || s.length > 64)) {
    throw new Error('seed list must contain 1–96 unique, nonempty seeds');
  }
  const policies = vals.policies.split(',').map((s) => s.trim());
  if (!policies.length || new Set(policies).size !== policies.length || policies.some((p) => !ALL_POLICIES.includes(p))) {
    throw new Error(`policies must be unique from ${ALL_POLICIES.join(', ')}`);
  }
  const maxSec = integer('maxSec', 5, 3600);
  const maxM = integer('maxM', 50, 100000);
  const workers = integer('workers', 1, 8);
  const sampleMs = integer('sampleMs', 500, 60000);
  return { seedList, policies, maxSec, maxM, workers, sampleMs, outDir: vals.outDir };
}

async function run() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('node tools/bsod-inevitability/run.mjs [--seeds 12|a,b,c] [--policies handsOff,flip,canopyHop,canopyFlip] [--maxSec 180] [--maxM 100000] [--sampleMs 5000] [--workers 3] [--outDir /path/to/new-output]');
    return;
  }
  const config = options(process.argv.slice(2));
  // Derive canonical source/build and the precise working-tree fingerprint.
  // Keep the same identity across EVERY child browser policy and before report emission.
  const source = await readSourceIdentity(ROOT);
  const { gitSha, buildId } = source;
  const parent = path.resolve(config.outDir || path.join(ROOT, 'tools/bsod-inevitability/out'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(parent, `run-${stamp}`);
  await mkdir(parent, { recursive: true });
  await mkdir(dir); // never overwrite a prior run if the timestamp collides
  const byPolicy = {};
  const rawFiles = {};
  const seedsArg = config.seedList.join(',');
  for (const policy of config.policies) {
    const rawPath = path.join(dir, `raw-${policy}.json`);
    const args = ['tools/sim/run.mjs', '--seeds', seedsArg, '--policy', policy,
      '--maxSec', String(config.maxSec), '--maxM', String(config.maxM),
      '--pursuitSampleMs', String(config.sampleMs), '--workers', String(config.workers),
      '--out', rawPath, '--quiet'];
    process.stderr.write(`running ${policy} (${config.seedList.length} matched seeds)\n`);
    const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    await writeFile(path.join(dir, `run-${policy}.log`), `COMMAND node ${args.join(' ')}\nEXIT ${res.status}\n\n${res.stdout || ''}\n${res.stderr || ''}`);
    if (res.error || res.status !== 0) throw new Error(`${policy} simulator failed (${res.status}): ${(res.stderr || res.error || '').toString().slice(-800)}`);
    // Each child is a separate browser session; do not silently combine different source revisions.
    assertSourceUnchanged(source, await readSourceIdentity(ROOT), `after ${policy}`);
    const raw = await readFile(rawPath);
    const rec = JSON.parse(raw.toString('utf8'));
    if (!rec.args || rec.args.maxSec !== config.maxSec || rec.args.maxM !== config.maxM ||
        rec.args.pursuitSampleMs !== config.sampleMs || rec.args.seeds !== config.seedList.length) {
      throw new Error(`${policy}: simulator returned different settings`);
    }
    byPolicy[policy] = rec;
    rawFiles[policy] = { file: path.basename(rawPath), sha256: sha256(raw) };
  }
  const { rows, summary } = validateAndSummarize({ ...config, byPolicy });
  assertSourceUnchanged(source, await readSourceIdentity(ROOT), 'before evidence write');
  const result = {
    format: 'bsb-bsod-inevitability-evidence', formatVersion: 1, generatedAt: new Date().toISOString(),
    source, config: { seedList: config.seedList, policies: config.policies, maxSec: config.maxSec,
      maxM: config.maxM, workers: config.workers, sampleMs: config.sampleMs, biomeMask: 0,
      assumption: 'default profile, no explicitly purchased boost/upgrade; neutral Daily; scripted bot policies' },
    rawFiles, summary, rows,
    limitations: [
      'All experiments are finite. Horizon survivors are right-censored, NOT proof of infinite survival.',
      'All BSOD gap values are post-tick 60Hz sampled observations, not 120Hz substep extrema.',
      'Policies are scripts, not measurements of human play; no conclusion about all possible strategies.',
      'No gameplay physics, BSOD pursuit tuning, scoring, replay schemas, or historical tapes are changed.',
    ],
  };
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(dir, 'report.md'), markdownReport(result), { flag: 'wx' });
  console.log(`complete: ${rows.length}/${config.seedList.length * config.policies.length} matched runs`);
  console.log(`source=${gitSha} clean=${source.workingTreeClean} build=${buildId}`);
  console.log(`saved ${dir}`);
}

run().catch((error) => { console.error('BSOD inevitability study FAILED CLOSED:', error.stack || error); process.exitCode = 2; });
