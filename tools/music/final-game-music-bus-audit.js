/** Faithful original-stem MUSIC path, not a whole-game output claim:
 * real StemFXMixer, original preset, actual convolution room, musicFilter,
 * musicBus, master gain and compressor (-10dB/6:1).
 * Gameplay SFX/wind/static, final-device loudness and all-song
 * intersample true peak are outside this intentionally scoped audit.
 */
import {StemFXMixer} from '../../src/systems/music/MusicFXGraph.js';
import {orchestraPreset,melodyPreset} from '../../src/systems/music/DynamicOrchestraPresets.js';
import {BIOMES,load} from './cross-pack-original-stem-audit.js';
import {createOutputPeakGuard} from '../../src/systems/music/OutputPeakGuard.js';

const ROLES=['drums','bass','guitar','piano','other'];
const START=.75,DEFAULT_DURATION=2.5,RATE=48000;
const PRESETS=[
 {id:'default-instrumental',master:.8,music:.6,vocals:false},
 {id:'maximum-music-with-vocals',master:1,music:1,vocals:true}
];
function metrics(buffer,duration=DEFAULT_DURATION) {
 let sum=0,peak=0,over=0,near=0,nonfinite=0;
 const from=Math.floor(RATE*START),count=Math.floor(RATE*duration);
 for(let ch=0;ch<2;ch++){
  const array=buffer.getChannelData(ch);
  for(let i=from;i<from+count;i++){
   const value=array[i];
   if(!Number.isFinite(value)){nonfinite++;continue;}
   const amplitude=Math.abs(value);
   sum+=value*value;peak=Math.max(peak,amplitude);
   if(amplitude>1)over++;
   if(amplitude>=.98)near++;
  }
 }
 return {rms:Math.sqrt(sum/(2*count)),samplePeak:peak,
  overUnitySamples:over,nearUnitySamples:near,nonfiniteSamples:nonfinite};
}
async function render(song,biome,preset,clean=false,duration=DEFAULT_DURATION){
 const ctx=new OfflineAudioContext(2,Math.ceil((START+duration+.10)*RATE),RATE);
 const comp=ctx.createDynamicsCompressor();
 comp.threshold.value=-10;comp.ratio.value=6;
 const master=ctx.createGain();master.gain.value=preset.master;
 master.connect(comp);
 const guard=createOutputPeakGuard(ctx);
 comp.connect(guard);guard.connect(ctx.destination);
 const musicBus=ctx.createGain();musicBus.gain.value=preset.music*.55;
 musicBus.connect(master);
 const musicFilter=ctx.createBiquadFilter();musicFilter.type='lowpass';
 musicFilter.frequency.value=18000;musicFilter.connect(musicBus);
 const mixer=new StemFXMixer(ctx,musicFilter,{roomQuality:'standard'});
 mixer.space.selectBiome(clean?'bitstream-bluffs':biome,.01);
 if(clean)mixer.setRoomWetEnabled(false,.02);
 const voices=[...ROLES,'voice:'+biome,...(preset.vocals?['vocals']:[])];
 for(const role of voices){
  const original=song.decoded.get(role);
  if(!original)throw Error('Missing source '+song.pack+'/'+role);
  const stages=clean?[]:role.startsWith('voice:')?melodyPreset(biome):
   role==='vocals'?[]:orchestraPreset(biome,role);
  const level=role==='vocals'?1:role.startsWith('voice:')?
   (preset.vocals?.18:1):1;
  const input=mixer.addSource(role,{gain:level,effects:stages});
  if(clean)mixer.setRoomSend(role,0);
  const source=ctx.createBufferSource();
  source.buffer=original;source.connect(input);source.start(START);
  if(!clean){
   const main=mixer.sources.get(role)?.chain?.stages?.[0];
   const fields={
    snowpack:{depth:1},scrapheap:{contact:1},
    hydrostatic:{pressure:1},microbox:{openness:1},
    crystallattice:{openness:1},steamworks:{airborne:true},
    jellybloom:{airborne:true},ventforge:{strength:1},
    sugarfizz:{speed:1,airborne:true},
    orbitfield:{weightless:1,lowGravity:.5},
    sunstone:{loft:1},arcadeglue:{bridge:false,intensity:1.25}
   }[main?.id]||{};
   for(const [key,value] of Object.entries(fields))
    if(main.refs?.[key])main.set(key,value,0);
  }
 }
 const output=await ctx.startRendering();
 const stats=metrics(output,duration);
 mixer.destroy();
 return stats;
}
async function audit(packs,biomes=BIOMES,duration=DEFAULT_DURATION,maxVocalsOnly=false){
 if(!Number.isFinite(duration)||duration<=0||duration>12)throw Error("Invalid QA sample duration");
 const results=[];
 for(const pack of packs){
  const song=await load(pack);
  for(const biome of biomes){
   for(const preset of maxVocalsOnly?PRESETS.filter(p=>p.vocals):PRESETS){
    const stats=await render(song,biome,preset,false,duration);
    results.push({pack,trackId:song.id,biome,scenario:preset.id,...stats});
   }
  }
  if(!maxVocalsOnly){
   const stats=await render(song,'debutmont',PRESETS[0],true,duration);
   results.push({pack,trackId:song.id,biome:'debutmont',scenario:'clean-menu-original',...stats});
  }
 }
 return {format:'bbs-original-ogg-game-music-bus-v1',
  source:'Original OGG first segment, 2.5s, each original biome voice lead',
  sampleRate:RATE,sampleSeconds:duration,maxVocalsOnly,
  limitations:'Real StemFXMixer source, source FX, impulse room, music lowpass, default/master music volumes, compressor (-10dB/6:1) and post-compressor transparent output safety WaveShaper. Excludes gameplay SFX/wind/static, physical event transients, adaptive re-performances, full-song peak and inter-sample true peak.',
  scenarios:PRESETS,results};
}
/** Source-bound segment spread: beginning, middle and END of every installed song.
 * This supplements the opening-only 100-case audit; it does not falsely claim
 * full-song continuous playback, physical SFX/wind or certified true peak.
 */
