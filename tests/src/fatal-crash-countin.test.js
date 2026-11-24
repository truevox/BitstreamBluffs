import {jest} from '@jest/globals';
import {EventEmitter} from 'events';
import {
  planFatalCountIn,findOriginalDrumAccent,FatalCrashCountIn,
  FATAL_SYNTHETIC_BEAT_SECONDS,FATAL_DRUM_BEATS,
} from '../../src/systems/music/FatalCrashCountIn.js';
import {AudioSynth} from '../../src/systems/AudioSynth.js';
import {EVT} from '../../src/events.js';
import {defaultSongSelection} from '../../src/systems/music/MusicPlaylist.js';

const param=()=>({value:1,setValueAtTime:jest.fn(),
  linearRampToValueAtTime:jest.fn(),cancelScheduledValues:jest.fn(),
  setTargetAtTime:jest.fn()});
function harness(){
  const sources=[];
  const c={currentTime:11,state:'running',createBufferSource:()=>{
    const src={connect:jest.fn(),stop:jest.fn(),start:jest.fn(),
      buffer:null};sources.push(src);return src;},
    createGain:()=>({gain:param(),connect:jest.fn(),disconnect:jest.fn()})};
  const mono=new Float32Array(48000);
  for(let i=15000;i<16800;i++)mono[i]=.7;
  const buffer={sampleRate:48000,length:mono.length,duration:1,numberOfChannels:1,
    getChannelData:()=>mono};
  const pack={id:'track-A',sampleRate:48000,segments:[
    {startFrame:0,frames:48000},{startFrame:48000,frames:48000}]};
  const cache=new Map([['0/drums',buffer]]);
  const mixer={countInInput:{},recoveryPlan:null,setRecoveryPlan:jest.fn(function(p){this.recoveryPlan=p;return true;}),
    cancelRecoveryPlan:jest.fn(function(){this.recoveryPlan=null;})};
  const scratch={play:jest.fn(()=>.205),cancel:jest.fn()};
  const d={ctx:c,pack,cache,track:{id:'track-A'},packBase:'/music/A',
    clockStart:1,_token:7,started:true,transportPaused:false,
    activeNodes:new Set([{}]),mixer,_loading:null,disposed:false,
    start:jest.fn(),stop:jest.fn(),seekTo:jest.fn()};
  const recovery=new FatalCrashCountIn(c,mixer,scratch);
  return {c,d,mixer,scratch,sources,buffer,pack,recovery};
}

describe('synthetic playback clock is never a verified source pulse',()=>{
  test('time layout is 205ms scratch, 2 silent pulses, 4 genuine drum slots, full band',()=>{
    const p=planFatalCountIn(11);
    expect(p.beatSeconds).toBe(.5);
    expect(p.silenceStart).toBeCloseTo(11.205);
    expect(p.drumsStart).toBeCloseTo(12.205);
    expect(p.beatOnsets).toHaveLength(4);
    expect(p.beatOnsets).toEqual([12.205,12.705,13.205,13.705]);
    expect(p.bandAt).toBeCloseTo(14.205);
    expect(p.verified).toBe(false);
    expect(p.timingKind).toBe('synthetic-unverified');
    expect(FATAL_SYNTHETIC_BEAT_SECONDS).toBe(.5);
    expect(FATAL_DRUM_BEATS).toBe(4);
  });
  test('1 to 3 silent pulses and synthetic tempo differences are testable, not approved grids',()=>{
    for(const silence of [1,2,3]){
      const p=planFatalCountIn(0,{silentBeats:silence,beatSeconds:.375});
      expect(p.silentBeats).toBe(silence);
      expect(p.beatOnsets[1]-p.beatOnsets[0]).toBeCloseTo(.375);
      expect(p.bandAt-p.drumsStart).toBeCloseTo(1.5);
      expect(p.verified).toBe(false);
    }
    expect(planFatalCountIn(3,{timingKind:'verified-source-grid'})).toBeNull();
    expect(planFatalCountIn(3,{beatSeconds:0})).toBeNull();
    expect(planFatalCountIn(3,{silentBeats:4})).toBeNull();
  });
});

