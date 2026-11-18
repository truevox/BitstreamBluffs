import { scenario } from '../../tools/sim/bsod-escape-envelope.mjs';
import { BSOD_DEFAULTS, compressedTailwind } from '../../src/systems/BsodPursuit.js';
import { PHYSICS } from '../../src/constants.js';
import { upgradeEffects } from '../../src/systems/PermanentUpgrades.js';

const lateRanks=(rank)=>Object.fromEntries(
  ['hop','speed','canopy','airbrake','bsodGrace'].map(id=>[id,rank]),
);

describe('BSOD near-miss physical envelope (optimistic model, not a gameplay-completion claim)',()=>{
  test('old requirement was inaccessible; revised first-pass pressure wave permits an early skilled save',()=>{
    const low=scenario({wallSpeed:300,closing:30});
    expect(low.scored).toBe(1);
    expect(low.minGap).toBeLessThan(280);
    expect(low.finalGap).toBeGreaterThan(500);
    expect(low.flightMs).toBeLessThan(2000);
  });
  test('survival does not automatically scale to the wall: high speed needs upgraded flight or timing',()=>{
    const noUpgrade=scenario({wallSpeed:900,closing:30});
    const upgraded=scenario({wallSpeed:900,closing:30,ranks:lateRanks(10)});
    expect(noUpgrade.scored).toBe(1);
    expect(upgraded.scored).toBe(1);
    expect(upgraded.finalGap).toBeGreaterThan(noUpgrade.finalGap);
    expect(upgraded.flightMs).toBeGreaterThan(noUpgrade.flightMs);
  });
  test('well-timed airbrake earns the skill bonus while spending forward momentum',()=>{
    const plain=scenario({wallSpeed:600,closing:30});
    const braked=scenario({wallSpeed:600,closing:30,brakeBeforeMs:160});
    expect(plain.scored).toBe(1);
    expect(braked.scored).toBe(1);
    expect(braked.points).toBe(190);
    expect(braked.points-plain.points).toBe(40);
    expect(braked.flightMs).toBeGreaterThan(plain.flightMs);
    expect(braked.minGap).toBeLessThan(plain.minGap); // deliberate brake allows closer danger
  });
  test('the wall stays dangerous beyond any reasonable rider speed',()=>{
    const late=scenario({wallSpeed:3000,closing:1800,ranks:lateRanks(30)});
    expect(late.scored).toBe(0);
    expect(late.minGap).toBeLessThanOrEqual(0);
    expect(late.flightMs).toBeLessThan(500);
    expect(upgradeEffects({bsodGrace:1000000}).bsodAccelerationMul).toBeGreaterThan(.75);
  });
  test('compressed tailwind is always faster than moving wall; no arbitrary velocity matching cheat',()=>{
    for(const wall of [50,500,1000,10000]){
      for(const gap of [0,180,500,3400,100000]){
        expect(compressedTailwind(wall,gap)).toBeGreaterThan(wall);
      }
    }
    expect(compressedTailwind(600,220)-600).toBeGreaterThan(BSOD_DEFAULTS.compressionPxS/2);
    expect(PHYSICS.gravityPxS2).toBe(900);
  });
});
