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
const resDir = path.dirname(resPath);
const tryJson = async (f) => { try { return JSON.parse(await readFile(path.join(resDir, f), 'utf8')); } catch { return null; } };
const FRESH = await tryJson('cross-engine-fresh.json');
const POS = await tryJson('position-probe.json');
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
  w(`| ${e} | ${v.browserType} ${v.version} | ${v.headless} | ${v.os} ${v.arch} | ${v.browserType === 'webkit' ? (v.page?.gl?.renderer || 'n/a') + ' (masked string reported by WebKit on Linux; not a real Apple GPU)' : (v.page?.gl?.renderer || 'n/a')} | ran |`);
}
w();
if (FRESH) {
  const fr = FRESH.rows;
  const other = fr.filter((r) => !r.engine.startsWith('chromium-headless-shell') || r.hz !== 120);
  const eng = [...new Set(fr.map((r) => r.engine))];
  w('### Headline: fresh-context results (each cell = run #1 of its own fresh browser context; no session-position effects)');
  w();
  const ff = fr.filter((r) => r.engine === 'firefox' || r.engine === 'webkit');
  const causal = ff.filter((r) => r.firstCausalDivergentTick);
  const derivedBefore = ff.filter((r) => r.derivedFirstDiffTick && (!r.firstCausalDivergentTick || r.derivedFirstDiffTick < r.firstCausalDivergentTick));
  const noDesync = causal.filter((r) => r.tapeDesyncTick === null);
  const outEq = ff.filter((r) => r.outcomeEqualsReference);
  const chrom = fr.filter((r) => r.engine.startsWith('chromium'));
  w(`- Chromium (${[...new Set(chrom.map((r) => r.engine))].length} configs, ${FRESH.rows.filter((r) => r.engine.startsWith('chromium')).length} cells): causal digest identical to the reference in ${chrom.filter((r) => !r.firstCausalDivergentTick).length}/${chrom.length} cells; TapePlayer desync in ${chrom.filter((r) => r.tapeDesyncTick !== null).length}; outcome equal to reference in ${chrom.filter((r) => r.outcomeEqualsReference).length}/${chrom.length}.`);
  w(`- Firefox + WebKit (${ff.length} engine x fixture cells at ${[...new Set(ff.map((r) => r.hz))].join('/')} Hz): first CAUSAL divergence (groups rng, clock, terrain structure, kodiak, bsod, sled, matter, score) in ${causal.length}/${ff.length}; the exact TapePlayer checkpoint check (sled state every 120 ticks) desyncs in ${ff.filter((r) => r.tapeDesyncTick !== null).length}/${ff.length} (${noDesync.length} cells with a causal-digest divergence never desync at a checkpoint); the derived terrain probe (heightAt/slopeAt reads, not state) differs in ${ff.filter((r) => r.derivedFirstDiffTick).length}/${ff.length} and is the EARLIEST difference in ${derivedBefore.length}; **final outcome (ticks, crash cause, distance, score) equals the reference in ${outEq.length}/${ff.length} cells**.`);
  w();
  w('| Engine | Fixture | First causal divergence | Sled delta at that tick | Derived-read first diff (not state) | TapePlayer first desync | Final outcome == reference |');
  w('|---|---|---|---|---|---|---|');
  for (const r of fr.filter((x) => !x.engine.startsWith('chromium') || x.firstCausalDivergentTick || x.tapeDesyncTick !== null || !x.outcomeEqualsReference)) {
    const d = r.sledDeltaAtFirstTick;
    w(`| ${r.engine} ${r.hz} Hz | ${r.fixture} | ${r.firstCausalDivergentTick ? `tick ${r.firstCausalDivergentTick} (${cn(r.subsystem)})` : 'none'} | ${r.firstCausalDivergentTick ? (d && d.length ? d.map((x) => `${x.n} ${x.ulp} ulp`).join(', ') : 'none (sled bit-identical)') : '-'} | ${r.derivedFirstDiffTick ?? 'none'} | ${r.tapeDesyncTick ?? 'never'} | ${r.outcomeEqualsReference ? 'yes' : `NO (${r.outcome.ticks} ticks, ${r.outcome.cause ?? 'no crash'}, ${r.outcome.distanceM} m, ${r.outcome.score})`} |`);
  }
  w();
  w(`Chromium cells not listed above are identical in every column (${chrom.length} cells).`);
  w();
}
if (POS) {
  w('### Session-position probe (Chromium headless shell, ' + POS.hz + ' Hz, harness path: ' + POS.path + ')');
  w();
  w('Each sequence replays tape A then tape B in one page; B is compared with B as run #1 of a fresh context. **The harness does not use the real GameOver/retry flow (it force-stops scenes and calls `TitleScene.startRun`), so this is not yet proven to be a game bug.**');
  w();
  w('| Sequence (run 1 -> run 2) | Run 1 ended | Run 2 first causal divergence | Run 2 TapePlayer desync | Run 2 outcome == fresh |');
  w('|---|---|---|---|---|');
  for (const p of POS.results) w(`| ${p.sequence.join(' -> ')} | ${p.run1CauseOrEnd} | ${p.run2FirstCausalDivergentTick ? `tick ${p.run2FirstCausalDivergentTick} (${cn(p.run2Subsystems)})` : 'none'} | ${p.run2TapeDesync ?? 'never'} | ${p.run2OutcomeEqualsFresh ? 'yes' : `NO (${p.run2.distanceM} m ${p.run2.cause ?? 'no crash'} vs ${p.fresh.distanceM} m ${p.fresh.cause ?? 'no crash'})`} |`);
  w();
}
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

