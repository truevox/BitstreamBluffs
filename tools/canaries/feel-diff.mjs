/**
 * Issue #117 feel-diff dashboard (TEST INFRASTRUCTURE ONLY).
 *
 * Compares freshly recorded canary runs against the committed golden baselines and reports, per canary:
 * the status (PASS / EXPECTED_DIFF / DIVERGED / MISSING_BASELINE), the earliest checkpoint where any
 * compared field moved beyond its epsilon (tick, field, baseline, current, delta), the outcome deltas
 * (crash tick/cause/score/distance/end tick) and the handling-statistics comparison.
 *
 * It is a regression gate for *handling changes*, not a physics tuner: it never edits src/**, never
 * writes goldens unless explicitly asked (--record-golden), and never widens an epsilon to hide a
 * difference. A real handling change must be declared in `expected/<id>.json` with a written reason and
 * a named reviewer, or it reports DIVERGED.
 *
 *   node tools/canaries/feel-diff.mjs                      # re-record the corpus, compare to golden/
 *   node tools/canaries/feel-diff.mjs --use-out            # compare the existing out/ records, no browser
 *   ONLY=flip-edge node tools/canaries/feel-diff.mjs --use-out
 *   REPORT_MD=docs/canary-diff.md node tools/canaries/feel-diff.mjs
 *   node tools/canaries/feel-diff.mjs --record-golden      # record the CURRENT runs as the new baseline
 *
 * Exit codes: 0 = every canary PASS or EXPECTED_DIFF; 2 = at least one DIVERGED or MISSING_BASELINE
 * (i.e. the gate fails); 1 = harness/usage error (no verdict was reached).
 *
 * Env: GAME_URL, CANARY_DIR, OUT_DIR, ONLY, BASELINE_DIR (alias GOLDEN_DIR), EPSILON_JSON,
 *      SUMMARY_JSON (default OUT_DIR/feel-diff-summary.json), REPORT_MD, JSON_OUT (alias SUMMARY_JSON).
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const compare = require('./lib/compare.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const CANARY_DIR = path.resolve(ROOT, process.env.CANARY_DIR || 'tools/canaries/corpus');
const OUT_DIR = path.resolve(ROOT, process.env.OUT_DIR || 'tools/canaries/out');
// BASELINE_DIR is the issue's name; GOLDEN_DIR is kept as a friendly alias for the runner's golden mode.
const GOLDEN_DIR = path.resolve(ROOT, process.env.BASELINE_DIR || process.env.GOLDEN_DIR || 'tools/canaries/golden');
const EXPECTED_DIR = path.resolve(ROOT, 'tools/canaries/expected');
const REPORT_MD = process.env.REPORT_MD ? path.resolve(ROOT, process.env.REPORT_MD) : null;
const SUMMARY_JSON = process.env.SUMMARY_JSON
  ? path.resolve(ROOT, process.env.SUMMARY_JSON)
  : process.env.JSON_OUT
    ? path.resolve(ROOT, process.env.JSON_OUT)
    : path.join(OUT_DIR, 'feel-diff-summary.json');
const ONLY = new Set((process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean));
const USE_OUT = process.argv.includes('--use-out');
const RECORD_GOLDEN = process.argv.includes('--record-golden');

/**
 * Per-field epsilon. Position is pixels in the run's own coordinate space, angle is radians, velocities
 * are px/s, score is points. Defaults are zero: the runner is deterministic frame-stepped against a fixed
 * tick, so a difference in the last bit is a real difference. Widen per field only through a reviewed
 * `expected/<id>.json`, never here — see tools/canaries/expected/README.md.
 */
const DEFAULT_EPSILON = { ...compare.DEFAULT_EPSILON };

async function readJSON(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function loadEpsilon() {
  if (!process.env.EPSILON_JSON) return { ...DEFAULT_EPSILON, source: 'default (all zero)' };
  const raw = await readJSON(path.resolve(ROOT, process.env.EPSILON_JSON));
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in DEFAULT_EPSILON)) throw new Error(`EPSILON_JSON: unknown field "${k}"`);
    if (!Number.isFinite(v) || v < 0) throw new Error(`EPSILON_JSON: ${k} must be a non-negative number`);
  }
  return { ...DEFAULT_EPSILON, ...raw, source: process.env.EPSILON_JSON };
}

async function canaryIds() {
  const names = (await readdir(CANARY_DIR)).filter((n) => n.endsWith('.json')).sort();
  const ids = names.map((n) => n.replace(/\.json$/, ''));
  return ONLY.size ? ids.filter((id) => ONLY.has(id)) : ids;
}

/** Re-record the corpus through the real runner (browser) unless --use-out says to trust out/. */
function runRecorder(ids) {
  const args = ['tools/canaries/run-canaries.mjs'];
  const env = { ...process.env, OUT_DIR, CANARY_DIR };
  if (ids.length) env.ONLY = ids.join(',');
  const res = spawnSync('node', args, { cwd: ROOT, env, encoding: 'utf8' });
  process.stderr.write(res.stdout || '');
  process.stderr.write(res.stderr || '');
  if (res.status !== 0) throw new Error(`run-canaries.mjs exited ${res.status}; see its output above`);
}

