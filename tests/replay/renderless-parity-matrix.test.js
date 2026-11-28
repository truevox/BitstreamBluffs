/** #122: real RunScene/Matter 0.20 browserless kernel, renderer enabled vs
 * suppressed. This compares production causal fingerprints/recorded tape,
 * NOT a second physics implementation or an emulated browser Worker.
 */
import { jest } from '@jest/globals';

const { installPhaserStub, createRun, makeContent } = await import('./headlessRun.js');
installPhaserStub(jest);
const { RunScene } = await import('../../src/scenes/RunScene.js');
const { REG, PIXELS_PER_METER } = await import('../../src/constants.js');
const { biomeForSector, SECTOR_M, BASE_SECTORS } = await import('../../src/systems/TerrainGenerator.js');
const { captureCausalState } = await import('../../src/systems/replay/fingerprintCapture.js');
const { fingerprintState, FP_SUBSYSTEMS } = await import('../../src/systems/replay/fingerprint.js');

const pads = {
 neutral: tick => ({ push: tick < 300, tilt: 0, variableHop: true, noAutoNudge: true,
  pressed: { hop: tick === 101 || tick === 301 } }),
 tricks: tick => ({ push: tick < 420, tilt: tick % 90 < 45 ? 1 : -1, heli: tick % 80 < 40 ? 1 : 0,
  airBrake: tick % 120 === 40, variableHop: true, noAutoNudge: true,
  pressed: { hop: tick % 135 === 1, airBrake: tick % 120 === 40 } }),
};
function mk({seed,biomeMask=0,level=1,policy='neutral',stubRender=false}) {
 const s=createRun(RunScene,REG,{seed,biomeMask,level,stubRender});
 s.inputRouter={poll:()=>pads[policy](s.simClock.tick+1),setEnabled(){}};
 return s;
}
const digest=s=>fingerprintState(captureCausalState(s,{chunkMemo:false}));
// Independent runs use wall-clock-generated run IDs; compare shared causal
// input seed and gameplay/recorder evidence, not incidental session IDs.
const witnessed=s=>({
 tick:s.simClock.tick,crashed:s.crashed,score:s.score.getTotal(),
 distance:s.score.distanceM,seed:s.seed,
 fingerprints:s.ghostRecorder?.fingerprints?.map(f=>({tick:f.tick,combined:f.combined})),
 recorderFailures:s.ghostRecorder?.fingerprintErrorCount,
});
function parity(options) {
 const shown=mk(options),hidden=mk({...options,stubRender:true});
 let checkpoints=0;
 for(let i=0;i<options.ticks;i++) {
  // A shield charge is causal. Its visual reflection must be harmless at
  // every display cadence; swap only at simulation tick boundaries.
  if (i===options.shieldAt) { shown.shieldCharges=2; hidden.shieldCharges=2; }
  if (i===options.shieldOffAt) { shown.shieldCharges=0; hidden.shieldCharges=0; }
  if (i===options.paletteAt) {
   shown.refreshPalette();hidden.refreshPalette();
  }
  const prior=shown.simClock.tick;
  shown.update(0,shown.simClock.tickMs);
  hidden.update(0,hidden.simClock.tickMs);
  expect(hidden.simClock.tick).toBe(shown.simClock.tick);
  if(shown.simClock.tick>prior&&shown.simClock.tick%120===0){
   const a=digest(shown),b=digest(hidden);
   if(a.combined!==b.combined){
    const changed=FP_SUBSYSTEMS.filter(k=>a.subsystems[k]!==b.subsystems[k]);
    throw Error('render-on/off causal divergence at tick '+shown.simClock.tick+' in '+changed.join(','));
   }
   checkpoints++;
  }
  expect(hidden.crashed).toBe(shown.crashed);
  if(shown.crashed)break;
 }
 expect(checkpoints).toBeGreaterThanOrEqual(options.minCheckpoints??2);
 expect(witnessed(hidden)).toEqual(witnessed(shown));
 return {shown,hidden,checkpoints};
}

describe('#122 browserless real Matter render-on/off causal matrix',()=>{
 test.each([
  ['base terrain, shield charge consumed',{seed:'HEADLESS-BASE',ticks:620,shieldAt:1,shieldOffAt:260,minCheckpoints:2}],
  ['all-biome mask, shield and palette repaint',{seed:'HEADLESS-ALL',biomeMask:0xffff,level:12,ticks:900,shieldAt:1,shieldOffAt:260,paletteAt:480,minCheckpoints:2}],
  ['nonzero biome with trick edges and palette repaint',{seed:'HEADLESS-TRICKS',biomeMask:3,level:6,policy:'tricks',ticks:840,paletteAt:240,minCheckpoints:2}],
 ])('%s',(_name,options)=>{parity(options);});
});

/** #122 individual-biome mask matrix, not just the old all-bits mask.
 *
 * A normal fresh run cannot reach 1km+ biomes in the first 720 ticks if it
 * crashes early. Keep honest evidence separate: (1) real RunScene/Matter
 * render-on/off parity for each admitted single-bit config, (2) real terrain
 * generator sector/colour assignment at a future selected biome sector.
 * Do NOT call this proof of live 300-second in-biome physics or worker parity.
 */
const biomeDefinitions=Object.values(makeContent().biomes).sort((a,b)=>a.bit-b.bit);
const independentBiomes=biomeDefinitions.filter(b=>b.bit>1);

describe('#122 every named non-home biome individually admitted into real terrain + render parity',()=>{
 test('content schema presents ten independent non-home single-bit biomes',()=>{
  expect(biomeDefinitions.map(b=>b.bit)).toEqual([1,2,4,8,16,32,64,128,256,512,1024]);
  expect(new Set(biomeDefinitions.map(b=>b.id)).size).toBe(11);
 });
 test.each(independentBiomes.map(b=>[b.id,b.bit]))('%s single-bit terrain and renderless parity', (biomeId,bit)=>{
  const seed=`HEADLESS-INDIVIDUAL-${biomeId}`;
  const {shown,hidden,checkpoints}=parity({seed,biomeMask:bit,level:12,
   ticks:700,shieldAt:1,shieldOffAt:320,paletteAt:300,
   minCheckpoints:2});
  expect(checkpoints).toBeGreaterThanOrEqual(2);
  expect(shown.biomeMask).toBe(bit);
  expect(hidden.biomeMask).toBe(bit);
  const defs=shown.terrain.biomeDefs;
  const sector=Array.from({length:96},(_,i)=>BASE_SECTORS+i)
   .find(i=>biomeForSector(seed,i,bit,defs)===biomeId);
  expect(sector).toBeDefined();
  // This is a REAL future chunk/biome palette lookup in the same production
  // generator class; it does NOT teleport the player into that sector.
  const x=(sector*SECTOR_M+250)*PIXELS_PER_METER;
  expect(shown.terrain.biomeAtX(x)).toBe(biomeId);
  expect(hidden.terrain.biomeAtX(x)).toBe(biomeId);
  expect(shown.terrain.getChunkAt(x)?.biome).toBe(biomeId);
  expect(hidden.terrain.getChunkAt(x)?.biome).toBe(biomeId);
  expect(witnessed(shown)).toEqual(witnessed(hidden));
 });
});