w('### Matrix: first CAUSAL divergent tick vs the fresh reference (per engine, cadence; both sessions; each fixture at its fixed run position in the session)');
w();
w('A cell is `ok` when every run of that fixture in every session (including the repeat of run 1 at the end of each session) had a digest sequence identical to the reference; otherwise `FIRST_TICK subsystem(s)` (causal groups only; derived probe reads are in their own table) (the earliest across runs; `*` marks inconsistent results across runs of the same cell).');
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
w('### Derived probe reads (heightAt/slopeAt at the sled x; read-only, not simulation state)');
w();
const dr = rows.filter((r) => r.derivedFirstDiffTick);
w(dr.length ? `Runs where the derived probe differed from the reference: ${dr.length}/${rows.length}; of these ${dr.filter((r) => !r.firstDivergentTick).length} had NO causal divergence (probe-only). First derived difference per engine: ${[...new Set(dr.map((r) => r.engine))].map((e) => `${e} tick ${Math.min(...dr.filter((r) => r.engine === e).map((r) => r.derivedFirstDiffTick))}`).join(', ')}.` : 'No run had a derived-probe difference.');
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
  w(`- **${m.engine} / ${m.fixture} / ${m.hz} Hz**: first state divergence in the matrix at tick ${m.divergentTick}${m.freshContextFirstDivergentTick !== undefined ? `; as run #1 of a fresh context on both sides: ${m.freshContextFirstDivergentTick === null ? 'none' : `tick ${m.freshContextFirstDivergentTick} (${cn(m.freshContextSubsystems)})`}` : ''}. Ops that returned different results for identical arguments (vs chromium-headless-shell): ${impl}. At the divergent tick: ${m.suspectAtDivergentTick?.length ? m.suspectAtDivergentTick.join(', ') : 'none identified'}. ${ex.length ? 'Examples: ' + ex.join('; ') + '.' : ''}`);
  if (m.counterfactual) {
    const c = m.counterfactual;
    w(`  - Counterfactual at ${c.scope} (those ops replaced by a pure-JS +,-,*,/,sqrt implementation in BOTH engines): ${c.firstDivergentTick ? `still diverges at tick ${c.firstDivergentTick} (${cn(c.subsystem)})` : 'NO divergence over the whole run (patched A == patched B)'}${c.unreplacedFns && c.unreplacedFns.length ? `; NOTE ${c.unreplacedFns.join(', ')} had no replacement in this run` : ''}; the patched sim TapePlayer-desyncs from the recording at tick ${c.tapeDesyncBad ? c.tapeDesyncBad.tick : 'n/a'} (it is not the recorded sim); final outcome ${c.badOutcome.ticks} ticks / ${c.badOutcome.distanceM} m / score ${c.badOutcome.score}.`);
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
w(unstable.length ? `Cells whose digest differed between runs/sessions on the same engine and cadence (position-in-session or session-to-session instability): ${unstable.map(([k]) => k).join('; ')}.` : 'Per engine, cadence and fixture, both fresh sessions gave one identical digest roll, and the repeat of fixture 1 at run #10 matched run #1. (Session position effects are measured against the fresh-context reference above, not by this line.)');
w();
if (errs.length) { w('### Errors'); w(); for (const e of errs) w(`- ${e.engine} ${e.hz} Hz s${e.session}${e.run ? ' #' + e.run : ''} ${e.fixture || ''}: ${e.error}`); w(); }
w(`Rows: ${R.rows.length} (${rows.length} ok, ${errs.length} errors). Raw JSON: \`docs/determinism/results/cross-engine-results.json\`. Generated ${R.generatedAt} from commit ${R.gitSha}.`);

const doc = await readFile(docPath, 'utf8');
const a = doc.indexOf('<!-- BEGIN GENERATED -->'), b = doc.indexOf('<!-- END GENERATED -->');
if (a < 0 || b < 0) throw new Error('doc has no GENERATED markers');
await writeFile(docPath, doc.slice(0, a) + '<!-- BEGIN GENERATED -->\n' + out.join('\n') + '\n' + doc.slice(b));
console.log('updated', docPath);
