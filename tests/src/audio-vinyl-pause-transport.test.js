import {jest} from '@jest/globals';
import {EventEmitter} from 'events';
import {AudioSynth} from '../../src/systems/AudioSynth.js';
import {EVT} from '../../src/events.js';
import {defaultSongSelection,FIRST_SONG_ID,GAME_SONGS} from '../../src/systems/music/MusicPlaylist.js';
import {VINYL_SCRATCH_SECONDS} from '../../src/systems/music/TurntableScratch.js';

const OTHER_SONG_ID=GAME_SONGS.find(song=>song.id!==FIRST_SONG_ID).id;
const fakeParam=()=>({setTargetAtTime:jest.fn(),cancelScheduledValues:jest.fn()});
function setup() {
  const events=new EventEmitter();
  const a=new AudioSynth({events});
  const ctx={currentTime:42,state:'running',close:jest.fn()};
  a.ctx=ctx;
  a.nodes={
    musicFilter:{frequency:fakeParam()},musicSrc:{gain:fakeParam()},
    windGain:{gain:fakeParam()},windFilter:{frequency:fakeParam()},
    master:{gain:fakeParam()},musicBus:{gain:fakeParam()},sfxBus:{gain:fakeParam()},
  };
  a.settings={masterVolume:.8,musicVolume:.6,sfxVolume:.8,
    musicEnabledSongs:defaultSongSelection(),windEnabled:true,windVolume:1};
  const d={started:true,ready:true,disposed:false,transportPaused:false,
    pack:{duration:180,id:FIRST_SONG_ID},track:{id:FIRST_SONG_ID},
    catalog:[{id:FIRST_SONG_ID},{id:OTHER_SONG_ID}],
    ctx,clockStart:20,activeNodes:new Set([{}]),trackIndex:0,
    _resumeOffset:0,_token:8,_loading:null,stop:jest.fn(),
    transportPause:jest.fn(function(){
      if(!this.started)return false;
      this._resumeOffset=ctx.currentTime-this.clockStart;
      this.started=false;this.transportPaused=true;
      this._token++;
      this.activeNodes.clear();
      return true;
    }),
    transportPlay:jest.fn(function(){
      if(this.started)return true;
      this.started=true;this.transportPaused=false;
      return true;
    }),
    transportStep:jest.fn(function(){
      this.started=false;this._resumeOffset=0;
      this.trackIndex=1;this.track=this.catalog[1];this._token++;
      return true;
    }),
    attach:jest.fn(),applySettings:jest.fn(),setMenuMode:jest.fn(),
    setBsodDanger:jest.fn(),
  };
  a._stemMusic=d;
  a._musicWanted=true;
  a._vinylScratch={play:jest.fn(()=>VINYL_SCRATCH_SECONDS),cancel:jest.fn(),destroy:jest.fn()};
  a.unlock=jest.fn();
  a._ensureCtx=jest.fn(()=>true);
  a._activateStemMusic=jest.fn(()=>true);
  return {a,d,ctx,events};
}