async function auditSegmentSpread(packs,{duration=2.5,biomes=[
 'garbage-dump-glacier','vertigo-vents','crystal-cavern','bitstream-bluffs'] }={}){
 if(!Number.isFinite(duration)||duration<=0||duration>5)throw Error('Invalid duration');
 if(!Array.isArray(biomes)||biomes.some(b=>!BIOMES.includes(b)))throw Error('Invalid biomes');
 const results=[],segments=[];
 for(const pack of packs){
  const songZero=await load(pack,0,true);
  const indices=[...new Set([0,Math.floor((songZero.segmentCount-1)/2),songZero.segmentCount-1])];
  for(const index of indices){
   const song=index===0?songZero:await load(pack,index,true);
   if(song.frames/RATE<duration+.1)throw Error('Too short segment '+pack+'/'+index);
   segments.push({pack,trackId:song.id,segmentIndex:index,segmentCount:song.segmentCount,
    startFrame:song.startFrame,sourceFrames:song.frames,sourceSha256:song.sourceSha256});
   for(const biome of biomes){
    const stats=await render(song,biome,PRESETS[1],false,duration);
    results.push({pack,trackId:song.id,segmentIndex:index,biome,
     scenario:PRESETS[1].id,...stats});
   }
  }
 }
 return {format:'bbs-original-ogg-game-music-bus-segment-spread-v1',
  source:'Original OGG beginning/middle/end source segments; 2.5s each, max vocals',
  sampleRate:RATE,sampleSeconds:duration,segments,
  limitations:'Only three chosen segments per song and four risk-focused biomes. Real StemFXMixer, convolution, master/compressor and post-compressor guard are modeled. Excludes gameplay SFX, wind, static, physical event transients, full-song continuity and certified intersample true peak.',
  results};
}
window.__finalGameMusicBusQA=Object.freeze({audit,auditSegmentSpread});
