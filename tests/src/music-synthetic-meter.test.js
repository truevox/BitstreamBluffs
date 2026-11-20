import {AudioSynth} from '../../src/systems/AudioSynth.js';
import {
  syntheticMeterAt,SYNTHETIC_BEAT_SECONDS,
  SYNTHETIC_BEATS_PER_MEASURE,SYNTHETIC_METER_KIND,
} from '../../src/systems/music/SyntheticMeterTiming.js';
import {planFatalCountIn,FATAL_SYNTHETIC_BEAT_SECONDS} from '../../src/systems/music/FatalCrashCountIn.js';

const rate=48000;
const pack={id:'local-one-more-run-bitstream-bluffs',sampleRate:rate,
  frameCount:rate*12,duration:12};
function harness(){
  const ctx={state:'running',currentTime:11.14};
  const director={started:true,track:{id:pack.id},pack,ctx,
    clockStart:10,_token:9,activeNodes:new Set([{}]),
    transportPaused:false,_loading:null,songEnabled:{[pack.id]:true}};
  const a=Object.create(AudioSynth.prototype);
  Object.assign(a,{ctx,_stemMusic:director,_musicWanted:true,
    _musicMode:'run',_destroyed:false,unavailable:false,_paused:false,
    settings:{masterVolume:1,musicVolume:.7,musicEnabledSongs:{[pack.id]:true}},
    _fatalCountIn:null});
  return {a,ctx,director};
}

