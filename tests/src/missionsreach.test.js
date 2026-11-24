/**
 * Pins the MEASURED reachability evidence for mission targets.
 *
 * tools/sim/mission-reachability.mjs plays the real game (headless Chromium, two bot policies) under
 * every DailyPatch rule and writes tools/sim/.reach/reachability.json. This test reads that file and
 * asserts each single-run template's target is at or below what was actually achieved somewhere.
 *
 * Why a pinned file instead of running the browser sweep inside jest: the sweep needs Chromium and a
 * vite server (~4 min). The risk of a stale snapshot is handled by checking the run's own metadata —
 * seed count, rule coverage and policy list — so a template added or retuned without a fresh sweep
 * fails here rather than passing against last week's numbers.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import missionsData from '../../src/data/missions/missions.json';
import { DailyPatch } from '../../src/systems/DailyPatch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const EVIDENCE = path.join(root, 'tools/sim/.reach/reachability.json');
const METRICS = ['distanceM', 'score', 'shards', 'nearMisses', 'maxAirtimeMs', 'tricks'];

const evidence = existsSync(EVIDENCE) ? JSON.parse(readFileSync(EVIDENCE, 'utf8')) : null;
const targets = missionsData.templates.filter(
  (t) => t && t.type === 'singleRun' && METRICS.includes(t.metric) && t.target > 0,
);

describe('measured mission reachability (tools/sim evidence)', () => {
  test('the measured evidence file exists', () => {
    expect(evidence).not.toBeNull();
  });

  test('the sweep covered every daily rule plus the neutral case', () => {
    if (!evidence) return;
    const expected = ['none', ...DailyPatch.RULES.map((r) => r.id)].sort();
    expect(Object.keys(evidence.perRule).sort()).toEqual(expected);
  });

  test('the sweep used both bot policies and at least 10 seeds per rule', () => {
    if (!evidence) return;
    expect(evidence.policies).toEqual(expect.arrayContaining(['hop', 'flip']));
    for (const [rule, row] of Object.entries(evidence.perRule)) {
      expect({ rule, runs: row.runs >= 10 }).toMatchObject({ runs: true });
    }
  });

  test('the sweep found no unreachable single-run target', () => {
    if (!evidence) return;
    expect(evidence.failures).toEqual([]);
  });

  test('every single-run target is at or below a MEASURED maximum under every rule', () => {
    if (!evidence) return;
    for (const t of targets) {
      for (const [rule, row] of Object.entries(evidence.perRule)) {
        const seen = row[t.metric] || 0;
        expect({ id: t.id, rule, target: t.target, seen, ok: t.target <= seen }).toMatchObject({
          ok: true,
        });
      }
    }
  });
});