const fmtNum = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')) : String(v));

/** Derive an integer sim tick from a checkpoint tickMs and the record's declared tick rate. */
const tickOf = (tickMs, simTickHz) => (Number.isFinite(tickMs) && Number.isFinite(simTickHz) ? Math.round((tickMs * simTickHz) / 1000) : null);

/** Human line for the earliest divergence. tickMs is simulated time; the tick is the fixed-clock tick at simTickHz. */
function divergenceLine(d, simTickHz) {
  if (!d) return 'none';
  const tick = tickOf(d.tickMs, simTickHz);
  const at = tick == null ? `at ${fmtNum(d.tickMs)} ms` : `at tick ${tick} (${fmtNum(d.tickMs)} ms)`;
  if (d.field === 'checkpointCount') return `checkpoint count ${d.baseline} -> ${d.current} (${at})`;
  if (d.delta == null) return `${d.field} ${fmtNum(d.baseline)} -> ${fmtNum(d.current)} (non-finite) ${at}`;
  return `${d.field} ${fmtNum(d.baseline)} -> ${fmtNum(d.current)} (abs delta ${fmtNum(d.absDelta)}) ${at}`;
}

function outcomeLine(o) {
  if (!o || !o.changed.length) return 'unchanged';
  return o.changed.map((f) => {
    const d = o.deltas[f];
    if (typeof d === 'number') return `${f} ${fmtNum(o.baseline[f])} -> ${fmtNum(o.current[f])} (delta ${fmtNum(d)})`;
    return `${f} ${JSON.stringify(o.baseline[f])} -> ${JSON.stringify(o.current[f])}`;
  }).join('; ');
}

function statsLine(s) {
  if (!s) return 'n/a';
  const bits = [];
  if (s.scoreMeanDelta) bits.push(`scoreMean ${fmtNum(s.scoreMeanDelta)}`);
  if (s.airborneTicksDelta) bits.push(`airborneTicks ${fmtNum(s.airborneTicksDelta)}`);
  if (s.inputChangesDelta) bits.push(`inputChanges ${fmtNum(s.inputChangesDelta)}`);
  if (s.ticksDelta) bits.push(`ticks ${fmtNum(s.ticksDelta)}`);
  if (s.timeToFirstInputDeltaMs != null && s.timeToFirstInputDeltaMs !== 0) bits.push(`timeToFirstInput ${fmtNum(s.timeToFirstInputDeltaMs)} ms`);
  return bits.length ? bits.join(', ') : 'unchanged';
}

function versionLine(v) {
  if (!v) return 'n/a';
  if (!v.changed) {
    const c = v.current || {};
    return `unchanged (simTickHz=${c.simTickHz} runRandomVersion=${c.runRandomVersion} ghostPhysicsVersion=${c.ghostPhysicsVersion})`;
  }
  return `CHANGED baseline=${JSON.stringify(v.baseline)} current=${JSON.stringify(v.current)}`;
}

function markdown(results, epsilon) {
  const lines = [];
  lines.push('| canary | status | first divergence | outcome | handling stats |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of results) {
    lines.push(`| ${r.id} | ${r.status} | ${divergenceLine(r.firstDivergence, r.simTickHz)} | ${outcomeLine(r.outcome)} | ${statsLine(r.stats)} |`);
  }
  lines.push('');
  lines.push(`Epsilon (per field, 0 = exact): ${epsilonLine(epsilon)}`);
  return `${lines.join('\n')}\n`;
}

function epsilonLine(epsilon) {
  const fields = Object.entries(epsilon).filter(([k]) => k !== 'source').map(([k, v]) => `${k}=${v}`).join(', ');
  return `${fields} — source: ${epsilon.source}`;
}

