/* Render the generated tables of docs/determinism/cross-engine-matrix.md from the raw results JSON (issue #120).
 *   node tools/conformance/cross-engine-report.mjs [results.json] [doc.md]
 * Replaces the text between the GENERATED markers in the doc. Diagnostic, non-authoritative.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resPath = process.argv[2] || path.join(here, '..', '..', 'docs', 'determinism', 'results', 'cross-engine-results.json');
const docPath = process.argv[3] || path.join(here, '..', '..', 'docs', 'determinism', 'cross-engine-matrix.md');
const R = JSON.parse(await readFile(resPath, 'utf8'));
const out = [];
// Harness-native digest groups -> Replay Contract v1.0 (#152) FP_SUBSYSTEMS names. Where one native group spans several contract
// subsystems the mapping lists all of them (this digest is coarser than the contract's 13-way split).
const CONTRACT = { rng: 'rng', timers: 'clock', terrain: 'terrain/hazards/pickups', kodiaks: 'kodiak', bsod: 'bsod', sled: 'sled', world: 'matter', score: 'score/tricks', telegraph: 'presentation (not hashed in the contract)' };
const cn = (list) => (list || []).map((n) => CONTRACT[n] || n).join('+');
const w = (s = '') => out.push(s);

const engines = Object.keys(R.environments);
w('### Environments');
w();
w('| Engine id | Browser / version | Headless mode | OS / arch | GL renderer | Status |');
w('|---|---|---|---|---|---|');
for (const e of engines) {
  const v = R.environments[e];
  if (v.unavailable) { w(`| ${e} | n/a | n/a | n/a | n/a | **unavailable in this environment**: ${v.reason} |`); continue; }
  w(`| ${e} | ${v.browserType} ${v.version} | ${v.headless} | ${v.os} ${v.arch} | ${v.page?.gl?.renderer || 'n/a'} | ran |`);
}
w();
const rows = R.rows.filter((r) => !r.error);
const errs = R.rows.filter((r) => r.error);
const hzs = [...new Set(rows.map((r) => r.hz))].sort((a, b) => a - b);
const fixtureIds = R.fixtures.map((f) => f.id);

w('### Reference outcomes (chromium-headless-shell, 120 Hz stepping, each fixture replayed as run #1 in its own fresh browser context)');
w();
w('| Fixture | Ticks | Final outcome | Distance | Score | Covers |');
w('|---|---|---|---|---|---|');
for (const f of R.fixtures) {
  const o = f.refOutcome || {};
  w(`| ${f.id} | ${o.ticks} | ${o.crashed ? 'crash: ' + o.cause : 'ended at tick limit (no crash)'} | ${o.distanceM} m | ${o.score} | ${f.covers.join('; ')} |`);
}
w();

w('### Matrix: first divergent tick vs the reference (per engine, cadence; both sessions and every run position)');
w();
w('A cell is `ok` when every run of that fixture in every session (including the repeat of run 1 at the end of each session) had a digest sequence identical to the reference; otherwise `FIRST_TICK subsystem(s)` (the earliest across runs; `*` marks inconsistent results across runs of the same cell).');
w();
const cellRows = (e, hz, fx) => rows.filter((r) => r.engine === e && r.hz === hz && r.fixture.startsWith(fx));
for (const fx of fixtureIds) {
  w(`**${fx}**`);
  w();
  w(`| Engine | ${hzs.map((h) => h + ' Hz').join(' | ')} |`);
  w(`|---|${hzs.map(() => '---').join('|')}|`);
  for (const e of engines) {
    if (R.environments[e].unavailable) continue;
    const cells = hzs.map((hz) => {
      const rs = cellRows(e, hz, fx);
      if (!rs.length) return 'n/a';
      const ticks = [...new Set(rs.map((r) => r.firstDivergentTick ?? 'ok'))];
      if (ticks.length === 1 && ticks[0] === 'ok') return `ok (${rs.length})`;
      const bad = rs.filter((r) => r.firstDivergentTick);
      const first = bad.reduce((a, b) => (a.firstDivergentTick <= b.firstDivergentTick ? a : b));
      return `${first.firstDivergentTick} ${cn(first.subsystem)}${ticks.length > 1 ? '*' : ''} (${bad.length}/${rs.length})`;
    });
    w(`| ${e} | ${cells.join(' | ')} |`);
  }
  w();
}

w('Subsystem names are the Replay Contract v1.0 names (`clock, rng, sled, matter, terrain, hazards, pickups, effects, bsod, kodiak, score, tricks, recovery`). This harness digest is coarser: its `terrain` group also covers hazard/pickup counts, `score` also covers trick counters, `world` is the whole Matter world (`matter`), `timers` is `clock`. Native names stay in the raw JSON.');
w();
w('### Telegraph (presentation-derived, issue #155) differences');
w();
const tele = rows.filter((r) => r.telegraphFirstDiffTick && !r.firstDivergentTick);
w(tele.length ? `Runs where only the camera-view-derived telegraph digest differed from the reference (causal digests identical): ${tele.length}. Examples: ${tele.slice(0, 6).map((r) => `${r.engine}/${r.hz}Hz/${r.fixture}@${r.telegraphFirstDiffTick}`).join(', ')}.` : 'No run had a telegraph-only difference: the digest of the planned ground-telegraph marks was identical to the reference whenever the causal digests were.');
w();

w('### Outcomes per engine (final distance / score / ticks / cause) when they differ from the reference');
w();
const odiff = rows.filter((r) => { const f = R.fixtures.find((x) => r.fixture.startsWith(x.id)); const o = f?.refOutcome; return o && (o.ticks !== r.outcome.ticks || o.score !== r.outcome.score || o.distanceM !== r.outcome.distanceM || o.crashed !== r.outcome.crashed || o.cause !== r.outcome.cause); });
if (!odiff.length) w('Every run, on every engine and cadence, ended with the reference tick count, distance, score and crash cause.');
else {
  w('| Engine | Hz | Session/run | Fixture | Ticks | Crash | Distance | Score | Reference |');
  w('|---|---|---|---|---|---|---|---|---|');
  const seen = new Set();
  for (const r of odiff) {
    const k = `${r.engine}|${r.hz}|${r.fixture}`;
    if (seen.has(k)) continue; seen.add(k);
    const o = R.fixtures.find((x) => r.fixture.startsWith(x.id)).refOutcome;
    w(`| ${r.engine} | ${r.hz} | s${r.session}/#${r.run} | ${r.fixture} | ${r.outcome.ticks} | ${r.outcome.crashed ? r.outcome.cause : 'no'} | ${r.outcome.distanceM} | ${r.outcome.score} | ${o.ticks} / ${o.crashed ? o.cause : 'no'} / ${o.distanceM} / ${o.score} |`);
  }
}
w();

w('### TapePlayer checkpoint desync (game-native check, exact sled state every 120 ticks)');
w();
w('| Engine | Hz | Fixture | First desync tick (checkpoint) | Runs desynced / runs |');
w('|---|---|---|---|---|');
const dk = new Map();
for (const r of rows) {
  const k = `${r.engine}|${r.hz}|${r.fixture.replace(/ \(.*/, '')}`;
  const d = dk.get(k) || { n: 0, bad: 0, tick: null, engine: r.engine, hz: r.hz, fx: r.fixture.replace(/ \(.*/, '') };
  d.n++;
  if (r.tapeDesync) { d.bad++; d.tick = d.tick === null ? r.tapeDesync.tick : Math.min(d.tick, r.tapeDesync.tick); }
  dk.set(k, d);
}
const dbad = [...dk.values()].filter((d) => d.bad);
if (!dbad.length) w('| all | all | all | none | 0 |');
for (const d of dbad) w(`| ${d.engine} | ${d.hz} | ${d.fx} | ${d.tick} | ${d.bad}/${d.n} |`);
w();

w('### Math.* isolation (second pass, only where a divergence was found)');
w();
for (const m of R.mathDiagnosis || []) {
  if (m.error) { w(`- ${m.error}`); continue; }
  const impl = Object.entries(m.implementationDiffs || {}).map(([k, v]) => `${k} (${v.ticksWithDiff} ticks, first @${v.firstTick})`).join(', ') || 'none';
  const ex = (m.examples || []).filter((e) => e.example).slice(0, 3).map((e) => `${e.fn}(${e.example.args.map((a) => +a.toPrecision(17)).join(', ')}): ref ${e.example.refResult} vs ${e.example.gotResult} (${e.example.ulp} ulp, tick ${e.tick})`);
  w(`- **${m.engine} / ${m.fixture} / ${m.hz} Hz**: first state divergence at tick ${m.divergentTick}. Ops that returned different results for identical arguments (vs chromium-headless-shell): ${impl}. At the divergent tick: ${m.suspectAtDivergentTick?.length ? m.suspectAtDivergentTick.join(', ') : 'none identified'}. ${ex.length ? 'Examples: ' + ex.join('; ') + '.' : ''}`);
  if (m.counterfactual) {
    const c = m.counterfactual;
    w(`  - Counterfactual (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): ${c.firstDivergentTick ? `still diverges at tick ${c.firstDivergentTick} (${cn(c.subsystem)})` : 'NO divergence over the whole run (digests identical)'}; final outcome ${c.badOutcome.ticks} ticks / ${c.badOutcome.distanceM} m / score ${c.badOutcome.score}.`);
  }
}
if (!(R.mathDiagnosis || []).length) w('No divergence, so no isolation pass was needed.');
w();

w('### Session-position and repeat checks');
w();
const byRun = new Map();
for (const r of rows) { const k = `${r.engine}|${r.hz}|${r.fixture.replace(/ \(.*/, '')}`; const a = byRun.get(k) || new Set(); a.add(r.digestRoll); byRun.set(k, a); }
const unstable = [...byRun].filter(([, s]) => s.size > 1);
const posDiv = rows.filter((r) => r.engine.startsWith('chromium') && r.firstDivergentTick);
if (posDiv.length) w(`**Session-position leak on Chromium**: ${posDiv.length} Chromium runs diverged from their fresh-context reference although engine and cadence were identical. Examples: ${[...new Set(posDiv.map((r) => `${r.fixture} as run #${r.run} @tick ${r.firstDivergentTick} (${cn(r.subsystem)})`))].slice(0, 8).join('; ')}.`);
w(unstable.length ? `Cells whose digest differed between runs/sessions on the same engine and cadence (position-in-session or session-to-session instability): ${unstable.map(([k]) => k).join('; ')}.` : 'For every engine, cadence and fixture, all runs gave one identical digest roll regardless of position in the session (runs 1-10) and across the two fresh contexts, including the repeat of run 1 at the end of each session.');
w();
if (errs.length) { w('### Errors'); w(); for (const e of errs) w(`- ${e.engine} ${e.hz} Hz s${e.session}${e.run ? ' #' + e.run : ''} ${e.fixture || ''}: ${e.error}`); w(); }
w(`Rows: ${R.rows.length} (${rows.length} ok, ${errs.length} errors). Raw JSON: \`docs/determinism/results/cross-engine-results.json\`. Generated ${R.generatedAt} from commit ${R.gitSha}.`);

const doc = await readFile(docPath, 'utf8');
const a = doc.indexOf('<!-- BEGIN GENERATED -->'), b = doc.indexOf('<!-- END GENERATED -->');
if (a < 0 || b < 0) throw new Error('doc has no GENERATED markers');
await writeFile(docPath, doc.slice(0, a) + '<!-- BEGIN GENERATED -->\n' + out.join('\n') + '\n' + doc.slice(b));
console.log('updated', docPath);
