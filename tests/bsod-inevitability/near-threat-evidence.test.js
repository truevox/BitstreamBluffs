/** Original exact code-source, 72-arm real Chromium counterfactual evidence audit. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = JSON.parse(readFileSync(path.join(ROOT, 'tools/bsod-inevitability/results/near-threat-gap500-six-seeds-20261123.json')));
const CODE_SHA = '98f979f583cb1d15a88d26aa8e320e475ca9815f';
const POLICIES = ['handsOff','flip','canopyHop','canopyFlip'];
const SEEDS = Array.from({length:6},(_,i)=>`sim-${String(i+1).padStart(2,'0')}`);
const COUNT_KEYS = ['bsodCatch','otherDeath','censored','stalled'];

describe('published counterfactual evidence is complete and source pinned', () => {
  test('code attribution and boundaries are explicit, not player-release claims', () => {
    expect(evidence.executableSourceSha).toBe(CODE_SHA);
    expect(evidence.developerOnly).toBe(true);
    expect(evidence.kind).toBe('bsb-128-near-threat-72arm-source-pinned-counterfactual');
    expect(evidence.limitations.join(' ')).toMatch(/not.*ideal wall pursuit speed/);
    expect(evidence.conditions).toHaveLength(3);
  });
  test('each speed comes from a clean exact-source browser run with matching seeds/policies', () => {
    const seenSpeed = [];
    for(const c of evidence.conditions){
      seenSpeed.push(c.speed);
      expect(c.source).toMatchObject({gitSha:CODE_SHA,workingTreeClean:true,simRevision:6,
        buildId:expect.stringMatching(/^sha256:[0-9a-f]{64}$/)});
      expect(c.config).toMatchObject({startGapPx:500,maxSec:60,maxM:100000,biomeMask:0,
        seedList:SEEDS,policies:POLICIES});
      expect(c.startSpeedPxS).toBe(c.speed==='default'?null:Number(c.speed));
      expect(c.receipt.summarySha256).toMatch(/^[0-9a-f]{64}$/);
      expect(c.receipt.reportSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(c.receipt.rawFiles).sort()).toEqual([...POLICIES].sort());
      expect(c.rows).toHaveLength(24);
      const keys = c.rows.map(r=>`${r.seed}|${r.policy}`);
      expect(new Set(keys).size).toBe(24);
      for(const seed of SEEDS)for(const policy of POLICIES)expect(keys).toContain(`${seed}|${policy}`);
    }
    expect(seenSpeed).toEqual(['default','500','1000']);
  });
  test('all counts recompose from raw compact seed rows without imputing censored as survival', () => {
    for(const c of evidence.conditions){
      for(const policy of POLICIES){
        const rows=c.rows.filter(r=>r.policy===policy);
        for(const key of COUNT_KEYS){
          expect(rows.filter(r=>r.classification===key).length).toBe(c.summary[policy].counts[key]);
        }
        for(const r of rows){
          expect(Number.isFinite(r.initialGapPx)).toBe(true);
          expect(Number.isFinite(r.minSampledGapPx)).toBe(true);
          expect(Number.isFinite(r.finalGapPx)).toBe(true);
          expect(r.wallCatch).toBe(r.classification==='bsodCatch');
          expect(r.censored).toBe(r.classification==='censored');
          if(r.classification==='bsodCatch'){
            expect(r.endReason).toBe('crash:bsod');expect(r.crashCause).toBe('bsod');
          }
        }
      }
    }
  });
  test('matched outcomes show a sharp speed-dependence but claim no ideal speed', () => {
    const catches = evidence.conditions.map(c=>c.rows.filter(r=>r.wallCatch).length);
    expect(catches).toEqual([0,13,24]);
    const half=evidence.conditions[1];
    expect(half.summary.canopyHop.counts.bsodCatch).toBe(6);
    expect(half.summary.canopyFlip.counts.bsodCatch).toBe(6);
    expect(half.summary.handsOff.counts.bsodCatch).toBe(0);
    expect(evidence.conditions[2].rows.every(r=>r.wallCatch && r.simSec<=1.07)).toBe(true);
    expect(evidence.limitations.join(' ')).toMatch(/early catches.*seeded courses.*not independent/);
  });
});
