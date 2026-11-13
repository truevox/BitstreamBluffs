/**
 * W4 — `MODDED_RUNS_RANKED` is the single decision point for whether a boosted run ranks.
 *
 * Spec W4: "Every ranking decision goes through ONE helper that reads the constant. Grep must show no
 * other place deciding whether a modded run counts." The W4 brief calls this out as the gate most
 * likely to be faked by scattering `if (!rec.modded)` across five call sites, so the last test here
 * reads the source tree and fails if a second decision appears anywhere.
 *
 * While the constant is false a boosted run must be invisible to every clean ranking surface — top-10,
 * seed best, daily best and streak — while STILL paying Resonance, shards and mission progress. Getting
 * the exclusion right and then also suppressing the payout would be the wrong half of the feature.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ranksModded, isRankable } from '../../src/systems/Ranking.js';

const get = (v) => v;

describe('ranksModded / isRankable', () => {
  test('a clean run always ranks', () => {
    expect(isRankable({ modded: false })).toBe(true);
    expect(isRankable({})).toBe(true);
    expect(isRankable(null)).toBe(false);
  });

  test('a modded run ranks only when the constant says so', () => {
    expect(isRankable({ modded: true })).toBe(false);
    // Flip the constant: same record, now it counts.
    expect(isRankable({ modded: true }, { ranked: true })).toBe(true);
  });

  test('the constant is false as shipped', async () => {
    // The spec ships MODDED_RUNS_RANKED = false; if someone flips it in constants.js every exclusion
    // below becomes vacuous, so pin the shipped value.
    const { MODDED_RUNS_RANKED } = await import('../../src/constants.js');
    expect(MODDED_RUNS_RANKED).toBe(false);
    expect(ranksModded()).toBe(MODDED_RUNS_RANKED);
  });
});

describe('the single-helper rule', () => {
  test('only Ranking.js reads MODDED_RUNS_RANKED', () => {
    const root = path.resolve(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.js')) continue;
        const rel = path.relative(root, p);
        if (rel === path.join('systems', 'Ranking.js')) continue;
        if (rel === 'constants.js') continue; // where the constant is declared
        const src = fs.readFileSync(p, 'utf8');
        // Reading the constant anywhere but Ranking.js means a second decision point.
        if (/MODDED_RUNS_RANKED/.test(src)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  test('no ranking surface DECIDES on `modded` inline', () => {
    // The catch this test exists for: `if (!rec.modded) board.push(rec)` instead of filtering through
    // isRankable(). That passes every behavioural test and is still the scattered implementation the spec
    // forbids. Reading and writing the FIELD is fine (sanitizeRun whitelists it, the loadout sets it);
    // what must not appear elsewhere is a use of it in a condition or comparison.
    const root = path.resolve(process.cwd(), 'src');
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.js')) continue;
        const rel = path.relative(root, p);
        if (rel === path.join('systems', 'Ranking.js')) continue;
        if (rel === 'constants.js') continue;
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        for (const line of lines) {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue; // prose is not a decision
          if (!/\.modded\b/.test(t)) continue;
          // Assignment or whitelisting is not a decision: `r.modded = true`, `modded: true`, `raw.modded === true`
          // inside sanitizeRun's copy is storage. A conditional/comparison use is a decision.
          const isWrite = /^\.?[\w.[\]]*\.modded\s*=[^=]/.test(t) || /^modded:/.test(t) || /\bif \(raw\.modded === true\)/.test(t);
          if (isWrite) continue;
          offenders.push(`${rel}: ${t}`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
