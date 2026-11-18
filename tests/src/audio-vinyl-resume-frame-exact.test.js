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