describe('actual original decoded drum transient source and same continuous transport',()=>{
  test('find cue from original track pack cache, never create synthetic fake original OGG',()=>{
    const {d,buffer}=harness();
    const cue=findOriginalDrumAccent(d);
    expect(cue.buffer).toBe(buffer);
    expect(cue.source).toBe('original-decoded-ogg-drums');
    expect(cue.excerptSeconds).toBeCloseTo(.14);
    expect(cue.onsetScore).toBeGreaterThan(.015);
    d.cache.clear();
    expect(findOriginalDrumAccent(d)).toBeNull();
  });
  test('four 140ms one-shot drum accents only, not a second song/transport',()=>{
    const {c,d,mixer,scratch,sources,recovery}=harness();
    const result=recovery.start(d);
    expect(result).toMatchObject({active:true,stage:'vinyl-scratch',
      verified:false,trackId:'track-A',scheduledDrumAccents:4,
      clockBasis:'AudioContext.currentTime'});
    expect(scratch.play).toHaveBeenCalledTimes(1);
    expect(scratch.play).toHaveBeenCalledWith('pause');
    expect(mixer.setRecoveryPlan).toHaveBeenCalledTimes(1);
    expect(sources).toHaveLength(4);
    for(let i=0;i<4;i++){
      expect(sources[i].start).toHaveBeenCalledTimes(1);
      expect(sources[i].start.mock.calls[0][0]).toBeCloseTo(result.beatOnsets[i]);
      expect(sources[i].start.mock.calls[0][2]).toBeCloseTo(.14);
    }
    expect(d.start).not.toHaveBeenCalled();
    expect(d.stop).not.toHaveBeenCalled();
    expect(d.seekTo).not.toHaveBeenCalled();
    expect(d.clockStart).toBe(1);
    expect(d._token).toBe(7);
    c.currentTime=result.drumsStart+.1;
    expect(recovery.snapshot()).toMatchObject({active:true,stage:'four-drum-count-in'});
    c.currentTime=result.bandAt+.06;
    expect(recovery.snapshot()).toMatchObject({active:false,stage:'full-band'});
  });
  test('failed/very quiet original sources fail safe, no mix gate and no scratch',()=>{
    const {d,scratch,recovery,mixer}=harness();
    d.cache.clear();
    expect(recovery.start(d)).toBeNull();
    expect(mixer.setRecoveryPlan).not.toHaveBeenCalled();
    expect(scratch.play).not.toHaveBeenCalled();
    expect(d.started).toBe(true);
  });
  test('failed recovery graph scheduling unwinds all gates and preserves continuous recording',()=>{
    const {d,mixer,recovery,scratch}=harness();
    mixer.setRecoveryPlan=jest.fn(plan=>{
      mixer.recoveryPlan=plan;
      throw new Error('simulated WebAudio source recovery parameter failure');
    });
    expect(recovery.start(d)).toBeNull();
    expect(mixer.cancelRecoveryPlan).toHaveBeenCalledTimes(1);
    expect(mixer.recoveryPlan).toBeNull();
    expect(scratch.play).not.toHaveBeenCalled();
    expect(recovery.snapshot()).toEqual({active:false,stage:'idle'});
    expect(d.started).toBe(true);
    expect(d.clockStart).toBe(1);
    expect(d._token).toBe(7);
  });
  test('recovery plan returning false after changing gates cancels its partial state',()=>{
    const {d,mixer,recovery}=harness();
    mixer.setRecoveryPlan=jest.fn(plan=>{mixer.recoveryPlan=plan;return false;});
    expect(recovery.start(d)).toBeNull();
    expect(mixer.cancelRecoveryPlan).toHaveBeenCalledTimes(1);
    expect(mixer.recoveryPlan).toBeNull();
  });

  test('destroy or superseding genuine crash stops exactly four old accents',()=>{
    const {c,d,sources,mixer,recovery}=harness();
    const first=recovery.start(d);
    c.currentTime=first.silenceStart+.01;
    const next=recovery.start(d);
    expect(next.generation).not.toBe(first.generation);
    expect(sources).toHaveLength(8);
    for(const src of sources.slice(0,4))expect(src.stop).toHaveBeenCalled();
    expect(mixer.cancelRecoveryPlan).toHaveBeenCalledTimes(1);
    recovery.cancel();
    expect(mixer.cancelRecoveryPlan).toHaveBeenCalledTimes(2);
    expect(recovery.snapshot().active).toBe(false);
    for(const src of sources.slice(4))expect(src.stop).toHaveBeenCalled();
  });
  test('quiet first segment preloads one later original drum fragment through SAME director cache',async()=>{
    const {d,recovery,buffer}=harness();
    d.cache.set('0/drums',{...buffer,getChannelData:()=>new Float32Array(48000)});
    d._fetchSource=jest.fn(async(info,i,name,token)=>{
      expect(info.pack).toBe(d.pack);
      expect(info.track.id).toBe('track-A');
      expect(name).toBe('drums');expect(token).toBe(7);
      d.cache.set(`${i}/drums`,buffer);return buffer;
    });
    expect(await recovery.prepare(d)).toBe(true);
    expect(d._fetchSource).toHaveBeenCalledTimes(1);
    expect(d._fetchSource.mock.calls[0][1]).toBe(1);
    expect(findOriginalDrumAccent(d).segmentIndex).toBe(1);
  });
});

