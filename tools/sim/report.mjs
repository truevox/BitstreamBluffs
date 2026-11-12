#!/usr/bin/env node
/**
 * Turns run.mjs JSON outputs into a markdown baseline report.
 *
 *   node tools/sim/report.mjs <dir> > <dir>/baseline.md
 *
 * Expects in <dir> (produced by tools/sim/baseline.sh): handsOff.json, hop.json, flip-late{0,100,200,300,400}.json,
 * stall.json, terrain.json. Missing files are skipped.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: report.mjs <dir>'); process.exit(1); }
const load = (n) => (existsSync(path.join(dir, n)) ? JSON.parse(readFileSync(path.join(dir, n), 'utf8')) : null);

const q = (arr, p) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * p; const lo = Math.floor(i);
  return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo);
};
const f = (v, d = 1) => (v == null || Number.isNaN(v) ? '-' : (Math.round(v * 10 ** d) / 10 ** d).toString());
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const count = (arr, fn) => { const m = {}; for (const x of arr) { const k = fn(x); m[k] = (m[k] || 0) + 1; } return m; };
const fmtCount = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const out = [];
const P = (s = '') => out.push(s);

function crashSection(name, res) {
  const R = res.results;
  const crashes = R.filter((r) => r.crash);
  P(`### ${name}: ${R.length} seeds`);
  P();
  P(`- end reasons: ${fmtCount(count(R, (r) => r.endReason))}`);
  P(`- crash distance (m): min ${f(q(crashes.map((r) => r.crash.distM), 0))}, p25 ${f(q(crashes.map((r) => r.crash.distM), 0.25))}, median ${f(q(crashes.map((r) => r.crash.distM), 0.5))}, p75 ${f(q(crashes.map((r) => r.crash.distM), 0.75))}, max ${f(q(crashes.map((r) => r.crash.distM), 1))}`);
  const bins = [[0, 150], [150, 300], [300, 500], [500, 1000], [1000, 2000], [2000, 1e9]];
  P(`- crash distance histogram: ${bins.map(([a, b]) => `${a}-${b > 1e8 ? '+' : b}m: ${crashes.filter((r) => r.crash.distM >= a && r.crash.distM < b).length}`).join(', ')}`);
  P(`- crash cause: ${fmtCount(count(crashes, (r) => r.crash.cause))}; hazard crashes by hazard: ${fmtCount(count(crashes.filter((r) => r.crash.cause === 'hazard'), (r) => r.crash.hazardId))}`);
  P(`- opening grace: fired in ${R.filter((r) => r.openingGraces > 0).length}/${R.length} runs, ${R.reduce((a, r) => a + r.openingGraces, 0)} times total (max ${Math.max(...R.map((r) => r.openingGraces))} in one run)`);
  P(`- shield (Hashed Backup) negated crashes: ${R.reduce((a, r) => a + r.negatedCrashes.length, 0)}`);
  const early = crashes.filter((r) => r.crash.distM < 150);
  P(`- crashes before 150 m: **${early.length}**`);
  if (early.length) {
    P();
    P(table(['seed', 'distM', 'cause', 'slope deg', 'speed px/s', 'state', 'last landing'], early.map((r) => {
      const c = r.crash;
      const ll = c.lastLanding ? `${c.lastLanding.quality} ${c.lastLanding.angleDeg}deg ${c.lastLanding.msBefore}ms before` : '-';
      return [r.seed, f(c.distM), c.cause + (c.hazardId ? `/${c.hazardId}` : ''), f(c.slopeDeg), c.speedPxS,
        c.grounded ? 'grounded' : `airborne ${c.airborneMs}ms, body ${f(c.angleDeg, 0)}deg`, ll];
    })));
  }
  P();
  // terrain/badLanding crashes after a good/perfect landing within 1.5 s
  const post = crashes.filter((r) => ['terrain', 'badLanding'].includes(r.crash.cause) && r.crash.lastLanding
    && ['good', 'perfect'].includes(r.crash.lastLanding.quality) && r.crash.lastLanding.msBefore <= 1500);
  const terr = crashes.filter((r) => r.crash.cause === 'terrain');
  const postT = terr.filter((r) => post.includes(r));
  P(`- **terrain crashes within 1.5 s after a good/perfect landing**: ${postT.length} of ${terr.length} terrain crashes (${pct(postT.length, terr.length)}); `
    + `incl. badLanding: ${post.length} of ${crashes.filter((r) => ['terrain', 'badLanding'].includes(r.crash.cause)).length}`);
  if (postT.length) {
    P();
    P(table(['seed', 'distM', 'landing', 'ms before', 'land angle', 'chunk', 'slope', 'speed', 'airborne at crash', 'body angle'], postT.slice(0, 40).map((r) => {
      const c = r.crash; const l = c.lastLanding;
      return [r.seed, f(c.distM), l.quality, l.msBefore, `${l.angleDeg}deg @${l.impactSpeedPxS}px/s`, c.chunkDefId, f(c.slopeDeg), c.speedPxS, `${c.airborneMs}ms`, `${f(c.angleDeg, 0)}deg`];
    })));
    if (postT.length > 40) P(`(${postT.length - 40} more in the JSON)`);
  }
  P();
}

function airSection(results) {
  P('## 2. Airtime at generated jumps (gen-jump chunks) vs launch speed');
  P();
  P(`Pooled over ${results.map((r) => r.name).join(' + ')} runs (${results.reduce((a, r) => a + r.res.results.length, 0)} runs). Air phases > 120 ms only; "own hop" phases that happen to start at a lip are still counted by lip.`);
  P();
  const all = results.flatMap((r) => r.res.results.flatMap((x) => x.airPhases.map((a) => ({ ...a, seed: x.seed, policy: x.policy }))));
  const gen = all.filter((a) => a.where === 'genJump');
  const row = (label, arr) => [label, arr.length, f(q(arr.map((a) => a.airMs), 0)), f(q(arr.map((a) => a.airMs), 0.25), 0), f(q(arr.map((a) => a.airMs), 0.5), 0), f(q(arr.map((a) => a.airMs), 0.75), 0), f(q(arr.map((a) => a.airMs), 1)), pct(arr.filter((a) => a.airMs < 400).length, arr.length), f(q(arr.map((a) => a.launchSpeed), 0.5), 0), f(q(arr.map((a) => a.predAirS * 1000), 0.5), 0)];
  const head = ['group', 'n', 'min ms', 'p25', 'median', 'p75', 'max', 'share < 400 ms', 'median launch px/s', 'median predicted ms (chunk.launches airS)'];
  P(table(head, [
    row('gen-jump chunk 0', gen.filter((a) => a.chunk === 0)),
    row('gen-jump later chunks', gen.filter((a) => a.chunk > 0)),
    row('gen-jump all', gen),
    row('template lips', all.filter((a) => a.where === 'templateLip')),
    row('bounce pads', all.filter((a) => a.where === 'bounce')),
    row('other (bumps, drops, own hops)', all.filter((a) => a.where === 'other')),
  ]));
  P();
  P('Airtime by launch speed (gen-jump only):');
  P();
  const sb = [[0, 250], [250, 350], [350, 450], [450, 600], [600, 800], [800, 1e9]];
  P(table(['launch px/s', 'chunk 0 n', 'chunk 0 median ms', 'chunk 0 <400ms', 'later n', 'later median ms', 'later <400ms'], sb.map(([a, b]) => {
    const c0 = gen.filter((x) => x.chunk === 0 && x.launchSpeed >= a && x.launchSpeed < b);
    const cl = gen.filter((x) => x.chunk > 0 && x.launchSpeed >= a && x.launchSpeed < b);
    return [`${a}-${b > 1e8 ? '+' : b}`, c0.length, f(q(c0.map((x) => x.airMs), 0.5), 0), pct(c0.filter((x) => x.airMs < 400).length, c0.length), cl.length, f(q(cl.map((x) => x.airMs), 0.5), 0), pct(cl.filter((x) => x.airMs < 400).length, cl.length)];
  })));
  P();
  // jumps by distance band
  const db = [[0, 150], [150, 500], [500, 1000], [1000, 2000], [2000, 1e9]];
  P('Airtime by distance (gen-jump only):');
  P();
  P(table(['start m', 'n', 'median ms', 'median launch px/s', 'share < 400 ms'], db.map(([a, b]) => {
    const x = gen.filter((g) => g.startM >= a && g.startM < b);
    return [`${a}-${b > 1e8 ? '+' : b}`, x.length, f(q(x.map((g) => g.airMs), 0.5), 0), f(q(x.map((g) => g.launchSpeed), 0.5), 0), pct(x.filter((g) => g.airMs < 400).length, x.length)];
  })));
  P();
}

function flipSection() {
  P('## 3. Flip policy: crash rate vs releaseLateMs');
  P();
  const lates = [0, 100, 200, 300, 400];
  const rows = [];
  for (const L of lates) {
    const res = load(`flip-late${L}.json`);
    if (!res) continue;
    const R = res.results;
    const att = [];
    for (const r of R) {
      const ct = r.crash ? r.crash.tSec : null;
      for (const a of r.airPhases) {
        if (!a.flip || !a.flip.hold) continue;
        const bad = a.landing === 'crash' || (a.endedByCrash && a.landing == null) || (ct != null && a.tEndSec <= ct && ct - a.tEndSec <= 1.5 && r.crash.cause !== 'hazard');
        att.push({ ...a, bad, seed: r.seed });
      }
    }
    const lq = count(att, (a) => a.landing || 'none');
    const clean = att.filter((a) => a.landing === 'perfect' || a.landing === 'good').length;
    rows.push([L, R.length, att.length, att.filter((a) => a.bad).length, pct(att.filter((a) => a.bad).length, att.length), pct(clean, att.length), fmtCount(lq), f(q(att.map((a) => a.rotDeg), 0.5), 0), f(q(R.map((r) => r.distM), 0.5)), f(q(R.map((r) => r.distM), 0.75))]);
  }
  P('An "attempt" = an air phase in which the policy judged a flip feasible and held back-tilt (the policy also hops over ground hazards). "Bad" = landing graded crash, or the run crashed (terrain / badLanding / chasm, not a hazard hit) within 1.5 s after the landing. "Clean" = perfect or good landing.');
  P();
  P(table(['releaseLateMs', 'runs', 'attempts', 'bad', 'bad rate', 'clean rate', 'landing grades', 'median rot deg', 'median run dist m', 'p75 run dist m'], rows));
  P();
}

function hopSection(hop, terrain) {
  P('## 4. Hop policy and hazard density');
  P();
  if (hop) {
    crashSection('hop', hop);
    const R = hop.results;
    const reach = [500, 1000, 1500, 2000, 3000];
    P(`- runs reaching: ${reach.map((m) => `${m} m: ${R.filter((r) => r.distM >= m).length}/${R.length}`).join(', ')}`);
    P(`- median distance ${f(q(R.map((r) => r.distM), 0.5))} m, p75 ${f(q(R.map((r) => r.distM), 0.75))} m, max ${f(q(R.map((r) => r.distM), 1))} m`);
    P();
  }
  const bandRows = (results, label) => {
    const out2 = [];
    const nb = 8;
    for (let b = 0; b < nb; b++) {
      const vals = results.filter((r) => r.generatedToM >= (b + 1) * 500 && r.bands[b]).map((r) => r.bands[b]);
      if (!vals.length) { out2.push([`${b * 500}-${(b + 1) * 500}`, 0, '-', '-', '-', '-', '-', '-']); continue; }
      const avg = (k) => vals.reduce((a, v) => a + (v[k] || 0), 0) / vals.length;
      out2.push([`${b * 500}-${(b + 1) * 500}`, vals.length, f(avg('crash'), 2), f(avg('groundCrash'), 2), f(avg('airCrash'), 2), f(avg('total'), 2), f(avg('genJumps'), 2), f(avg('templateLips'), 2)]);
    }
    return { label, rows: out2 };
  };
  const bh = ['band (m)', 'tracks', 'crash-type hazards', 'ground crash', 'air crash (rogue packet)', 'all hazards', 'gen jumps', 'template lips'];
  if (terrain) {
    const tb = bandRows(terrain.results, 'terrain-only');
    P(`### Hazards per 500 m band, terrain-only generation, ${terrain.results.length} seeds to 4000 m (mean per band per track)`);
    P();
    P(table(bh, tb.rows));
    P();
    P('Per-hazard type (mean per band):');
    P();
    const defs = [...new Set(terrain.results.flatMap((r) => Object.values(r.bands).flatMap((b) => Object.keys(b.byDef))))].sort();
    P(table(['band (m)', ...defs], Array.from({ length: 8 }, (_, b) => [`${b * 500}-${(b + 1) * 500}`, ...defs.map((d) => f(terrain.results.reduce((a, r) => a + ((r.bands[b] && r.bands[b].byDef[d]) || 0), 0) / terrain.results.length, 2))])));
    P();
  }
  if (hop) {
    const tb = bandRows(hop.results.filter((r) => r.generatedToM > 0), 'hop runs');
    P(`### Hazards per 500 m band actually generated during the hop runs (only runs that generated the full band; ${hop.results.length} seeds)`);
    P();
    P(table(bh, tb.rows));
    P();
  }
}

function stallSection(stall) {
  P('## 5. stallProbe');
  P();
  if (!stall) return;
  const R = stall.results;
  const pr = R.map((r) => r.probe);
  P(`${R.length} seeds (the first ~50 m are the same fixed start slope for every seed, so the probe is nearly identical per seed).`);
  P();
  P(table(['seed', 'phase', 'stopped at (s)', 'slope at stop', 'dist at stop (m)', 'speed<40 from (s)', 'nudge fired (s)', 'release->nudge (s)', 'nudge->speed>120 (s)', 'release->speed>120 (s)'], R.map((r) => {
    const p2 = r.probe;
    const s = (t) => (t == null ? '-' : f(t / 1000, 2));
    const d = (a, b) => (a == null || b == null ? '-' : f((b - a) / 1000, 2));
    return [r.seed, p2.phase, s(p2.tStop), p2.slopeAtStop, p2.x, s(p2.tSlow), s(p2.tNudge), d(p2.tStop, p2.tNudge), d(p2.tNudge, p2.tRecover), d(p2.tStop, p2.tRecover)];
  }).slice(0, 6)));
  P();
  P(`- nudge fired: ${pr.filter((p2) => p2.tNudge != null).length}/${pr.length}; reached >120 px/s: ${pr.filter((p2) => p2.tRecover != null).length}/${pr.length}`);
  P(`- nudge activations recorded during the probe (first run): ${JSON.stringify(R[0].nudges)}`);
  P();
}

function speedZoomSection(hands, hop) {
  P('## 6. Zoom and speed');
  P();
  const rows = [];
  for (const [n, res] of [['handsOff', hands], ['hop', hop]]) {
    if (!res) continue;
    const R = res.results;
    rows.push([n, R.length, f(q(R.map((r) => r.maxSpeed), 0.5), 0), f(q(R.map((r) => r.maxSpeed), 1), 0), f(q(R.map((r) => r.minZoom), 0), 2), f(q(R.map((r) => r.minZoom), 0.5), 2), f(q(R.map((r) => r.zoomAtMaxSpeed), 0.5), 2)]);
  }
  P(table(['policy', 'runs', 'median max speed px/s', 'max speed px/s', 'min zoom (any run)', 'median of per-run min zoom', 'median zoom at max speed'], rows));
  P();
}

function hintSection(hands) {
  if (!hands) return;
  P('## 7. Tutorial hints (hands-off runs, localStorage cleared = first run)');
  P();
  const hs = hands.results.flatMap((r) => r.hints.filter((h) => h.show).map((h) => ({ ...h, seed: r.seed })));
  const ids = [...new Set(hs.map((h) => h.id))];
  P(table(['hint', 'runs showing it', 'median first show (s)', 'median first show (m)'], ids.map((id) => {
    const per = hands.results.map((r) => r.hints.find((h) => h.id === id && h.show)).filter(Boolean);
    return [id, `${per.length}/${hands.results.length}`, f(q(per.map((h) => h.tSec), 0.5)), f(q(per.map((h) => h.distM), 0.5))];
  })));
  P();
}

const hands = load('handsOff.json');
const hop = load('hop.json');
const stall = load('stall.json');
const terrain = load('terrain.json');
P('# Baseline measurements (deterministic sim harness)');
P();
P(`Generated by tools/sim/report.mjs from the JSON files next to this report. Fixed 60 Hz steps, seeds sim-01.., daily rule neutralised, first-run tutorial state.`);
P();
P('## 1. Hands-off');
P();
if (hands) crashSection('handsOff', hands);
airSection([hands && { name: 'handsOff', res: hands }, hop && { name: 'hop', res: hop }].filter(Boolean));
flipSection();
hopSection(hop, terrain);
stallSection(stall);
speedZoomSection(hands, hop);
hintSection(hands);
console.log(out.join('\n'));
