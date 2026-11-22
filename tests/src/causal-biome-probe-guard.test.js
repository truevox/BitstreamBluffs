import fs from 'node:fs';
import { witnessedBiomeTransition } from '../../tools/conformance/biome-entry-proof.mjs';

const valid = () => ({
  fixture:'biome', case:'baseline-repeat',
  meta:{ticks:1200,crashed:false,stalled:null,biomeEntryX:32950,biomeEntryTick:689,biomeEntryFromBridge:true},
  baselineBiomeEntryTick:689, baselineBiomeEntryFromBridge:true,
  diff:{verdict:'isolated',lengthMismatch:false,perSubsystem:{}}, errors:[],
});

describe('causal isolation #65: never pass a biome test without traversing a real arcade bridge', () => {
  test('success requires witnessed bridge->biome crossings in baseline AND comparison', () => {
    expect(witnessedBiomeTransition(valid())).toBe(true);
    for (const patch of [
      {meta:{...valid().meta,biomeEntryFromBridge:false}},
      {meta:{...valid().meta,biomeEntryTick:null}},
      {baselineBiomeEntryTick:null},
      {baselineBiomeEntryFromBridge:false},
    ]) {
      expect(witnessedBiomeTransition({...valid(),...patch})).toBe(false);
    }
  });
  test('the actual probe gate invokes the same verified pure predicate', () => {
    const source = fs.readFileSync('tools/conformance/causal-isolation-probe.mjs','utf8');
    expect(source).toContain("if (r.fixture === 'biome' && !witnessedBiomeTransition(r))");
    expect(source).toContain('previous === null && here != null');
    expect(source).toContain('baselineBiomeEntryTick: baseline?.meta?.biomeEntryTick ?? null');
  });
});