function eventHarness(){
  const e=new EventEmitter();const a=new AudioSynth({events:e});
  const {c,d,mixer,scratch,recovery}=harness();
  a.ctx=c;a.nodes={musicSrc:{gain:param()},musicBus:{gain:param()},
    master:{gain:param()},musicFilter:{frequency:param()},
    windGain:{gain:param()},windFilter:{frequency:param()},
    gate:{gain:param()},dry:{gain:param()},wet:{gain:param()},staticGain:{gain:param()}};
  a.settings={masterVolume:.9,musicVolume:.8,sfxVolume:.7,
    musicEnabledSongs:defaultSongSelection(),windEnabled:true,windVolume:1};
  a._musicMode='run';a._musicWanted=true;
  a._stemMusic=d;a._fatalCountIn=recovery;a._vinylScratch=scratch;
  a.playSfx=jest.fn();
  d.setMenuMode=jest.fn();d.setBiome=jest.fn();
  d.setBsodDanger=jest.fn();d.setAirborne=jest.fn();
  a._activateStemMusic=jest.fn();
  return {e,a,c,d,mixer,scratch,recovery};
}

describe('EVT.CRASH fatal-only, run lifecycle and manual ownership',()=>{
  test('only authoritative fatal:true plus valid runId can start; negated:false alone is not fatal',()=>{
    const {e,a,scratch,mixer}=eventHarness();
    const invalid=[
      {cause:'legacy',negated:false},
      {cause:'legacy',negated:false,runId:'legacy'},
      {cause:'legacy',negated:false,fatal:false,runId:'old'},
      {cause:'bad',negated:false,fatal:true},
      {cause:'bad',negated:false,fatal:true,runId:''},
      {cause:'bad',negated:false,fatal:true,runId:'   '},
      {cause:'bad',negated:true,fatal:true,runId:'shield'},
    ];
    for(const event of invalid)e.emit(EVT.CRASH,event);
    expect(mixer.setRecoveryPlan).not.toHaveBeenCalled();
    expect(scratch.play).not.toHaveBeenCalled();
    expect(a.getFatalCountInStatus()).toMatchObject({active:false,stage:'idle'});
  });

  test('same-run duplicate never restarts; genuinely new fatal run supersedes recovery',()=>{
    const {e,a,recovery,mixer,c,d}=eventHarness();
    const impact=id=>e.emit(EVT.CRASH,{cause:'bsod',negated:false,fatal:true,runId:id});
    impact('life-1');
    const first=recovery.snapshot();
    expect(first).toMatchObject({active:true,runId:'life-1',scheduledDrumAccents:4});
    e.emit(EVT.RUN_END,{record:{id:'life-1',cause:'crash'}});
    e.emit(EVT.RUN_START,{runId:'life-2',seed:'retry'});
    expect(recovery.snapshot().generation).toBe(first.generation);
    impact('life-1');
    expect(recovery.snapshot().generation).toBe(first.generation);
    c.currentTime+=.4;
    impact('life-2');
    const second=recovery.snapshot();
    expect(second.runId).toBe('life-2');
    expect(second.generation).not.toBe(first.generation);
    expect(mixer.cancelRecoveryPlan).toHaveBeenCalledTimes(1);
    expect(d.clockStart).toBe(1);
    expect(d._token).toBe(7);
  });

  test('negated shield, missing negated, and menu crashes cannot trigger death sequence',()=>{
    const {e,a,scratch,mixer}=eventHarness();
    e.emit(EVT.CRASH,{cause:'hazard',negated:true,fatal:false,runId:'shield-1'});
    e.emit(EVT.CRASH,{cause:'gym-catch',runId:'gym-1'});
    expect(mixer.setRecoveryPlan).not.toHaveBeenCalled();
    a._musicMode='menu';e.emit(EVT.CRASH,{cause:'fatal',negated:false,fatal:true,runId:'menu-1'});
    expect(scratch.play).not.toHaveBeenCalled();
  });
  test('run-end and immediate new run leave music generation and 4 drum slots unchanged',()=>{
    const {e,a,d,c,recovery,mixer}=eventHarness();
    e.emit(EVT.CRASH,{cause:'bsod',negated:false,fatal:true,runId:'fatal-1'});
    const original=recovery.snapshot();
    expect(original).toMatchObject({active:true,scheduledDrumAccents:4});
    e.emit(EVT.RUN_END,{});
    expect(recovery.snapshot().generation).toBe(original.generation);
    expect(mixer.cancelRecoveryPlan).not.toHaveBeenCalled();
    e.emit(EVT.RUN_START,{seed:'new-run'});
    expect(recovery.snapshot().generation).toBe(original.generation);
    expect(d.clockStart).toBe(1);expect(d._token).toBe(7);
    c.currentTime=original.drumsStart+.3;
    expect(a.getBeatTiming()).toMatchObject({trusted:false,
      reason:'fatal-recovery-grid-unverified'});
  });
  test('explicit jukebox intent cancels recovery; muted and user manual pause also override',()=>{
    const {e,a,mixer,recovery}=eventHarness();
    e.emit(EVT.CRASH,{cause:'fatal',negated:false,fatal:true,runId:'fatal-'+(a.__testRunCounter=(a.__testRunCounter||0)+1)});
    a._vinylJukeboxIntent();
    expect(recovery.snapshot().active).toBe(false);
    expect(mixer.cancelRecoveryPlan).toHaveBeenCalledTimes(1);
    a._musicMode='run';e.emit(EVT.CRASH,{cause:'fatal',negated:false,fatal:true,runId:'fatal-'+(a.__testRunCounter=(a.__testRunCounter||0)+1)});
    a._onVinylManualPause({reason:'manual',runId:'X',pauseToken:'X:1'});
    expect(recovery.snapshot().active).toBe(false);
    expect(mixer.cancelRecoveryPlan).toHaveBeenCalledTimes(2);
    a._musicMode='run';a._paused=false;
    e.emit(EVT.CRASH,{cause:'fatal',negated:false,fatal:true,runId:'fatal-'+(a.__testRunCounter=(a.__testRunCounter||0)+1)});
    a.settings.musicVolume=0;a._cancelFatalCountIn();
    expect(recovery.snapshot().active).toBe(false);
  });
});