async function main() {
  const ids = await canaryIds();
  if (!ids.length) throw new Error(`no canaries found in ${CANARY_DIR}${ONLY.size ? ` for ONLY=${[...ONLY].join(',')}` : ''}`);
  const epsilon = await loadEpsilon();

  if (!USE_OUT) runRecorder(ids);
  if (RECORD_GOLDEN && USE_OUT) throw new Error('--record-golden needs a fresh recording; drop --use-out');

  const results = [];
  for (const id of ids) {
    const currentPath = path.join(OUT_DIR, `${id}.json`);
    const goldenPath = path.join(GOLDEN_DIR, `${id}.json`);
    const expectedPath = path.join(EXPECTED_DIR, `${id}.json`);

    if (!existsSync(currentPath)) throw new Error(`missing current record ${path.relative(ROOT, currentPath)}: run the recorder for ${id} first`);
    const current = await readJSON(currentPath);
    const baseline = existsSync(goldenPath) ? await readJSON(goldenPath) : null;
    const expected = existsSync(expectedPath) ? await readJSON(expectedPath) : null;

    if (RECORD_GOLDEN) {
      await mkdir(GOLDEN_DIR, { recursive: true });
      await writeFile(goldenPath, `${JSON.stringify(current, null, 2)}\n`);
    }
    const result = compare.classifyRun({ baseline, current, expected, epsilon });
    result.hz = current.hz ?? baseline?.hz ?? null;
    result.simTickHz = current?.simVersion?.simTickHz ?? baseline?.simVersion?.simTickHz ?? null;
    // compareOutcome covers crashed/crashTick/cause/score/distance/endTick; surface the crash hazardId too.
    result.hazardId = { baseline: baseline?.result?.hazardId ?? null, current: current?.result?.hazardId ?? null };
    result.spread = { baselinePath: baseline ? path.relative(ROOT, goldenPath) : null, expectedPath: expected ? path.relative(ROOT, expectedPath) : null };
    results.push(result);
  }

  for (const r of results) {
    const out = r.outcome && r.outcome.current ? r.outcome.current : {};
    const verdict = r.status.padEnd(17);
    console.log(`${verdict} ${r.id.padEnd(20)} crash=${out.crashed ? `@${out.crashTick}(${out.cause || '?'})` : 'no'} score=${out.score} dist=${out.distance}m endTick=${out.endTick}`);
    console.log(`  first divergence: ${divergenceLine(r.firstDivergence, r.simTickHz)}`);
    console.log(`  outcome:          ${outcomeLine(r.outcome)}`);
    if (r.hazardId && r.hazardId.baseline !== r.hazardId.current) {
      console.log(`  crash hazardId:   ${JSON.stringify(r.hazardId.baseline)} -> ${JSON.stringify(r.hazardId.current)}`);
    }
    console.log(`  handling stats:   ${statsLine(r.stats)}`);
    if (r.simVersion && r.simVersion.changed) {
      console.log(`  !!! SIM VERSION CHANGED !!! baseline=${JSON.stringify(r.simVersion.baseline)} current=${JSON.stringify(r.simVersion.current)}`);
      console.log('      Comparing across a physics/format bump is meaningless; re-record goldens after review.');
    } else {
      console.log(`  sim version:      ${versionLine(r.simVersion)}`);
    }
    if (r.expected) console.log(`  expected diff:    reviewed by ${r.expected.reviewer} at ${r.expected.reviewedAt} — ${r.expected.reason}`);
    if (r.status === compare.STATUS.DIVERGED && r.expected) console.log('  NOTE: an expected/<id>.json exists but does not cover every difference; treat as unreviewed.');
    if (r.status === compare.STATUS.MISSING_BASELINE) console.log(`  NOTE: no golden at ${path.relative(ROOT, path.join(GOLDEN_DIR, `${r.id}.json`))} — record it with --record-golden after review.`);
  }

  console.log('');
  console.log(`epsilon (per field, 0 = exact): ${epsilonLine(epsilon)}`);
  const tally = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log('');
  console.log(`canaries=${results.length} ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (RECORD_GOLDEN) console.log(`recorded goldens -> ${path.relative(ROOT, GOLDEN_DIR)}`);

  const summary = {
    generatedAt: new Date().toISOString(),
    baselineDir: path.relative(ROOT, GOLDEN_DIR),
    outDir: path.relative(ROOT, OUT_DIR),
    epsilon: Object.fromEntries(Object.entries(epsilon).filter(([k]) => k !== 'source')),
    epsilonSource: epsilon.source,
    tally,
    canaries: results.map((r) => ({
      id: r.id,
      hz: r.hz ?? null,
      simTickHz: r.simTickHz ?? null,
      status: r.status,
      firstDivergence: r.firstDivergence,
      divergenceCount: r.divergences.length,
      outcome: r.outcome,
      stats: r.stats,
      simVersion: r.simVersion,
      expected: r.expected ? { reviewer: r.expected.reviewer, reviewedAt: r.expected.reviewedAt, reason: r.expected.reason, allowed: r.expected.allowed } : null,
    })),
  };
  await mkdir(path.dirname(SUMMARY_JSON), { recursive: true });
  await writeFile(SUMMARY_JSON, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`json summary -> ${path.relative(ROOT, SUMMARY_JSON)}`);
  if (REPORT_MD) {
    await mkdir(path.dirname(REPORT_MD), { recursive: true });
    await writeFile(REPORT_MD, markdown(results, epsilon));
    console.log(`markdown report -> ${path.relative(ROOT, REPORT_MD)}`);
  }

  const failed = results.filter((r) => r.status === compare.STATUS.DIVERGED || r.status === compare.STATUS.MISSING_BASELINE);
  process.exitCode = failed.length ? 2 : 0;
}

main().catch((e) => {
  console.error('FEEL-DIFF HARNESS ERROR:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
