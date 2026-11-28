import { jest } from '@jest/globals';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';

/** Real scheduler implementation with bounded fake WebAudio source nodes. */
function sourceAt(now,{savedOffset=22.375,gate=true}={}) {
  const player=Object.create(StemMusicDirector.prototype);
  const calls=[];
  player.ctx={currentTime:now,createBufferSource:()=>{
    const node={connect:jest.fn(),disconnect:jest.fn(),
      start:jest.fn((...args)=>calls.push(args)),stop:jest.fn()};
    return node;
  }};
  player.pack={duration:174.6,sampleRate:48000,segments:[
    {startFrame:0,frames:12*48000},
    {startFrame:12*48000,frames:12*48000},
    {startFrame:24*48000,frames:12*48000},
  ]};
  player.clockStart=now+.12-savedOffset;
  player._resumeGateAt=gate ? now+.12 : null;
  player.gains=new Map([['drums',{}]]);
  player.scheduled=new Set();
  player.activeNodes=new Set();
  const buffer={duration:12};
  return {player,calls,buffer};
}

describe('vinyl jukebox position readout during scheduled resume',()=>{
  const playerAt=(now,gate)=>{
    const d=Object.create(StemMusicDirector.prototype);
    d.catalog=[{id:'soundtrack'}];d.songEnabled={soundtrack:true};
    d.trackIndex=0;d.track=d.catalog[0];
    d._lastPlayed=null;d._transportHistory=[];
    d.shuffleEnabled=false;d.transportPaused=false;d.started=true;
    d.pack={duration:180};d.ctx={currentTime:now};
    d.clockStart=30;d._resumeGateAt=gate;
    return d;
  };
  test('silent scheduled resume holds original offset instead of showing a 120ms rewind',()=>{
    const d=playerAt(40,40.12);
    expect(d.transportSnapshot().position).toBeCloseTo(10.12,8);
    d.ctx.currentTime=40.08;
    expect(d.transportSnapshot().position).toBeCloseTo(10.12,8);
    d.ctx.currentTime=40.12;
    expect(d.transportSnapshot().position).toBeCloseTo(10.12,8);
    d.ctx.currentTime=40.25;
    expect(d.transportSnapshot().position).toBeCloseTo(10.25,8);
  });
  test('normal continuous playback and a deliberately paused transport keep their old semantics',()=>{
    const d=playerAt(40,null);
    expect(d.transportSnapshot().position).toBeCloseTo(10,8);
    d.transportPaused=true;d._resumeOffset=14.75;
    expect(d.transportSnapshot().position).toBeCloseTo(14.75,8);
  });
});

describe('vinyl musical resume must start from precisely the saved frame',()=>{
  test('manual resume never decodes audible 100ms of pre-roll before saved position',()=>{
    const {player,calls,buffer}=sourceAt(40);
    const startedAt=40.12;
    player._scheduleSource(0,'drums',buffer);
    expect(calls).toHaveLength(0); // entire first 12s is behind saved offset
    player._scheduleSource(1,'drums',buffer);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBeCloseTo(startedAt,8);
    expect(calls[0][1]).toBeCloseTo(22.375-12,8);
    const actualSongPosition=12+calls[0][1];
    expect(actualSongPosition).toBeCloseTo(22.375,8);
    expect(calls[0][2]).toBeCloseTo(12-calls[0][1],8);
    expect(player.scheduled.has('1/drums')).toBe(true);
  });

  test('separately decoded parallel stems start at identical source frame',()=>{
    const {player,calls,buffer}=sourceAt(40,{savedOffset:15.25});
    player.gains.set('bass',{});
    player.gains.set('guitar',{});
    for(const stem of ['drums','bass','guitar'])
      player._scheduleSource(1,stem,buffer);
    expect(calls).toHaveLength(3);
    for(const [time,offset] of calls){
      expect(time).toBeCloseTo(40.12,9);
      expect(offset).toBeCloseTo(3.25,9);
    }
    expect(player.activeNodes.size).toBe(3);
  });

  test('normal continuous track scheduling has no special resume gate',()=>{
    const {player,calls,buffer}=sourceAt(40,{savedOffset:0,gate:false});
    player._scheduleSource(0,'drums',buffer);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBeCloseTo(40.12,8);
    expect(calls[0][1]).toBeCloseTo(0,8);
  });

  test('late network decode advances source offset rather than restarting sample',()=>{
    const {player,calls,buffer}=sourceAt(40,{savedOffset:14.3});
    player.ctx.currentTime=40.8;
    player._scheduleSource(1,'drums',buffer);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBeCloseTo(40.82,8);
    // Playback follows the actual elapsed WebAudio clock after resume.
    expect(12+calls[0][1]).toBeCloseTo(14.3+(40.82-40.12),8);
  });

  test('stop invalidates the resume gate before a new song',()=>{
    const {player}=sourceAt(40);
    player.transportPaused=true;
    player._resumeOffset=22.375;
    player._token=5;
    player.cache=new Map();
    player.inflight=new Map();
    player._nextPromise=null;
    player._nextIndex=null;
    player.captionWords=[];
    player.started=true;
    player.adaptive={reset:jest.fn()};
    player.bus={gain:{setTargetAtTime:jest.fn()}};
    player.stop();
    expect(player._resumeGateAt).toBeNull();
    expect(player._resumeOffset).toBe(0);
    expect(player.transportPaused).toBe(false);
  });
});


