#!/usr/bin/env node
/** Issue #119 (experimental): render browser-experiment result JSON files as a Markdown table. */
import { readFileSync } from 'node:fs';

const rows = [];
for (const f of process.argv.slice(2)) rows.push(...JSON.parse(readFileSync(f, 'utf8')));
const fmt = (x) => (x === null || x === undefined ? 'exact' : x);
console.log('| Fixture | Level | Left out | First divergent tick (after K) | First sled divergence | Max sled pos err (px) | Subsystems differing at the first divergent tick |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  if (r.harnessError || r.restoreError) {
    console.log(`| ${r.fixture} | ${r.level} | ${r.skip} | error | | | ${(r.harnessError || r.restoreError).slice(0, 120)} |`);
    continue;
  }
  const first = r.firstDivergentTick == null ? `**exact** (${r.ticksCompared} ticks)` : `${r.firstDivergentTick} (+${r.ticksAfterRestore})`;
  const sled = r.firstSledDivergentTick == null ? 'exact' : `${r.firstSledDivergentTick}`;
  const subs = (r.subsystemsAtFirst || []).join(', ');
  console.log(`| ${r.fixture} | ${r.level} | ${r.skip} | ${first} | ${sled} | ${fmt(r.firstSledDivergentTick == null ? null : r.maxSledPosErrPx)} | ${subs.length > 160 ? `${subs.slice(0, 160)}…` : subs} |`);
}
