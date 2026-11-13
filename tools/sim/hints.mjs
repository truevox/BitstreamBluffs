#!/usr/bin/env node
/**
 * Tutorial-hint statistics from one or more `run.mjs --out` JSON files (first-run state, hints recorded from
 * EVT.TUTORIAL_HINT). Per hint id: runs showing it, median first show (s / m), median + min time on screen, hints
 * still up at the end of the run, shows longer than 5 s, and the number of runs where two hints were visible at once.
 *   node tools/sim/hints.mjs a.json [b.json ...]
 */
import { readFileSync } from 'node:fs';

const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '-');

for (const file of process.argv.slice(2)) {
  const { results } = JSON.parse(readFileSync(file, 'utf8'));
  const per = {};
  let overlapRuns = 0;
  const open = new Map();
  for (const r of results) {
    const up = new Map();
    let overlap = false;
    const first = new Set();
    for (const h of r.hints) {
      const P = (per[h.id] ||= { runs: 0, t0: [], d0: [], dur: [], tail: [], long: 0, shows: 0 });
      if (h.show) {
        if (!first.has(h.id)) { first.add(h.id); P.runs++; P.t0.push(h.tSec); P.d0.push(h.distM); }
        P.shows++;
        up.set(h.id, h.tSec);
        if (up.size > 1) overlap = true;
      } else if (up.has(h.id)) {
        const d = h.tSec - up.get(h.id);
        P.dur.push(d);
        if (d > 5) P.long++;
        up.delete(h.id);
      }
    }
    for (const [id, t] of up) per[id].tail.push(r.simSec - t);
    if (overlap) overlapRuns++;
  }
  console.log(`\n== ${file}  (${results.length} runs, ${overlapRuns} with two hints visible at once)`);
  console.log('hint   runs  firstT(s)  firstD(m)  dur med  dur min  dur max  open@end(n, min s)  >5s');
  for (const [id, P] of Object.entries(per)) {
    console.log(`${id.padEnd(6)} ${String(P.runs).padStart(4)}  ${f(med(P.t0)).padStart(9)}  ${f(med(P.d0), 0).padStart(9)}  ${f(med(P.dur)).padStart(7)}  ${f(Math.min(...P.dur)).padStart(7)}  ${f(Math.max(...P.dur)).padStart(7)}  ${String(P.tail.length).padStart(6)} ${f(Math.min(...P.tail)).padStart(8)}   ${P.long}`);
  }
}