describe('user vinyl pause/resume owns only ONE preserved stem transport',()=>{
  beforeEach(()=>jest.useFakeTimers());
  afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();});

  test('GAME_PAUSE freezes soundtrack source frame BEFORE scratch, resume scratch THEN same song offset',()=>{
    const {a,d,events,ctx}=setup();
    events.emit(EVT.GAME_PAUSE,{runTimeMs:3000});
    expect(a._paused).toBe(true);
    expect(d.transportPause).toHaveBeenCalledTimes(1);
    expect(d.started).toBe(false);
    expect(d._resumeOffset).toBe(22);
    expect(d.transportPaused).toBe(true);
    expect(a._musicWanted).toBe(false);
    expect(a._vinylScratch.play).toHaveBeenCalledWith('pause');
    expect(a.nodes.musicSrc.gain.setTargetAtTime.mock.lastCall[0]).toBe(0);
    expect(a.getBeatTiming()).toMatchObject({trusted:false,release:'immediate'});
    events.emit(EVT.GAME_RESUME,{runTimeMs:3000});
    expect(a._paused).toBe(false);
    expect(a._vinylScratch.play).toHaveBeenCalledWith('resume');
    expect(d.transportPlay).not.toHaveBeenCalled();
    jest.advanceTimersByTime(204);
    expect(d.transportPlay).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(d._resumeOffset).toBe(22);
    expect(d.trackIndex).toBe(0);
    expect(a._musicWanted).toBe(true);
    a.destroy();
  });


  test('opted-in manual pause keeps the exact playing source moving without vinyl scratches',()=>{
    const {a,d,events}=setup();
    a.applySettings({...a.settings,musicDuringPause:true});
    events.emit(EVT.GAME_PAUSE,{reason:'manual',runId:'R',pauseToken:'R:1'});
    expect(a._paused).toBe(true);
    expect(a._vinylPauseSession?.pauseToken).toBe('R:1');
    expect(d.transportPause).not.toHaveBeenCalled();
    expect(d.started).toBe(true);
    expect(a._musicWanted).toBe(true);
    expect(a.nodes.musicFilter.frequency.setTargetAtTime.mock.lastCall[0]).toBe(18000);
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    events.emit(EVT.GAME_RESUME,{reason:'manual',runId:'R',pauseToken:'R:1'});
    expect(a._paused).toBe(false);
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(d.trackIndex).toBe(0);
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    a.destroy();
  });

  test('pause preference enables the same frozen song immediately without a vinyl scratch',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{reason:'manual',runId:'R',pauseToken:'R:1'});
    const offset=d._resumeOffset;
    const token=d._token;
    a.applySettings({...a.settings,musicDuringPause:true});
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(d._token).toBe(token);
    expect(d._resumeOffset).toBe(offset);
    expect(a._vinylPauseSession.shouldResume).toBe(false);
    expect(a._musicWanted).toBe(true);
    expect(a.nodes.musicFilter.frequency.setTargetAtTime.mock.lastCall[0]).toBe(18000);
    events.emit(EVT.GAME_RESUME,{reason:'manual',runId:'R',pauseToken:'R:1'});
    jest.advanceTimersByTime(500);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(a._vinylScratch.play).toHaveBeenCalledTimes(1); // original pause only
    a.destroy();
  });

  test('disabling continuous music mid-pause freezes source and restores it on resume',()=>{
    const {a,d,events}=setup();
    a.applySettings({...a.settings,musicDuringPause:true});
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    a.applySettings({...a.settings,musicDuringPause:false});
    expect(d.transportPause).toHaveBeenCalledTimes(1);
    expect(d.transportPaused).toBe(true);
    expect(a._musicWanted).toBe(false);
    expect(a.nodes.musicSrc.gain.setTargetAtTime.mock.lastCall[0]).toBe(0);
    expect(a._vinylPauseSession.shouldResume).toBe(true);
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    jest.advanceTimersByTime(205);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(d.trackIndex).toBe(0);
    a.destroy();
  });

  test('music preference never overrides an explicit pause-menu jukebox PAUSE',()=>{
    const {a,d,events}=setup();
    a.applySettings({...a.settings,musicDuringPause:true});
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    a.jukeboxPause();
    expect(a._vinylPauseSession.manualOverride).toBe(true);
    a.applySettings({...a.settings,musicDuringPause:false});
    a.applySettings({...a.settings,musicDuringPause:true});
    expect(d.transportPlay).not.toHaveBeenCalled();
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(a._musicWanted).toBe(false);
    a.destroy();
  });

  test('stale source generation cannot be restarted by enabling music during pause',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    d._token++;
    a.applySettings({...a.settings,musicDuringPause:true});
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(a._musicWanted).toBe(false);
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    jest.advanceTimersByTime(500);
    expect(d.transportPlay).not.toHaveBeenCalled();
    a.destroy();
  });

  test('continuous music remains the same song on Quit, and does not affect fatal music',()=>{
    const {a,d,events}=setup();
    a.applySettings({...a.settings,musicDuringPause:true});
    events.emit(EVT.GAME_PAUSE,{reason:'manual',runId:'R',pauseToken:'R:1'});
    events.emit(EVT.RUN_ABORT,{reason:'quit',runId:'R',pauseToken:'R:1'});
    expect(a._paused).toBe(false);
    expect(a._musicMode).toBe('menu');
    expect(d.transportPause).not.toHaveBeenCalled();
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    events.emit(EVT.RUN_END,{});
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    a.destroy();
  });

  test('rapid pause/resume supersedes scheduled old starts; never duplicates streams',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{});
    events.emit(EVT.GAME_RESUME,{});
    jest.advanceTimersByTime(70);
    events.emit(EVT.GAME_PAUSE,{});
    expect(a._vinylScratch.cancel).toHaveBeenCalled();
    expect(d.transportPause).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1000);
    expect(d.transportPlay).not.toHaveBeenCalled();
    events.emit(EVT.GAME_RESUME,{});
    jest.advanceTimersByTime(205);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    events.emit(EVT.GAME_RESUME,{});
    jest.advanceTimersByTime(1000);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    a.destroy();
  });

  test.each([0,.000])('muted master volume %s freezes/resumes WITHOUT scratch',level=>{
    const {a,d,events}=setup();
    a.settings.masterVolume=level;
    events.emit(EVT.GAME_PAUSE,{});
    expect(d.transportPause).toHaveBeenCalledTimes(1);
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    events.emit(EVT.GAME_RESUME,{});
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    a.destroy();
  });

  test('muted music and disabled song selection never emit scratch',()=>{
    for(const mute of ['music','allSongs']){
      const {a,d,events}=setup();
      if(mute==='music')a.settings.musicVolume=0;
      else a.settings.musicEnabledSongs=Object.fromEntries(
        Object.keys(a.settings.musicEnabledSongs).map(id=>[id,false]));
      events.emit(EVT.GAME_PAUSE,{});
      expect(a._vinylScratch.play).not.toHaveBeenCalled();
      events.emit(EVT.GAME_RESUME,{});
      expect(a._vinylScratch.play).not.toHaveBeenCalled();
      expect(d.transportPlay).toHaveBeenCalledTimes(mute==='music'?1:0);
      a.destroy();
    }
  });

  test('game death/crash and run-abort never trigger a vinyl scratch',()=>{
    const {a,d,events}=setup();
    a.playSfx=jest.fn();
    events.emit(EVT.CRASH,{});
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    events.emit(EVT.RUN_END,{});
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    expect(a._vinylPauseSession).toBeNull();
    events.emit(EVT.RUN_ABORT,{});
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    a.destroy();
  });

  test('RUN_ABORT during optional reverse scratch cancels timer but restores continuous menu soundtrack exactly once',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{});
    const saved=d._resumeOffset;
    events.emit(EVT.GAME_RESUME,{});
    expect(a._vinylResume).not.toBeNull();
    events.emit(EVT.RUN_ABORT,{reason:'quit'});
    expect(a._vinylResume).toBeNull();
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(d._resumeOffset).toBe(saved);
    expect(d.started).toBe(true);
    expect(a._musicMode).toBe('menu');
    jest.advanceTimersByTime(1000);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(a._vinylPauseSession).toBeNull();
    expect(a._vinylScratch.play).toHaveBeenCalledTimes(2);
    a.destroy();
  });

  test('RUN_ABORT directly from PauseScene resumes same original soundtrack without vinyl on quit',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{reason:'manual',pauseToken:'run:1'});
    const stopped=d._resumeOffset;
    events.emit(EVT.RUN_ABORT,{reason:'quit',pauseToken:'run:1'});
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(d._resumeOffset).toBe(stopped);
    expect(a._musicMode).toBe('menu');
    expect(a._paused).toBe(false);
    expect(a._vinylScratch.play).toHaveBeenCalledTimes(1); // pause only
    a.destroy();
  });

  test('old quit/abort token cannot cancel a newer manual pause session',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{runId:'run-11',pauseToken:'run-11:2',reason:'manual'});
    const pausedMusicMode=a._musicMode;
    events.emit(EVT.RUN_ABORT,{runId:'run-11',pauseToken:'run-11:1',reason:'quit'});
    expect(a._paused).toBe(true);
    expect(a._vinylPauseSession?.pauseToken).toBe('run-11:2');
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(a._musicMode).toBe(pausedMusicMode);
    events.emit(EVT.RUN_ABORT,{runId:'run-11',pauseToken:'run-11:2',reason:'quit'});
    expect(a._paused).toBe(false);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(a._vinylScratch.play).toHaveBeenCalledTimes(1);
    a.destroy();
  });

  test('synthetic non-manual pause and resume payloads never trigger vinyl',()=>{
    const {a,d,events}=setup();
    const initialMusicMode=a._musicMode;
    events.emit(EVT.GAME_PAUSE,{reason:'death',runId:'run-11',pauseToken:'not-manual'});
    expect(a._paused).toBe(false);
    expect(a._vinylScratch.play).not.toHaveBeenCalled();
    events.emit(EVT.GAME_RESUME,{reason:'death',runId:'run-11',pauseToken:'not-manual'});
    expect(d.transportPause).not.toHaveBeenCalled();
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(a._musicMode).toBe(initialMusicMode);
    a.destroy();
  });

  test('old unmatched pauseToken cannot cancel a newer active manual pause',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{runId:'run-11',pauseToken:'run-11:2'});
    events.emit(EVT.GAME_RESUME,{runId:'run-11',pauseToken:'run-11:1'});
    expect(a._paused).toBe(true);
    expect(a._vinylPauseSession?.pauseToken).toBe('run-11:2');
    expect(d.transportPlay).not.toHaveBeenCalled();
    events.emit(EVT.GAME_RESUME,{runId:'run-11',pauseToken:'run-11:2'});
    jest.advanceTimersByTime(205);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    a.destroy();
  });

  test('intentional pause-menu PLAY keeps its chosen song and normal frequency after gameplay resume',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{});
    expect(a.jukeboxPlay()).toBe(true);
    expect(a._vinylPauseSession.manualOverride).toBe(true);
    expect(a._musicWanted).toBe(true);
    expect(a._jukeboxMode).toBe(true);
    expect(a.nodes.musicFilter.frequency.setTargetAtTime.mock.lastCall[0]).toBe(18000);
    events.emit(EVT.GAME_RESUME,{});
    jest.advanceTimersByTime(1000);
    expect(a._vinylScratch.play).toHaveBeenCalledTimes(1);
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(a._musicWanted).toBe(true);
    a.destroy();
  });

  test('intentional pause-menu SKIP retains new track selection, no old song restored',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{});
    expect(a.jukeboxStep(1)).toBe(true);
    expect(d.trackIndex).toBe(1);
    expect(d.transportPaused).toBe(true);
    events.emit(EVT.GAME_RESUME,{});
    jest.advanceTimersByTime(1000);
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(d.track.id).toBe(OTHER_SONG_ID);
    expect(d._resumeOffset).toBe(0);
    a.destroy();
  });

  test('intentional pause-menu song PAUSE is authoritative on resume',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{});
    // User first explicitly hit PLAY in the pause menu.
    a.jukeboxPlay();d.started=true;d.transportPaused=false;
    a.jukeboxPause();
    expect(a._musicWanted).toBe(false);
    events.emit(EVT.GAME_RESUME,{});
    jest.advanceTimersByTime(1000);
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(a._musicWanted).toBe(false);
    a.destroy();
  });

  test('manual skip during pending resume scratch cancels obsolete auto-resume',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{});
    events.emit(EVT.GAME_RESUME,{});
    expect(a._vinylResume).not.toBeNull();
    a.jukeboxStep(1);
    expect(a._vinylResume).toBeNull();
    jest.advanceTimersByTime(1000);
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(d.trackIndex).toBe(1);
    a.destroy();
  });

  test('changing song selection/paused source generation blocks stale automatic restore',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{});
    d._token++;
    events.emit(EVT.GAME_RESUME,{});
    jest.advanceTimersByTime(1000);
    expect(a._vinylScratch.play).toHaveBeenCalledTimes(1);
    expect(d.transportPlay).not.toHaveBeenCalled();
    a.destroy();
  });

  test('hidden/suspended AudioContext defers resume until unlock without drifting',()=>{
    const {a,d,events,ctx}=setup();
    events.emit(EVT.GAME_PAUSE,{});
    events.emit(EVT.GAME_RESUME,{});
    ctx.state='suspended';
    jest.advanceTimersByTime(205);
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(a._vinylResume?.awaitingContext).toBe(true);
    ctx.state='running';
    a._afterResume();
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(d._resumeOffset).toBe(22);
    a.destroy();
  });
});