describe('source offset is not lost while an original stem decodes',()=>{
  test('a second Pause during async load retains the saved source offset, not zero',()=>{
    const d=Object.create(StemMusicDirector.prototype);
    d.started=true;d.disposed=false;d.ready=true;
    d.ctx={state:'running',currentTime:42};
    d.pack=null;d.clockStart=null;
    d.trackIndex=0;d.catalog=[{id:'original'}];d.songEnabled={original:true};
    d.shuffleEnabled=false;d._transportHistory=[];d._shuffleRemaining=[];
    d._resumeOffset=22.375;d._pendingResumeOffset=null;
    d._token=5;d._loading=null;d._timer=null;
    d._nextEnabledIndex=()=>0;
    d._holdPlaybackBoundary=()=>false;
    // A deliberately pending network decode. No pack/clock available yet.
    d._beginTrack=jest.fn(()=>new Promise(()=>{}));
    d.stop=jest.fn(function(){
      this.started=false;this.transportPaused=false;
      this._resumeOffset=0;this._pendingResumeOffset=null;
      this._token++;
    });
    try{
      d._ensureRunning();
      expect(d._beginTrack).toHaveBeenCalledWith(0,null,22.375);
      expect(d._resumeOffset).toBe(0);
      expect(d._pendingResumeOffset).toBe(22.375);
      expect(d.transportSnapshot().position).toBeCloseTo(22.375,6);
      expect(d.transportPause()).toBe(true);
      expect(d._resumeOffset).toBeCloseTo(22.375,6);
      expect(d.transportPaused).toBe(true);
      expect(d.stop).toHaveBeenCalledTimes(1);
    } finally {if(d._timer)clearInterval(d._timer);}
  });
});


describe('pause before scheduled first audible source frame',()=>{
  test('retains the saved offset instead of rewinding the silent 120 ms resume gate',()=>{
    const {player:d}=sourceAt(40,{savedOffset:22.375,gate:true});
    d.started=true;d.transportPaused=false;
    d.stop=jest.fn(function(){this.started=false;this._resumeOffset=0;});
    const expected=22.375; // no audio frame has played before the scheduled gate
    // Resume decoder scheduled the actual song at 40.12. At 40.00 no
    // audio frames played yet; another pause must not discard the gate.
    expect(d.transportPause()).toBe(true);
    expect(d._resumeOffset).toBeCloseTo(expected,6);
    expect(d.transportPaused).toBe(true);
  });
});

describe('a new song must own its frame even before original stems decode',()=>{
  test('pause after incoming manifest swaps track but before buffers arrive saves incoming frame zero',async()=>{
    const d=Object.create(StemMusicDirector.prototype);
    d.started=true;d.transportPaused=false;d.disposed=false;d.ready=true;
    d._token=5;d._loading=null;d._timer=null;
    d.catalog=[{id:'outgoing',title:'Old'},{id:'incoming',title:'New'}];
    d.songEnabled={outgoing:true,incoming:true};d.trackIndex=0;d.track=d.catalog[0];
    d.pack={id:'outgoing',duration:120};d.clockStart=10;
    d.ctx={state:'running',currentTime:88}; // old song at 78 seconds
    d._resumeOffset=0;d._pendingResumeOffset=null;d._resumeGateAt=null;
    d._lastPlayed=null;d._transportHistory=[];d._skipHistoryOnce=true;
    d.shuffleEnabled=false;
    d.cache=new Map();d.inflight=new Map();d.scheduled=new Set();
    d._nextIndex=null;d._nextPromise=null;d._nextPrepared=null;
    d.gains=new Map();d._effectSignatures=new Map();d._timbreSignatures=new Map();
    d._consumeShuffledIndex=jest.fn();d._refreshVoices=jest.fn();
    d._applyMusicTimbres=jest.fn();d._invalidateContinuousFxMemoAfterTrackReplace=jest.fn();
    d._restoreArcadeBridgeAfterTrackReplace=jest.fn();
    d.mixer={setRoomSend:jest.fn(),setGain:jest.fn(),addSource:jest.fn(()=>({}))};
    const pack={id:'incoming',duration:90,sourceNames:[],effects:{},layers:{},roomSends:{}};
    d._getTrack=jest.fn(async()=>({track:d.catalog[1],pack,base:'incoming'}));
    let releaseDecode;
    d._wantedNames=()=>['drums'];
    d._fetchSource=jest.fn(()=>new Promise(resolve=>{releaseDecode=resolve;}));
    d.stop=jest.fn(function(){
      this.started=false;this.transportPaused=false;this._resumeOffset=0;
      this._pendingResumeOffset=null;this._token++;
    });
    const flight=d._beginTrack(1,null,0);
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    expect(d._fetchSource).toHaveBeenCalledTimes(1);
    expect(d.trackIndex).toBe(1);
    expect(d.pack.id).toBe('incoming');
    expect(d.clockStart).toBe(10); // still the OLD song's WebAudio clock
    expect(d._pendingResumeOffset).toBe(0);
    expect(d.transportSnapshot().position).toBe(0);
    expect(d.transportPause()).toBe(true);
    expect(d._resumeOffset).toBe(0); // MUST NOT copy outgoing 78 seconds
    expect(d.transportPaused).toBe(true);
    releaseDecode();
    await flight; // old generation exits after Pause invalidates its token
    expect(d.started).toBe(false);
  });
});
