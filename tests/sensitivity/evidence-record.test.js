/** Source-stamped 2026-11-23 12-seed first-slice evidence integrity. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate } from '../../tools/sensitivity/lib/aggregate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const record = JSON.parse(readFileSync(path.join(root, 'tools/sensitivity/results/hopPress-12seeds.json')));

describe('#130 committed real browser evidence, separate from current future simulator', () => {
  test('exact executable source commit, clean source, build/ruleset/SIM version, and honest scope', () => {
    expect(record.kind).toBe('bsb-issue-130-input-timing-sensitivity-preflight');
    expect(record.developerOnly).toBe(true);
    expect(record.build).toMatchObject({
      sourceSha: '66d8b0a67f0f6caa21a64ee3d1a7bfbb5e8a276b',
      sourceTreeClean: true,
      simRevision: 6,
      simTickHz: 120,
      dailyRuleId: 'featherweight',
      rulesetId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      buildId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(record.args).toMatchObject({
      seeds: 12, field: 'hopPress', offsets: [-2, -1, 0, 1, 2], maxM: 5000, maxSec: 180,
    });
    expect(record.failures).toEqual([]);
  });

  test('all 12 planned seeds have exact five matched arms, no duplicated or missing controls', () => {
    const seeds = record.args.seedList;
    expect(seeds).toHaveLength(12);
    expect(new Set(seeds).size).toBe(12);
    expect(record.captures).toHaveLength(12);
    expect(new Set(record.captures.map((r) => r.seed))).toEqual(new Set(seeds));
    expect(record.rows).toHaveLength(60);
    for (const seed of seeds) {
      const rows = record.rows.filter((r) => r.seed === seed);
      expect(rows).toHaveLength(5);
      expect(rows.map((r) => r.offset).sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
      expect(rows.every((r) => r.field === 'hopPress' && r.outcome !== 'excluded')).toBe(true);
      expect(rows.find((r) => r.offset === 0).divergedAtTick).toBeNull();
    }
  });

  test('all saved aggregates recompute exactly from raw observed rows', () => {
    expect(record.aggregate).toEqual(aggregate(record.rows));
    expect(record.aggregate).toMatchObject({
      observations: 60, measured: 60, excluded: 0,
      censoring: { censored: 1, stalled: 0 },
    });
  });
});