describe('separately typed cosmetic synthetic 4/4 beat/measure source clock',()=>{
  test('shares the existing fatal 0.5-second constant, never a trusted beat',()=>{
    expect(SYNTHETIC_BEAT_SECONDS).toBe(.5);
    expect(SYNTHETIC_BEATS_PER_MEASURE).toBe(4);
    expect(FATAL_SYNTHETIC_BEAT_SECONDS).toBe(SYNTHETIC_BEAT_SECONDS);
    expect(SYNTHETIC_METER_KIND).toBe('synthetic-unverified');
    const first=syntheticMeterAt(0);
    expect(first).toMatchObject({trusted:false,
      timingKind:'synthetic-unverified',use:'cosmetic-only',
      canAuthorizeGameplay:false,assumedMeter:'4/4-synthetic',
      beatInMeasure:1,beatIndex:0,measureIndex:0,
      beatStartSeconds:0,measureStartSeconds:0,
      nextBeatSeconds:.5,nextMeasureStartSeconds:2,
      isMeasureStartBeat:true,atMeasureStart:true});
    expect(Object.isFrozen(first)).toBe(true);
  });
  test('beat count increments every .5; downbeat every 2.0 seconds',()=>{
    for(let i=0;i<20;i++){
      const at=i*.5+.02;
      const x=syntheticMeterAt(at);
      expect(x.beatIndex).toBe(i);
      expect(x.beatInMeasure).toBe(i%4+1);
      expect(x.measureIndex).toBe(Math.floor(i/4));
      expect(x.measureStartSeconds).toBe(Math.floor(i/4)*2);
      expect(x.isMeasureStartBeat).toBe(i%4===0);
      expect(x.atMeasureStart).toBe(i%4===0);
      expect(x.beatStartSeconds).toBeCloseTo(i*.5,8);
    }
    expect(syntheticMeterAt(1.99999).beatInMeasure).toBe(4);
    expect(syntheticMeterAt(2).beatInMeasure).toBe(1);
    expect(syntheticMeterAt(2.1).atMeasureStart).toBe(false);
    expect(syntheticMeterAt(3.999999).measureIndex).toBe(1);
    expect(syntheticMeterAt(4).measureIndex).toBe(2);
  });
  test('no confident grid, no extrapolation beyond source end, input validated',()=>{
    for(const bad of [-1,NaN,Infinity,-Infinity,'2',null]){
      expect(syntheticMeterAt(bad)).toBeNull();
    }
    expect(syntheticMeterAt(12,{durationSeconds:12})).toBeNull();
    expect(syntheticMeterAt(11.9,{durationSeconds:12}).beatIndex).toBe(23);
    for(const o of [
      {beatSeconds:0},{beatSeconds:Infinity},{beatSeconds:.1},
      {beatsPerMeasure:1},{beatsPerMeasure:2.5},
      {durationSeconds:0},{durationSeconds:-1},
    ])expect(syntheticMeterAt(1,o)).toBeNull();
  });
  test('source transport clock, not wall timer, drives changing bar numbers',()=>{
    const {a,ctx,director}=harness();
    let s=a.getSyntheticMeterTiming();
    expect(s).toMatchObject({trusted:false,
      use:'cosmetic-only',canAuthorizeGameplay:false,
      beatIndex:2,beatInMeasure:3,measureIndex:0,
      measureStartAudioTime:10,nextMeasureStartAudioTime:12,
      trackId:pack.id,transportRevision:`9:${pack.id}:10`});
    expect(Object.isFrozen(s)).toBe(true);
    ctx.currentTime=12.01;
    s=a.getSyntheticMeterTiming();
    expect(s).toMatchObject({beatInMeasure:1,measureIndex:1,
      isMeasureStartBeat:true,measureStartAudioTime:12,
      nextMeasureStartAudioTime:14});
    director._token++;
    expect(a.getSyntheticMeterTiming().transportRevision).toBe(`10:${pack.id}:10`);
    director.clockStart=11;
    expect(a.getSyntheticMeterTiming().measureStartAudioTime).toBe(11);
  });
  test('does not authorize Gym or make source BEAT_GRID_CATALOG verified',()=>{
    const h=harness();
    const synthetic=h.a.getSyntheticMeterTiming();
    expect(synthetic.trusted).toBe(false);
    expect(synthetic.canAuthorizeGameplay).toBe(false);
    const gym=h.a.getBeatTiming();
    expect(gym.trusted).toBe(false);
    expect(gym.release).toBe('immediate');
  });
  test('all audio/mute/pause/fatal/loading/menu/seek failures fail closed',()=>{
    const scenarios=[
      h=>h.a._paused=true,h=>h.a._destroyed=true,
      h=>h.a.unavailable=true,h=>h.a._musicMode='menu',
      h=>h.a._musicWanted=false,h=>h.a.settings.masterVolume=0,
      h=>h.a.settings.musicVolume=0,
      h=>h.a.settings.musicEnabledSongs={[pack.id]:false},
      h=>h.director.songEnabled[pack.id]=false,
      h=>h.director.started=false,h=>h.director.transportPaused=true,
      h=>h.director._loading=Promise.resolve(),
      h=>h.director.clockStart=null,
      h=>h.director.activeNodes.clear(),
      h=>h.director.track=null,h=>h.director.pack=null,
      h=>h.ctx.state='suspended',h=>h.ctx.currentTime=NaN,
      h=>h.ctx.currentTime=10-1,h=>h.ctx.currentTime=23,
      h=>h.a._vinylPauseSession={},h=>h.a._vinylResume={},
      h=>h.a._fatalCountIn={snapshot:()=>({active:true})},
    ];
    for(const [i,mutate] of scenarios.entries()){const h=harness();mutate(h);
      const actual=h.a.getSyntheticMeterTiming();
      if(actual!==null)throw new Error('Fail-open scenario index '+i);
      expect(actual).toBeNull();}
    expect(Object.create(AudioSynth.prototype).getSyntheticMeterTiming()).toBeNull();
  });
  test('fatal crash four counted drums explicitly label an artificial measure',()=>{
    const p=planFatalCountIn(11);
    expect(p.beatOnsets).toEqual([12.205,12.705,13.205,13.705]);
    expect(p.beatInMeasure).toEqual([1,2,3,4]);
    expect(p.measureStartOnsets).toEqual([p.drumsStart]);
    expect(p.beatsPerMeasure).toBe(4);
    expect(p.measureSeconds).toBe(2);
    expect(p.syntheticMeterOrigin).toBe('count-in-first-drum');
    expect(p.verified).toBe(false);
    expect(Object.isFrozen(p.beatInMeasure)).toBe(true);
    expect(Object.isFrozen(p.measureStartOnsets)).toBe(true);
  });
  test('375ms experimental fatal tempo still labels first beat correctly',()=>{
    const p=planFatalCountIn(0,{beatSeconds:.375,silentBeats:3});
    expect(p.measureSeconds).toBe(1.5);
    expect(p.measureStartOnsets).toHaveLength(1);
    expect(p.beatOnsets[1]-p.beatOnsets[0]).toBeCloseTo(.375);
    expect(p.timingKind).toBe('synthetic-unverified');
  });
});
