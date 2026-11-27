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

  test('default OFF freezes a still-loading original stem before async playback can escape',()=>{
    const {a,d,events}=setup();
    d.pack=null;
    d.activeNodes.clear();
    d._loading=Promise.resolve('decoding');
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    expect(d.transportPause).toHaveBeenCalledTimes(1);
    expect(d.started).toBe(false);
    expect(d.transportPaused).toBe(true);
    expect(a._vinylPauseSession.shouldResume).toBe(true);
    expect(a._vinylScratch.play).not.toHaveBeenCalled(); // no audible source yet
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    jest.advanceTimersByTime(205);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    a.destroy();
  });

  test('switching continuous playback OFF mid-pause freezes a still-loading stem',()=>{
    const {a,d,events}=setup();
    a.applySettings({...a.settings,musicDuringPause:true});
    d.pack=null;
    d.activeNodes.clear();
    d._loading=Promise.resolve('decoding');
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    expect(d.transportPause).not.toHaveBeenCalled();
    a.applySettings({...a.settings,musicDuringPause:false});
    expect(d.transportPause).toHaveBeenCalledTimes(1);
    expect(d.started).toBe(false);
    expect(a._vinylPauseSession.shouldResume).toBe(true);
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    jest.advanceTimersByTime(205);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    a.destroy();
  });

  test('suspended AudioContext preserves procedural restore until a real unlock',()=>{
    const {a,d,ctx,events}=setup();
    // The original song has fallen back to procedural audio.
    d.started=false;d.transportPaused=false;d.pack=null;
    a._musicTimer=12345;
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    expect(a._vinylPauseSession).toMatchObject({shouldResume:true,procedural:true});
    ctx.state='suspended';
    a.applySettings({...a.settings,musicDuringPause:true});
    expect(a._vinylPauseSession).toMatchObject({shouldResume:true,procedural:true});
    expect(a._musicWanted).toBe(false);
    a._activateStemMusic=jest.fn(()=>false); // real guard refuses stems during a manual pause
    a._startScheduler=jest.fn(()=>{a._musicTimer=23456;});
    ctx.state='running';
    a._afterResume();
    expect(a._startScheduler).toHaveBeenCalledTimes(1);
    expect(a._vinylPauseSession).toMatchObject({shouldResume:false,procedural:false});
    expect(a._musicWanted).toBe(true);
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    expect(a._startScheduler).toHaveBeenCalledTimes(1);
    a._musicTimer=null; // test scheduler sentinel, not a real interval
    a.destroy();
  });

  test('OFF, all-songs-off, opt-IN, then re-enable starts music while the run stays paused',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    const off=Object.fromEntries(Object.keys(a.settings.musicEnabledSongs).map(id=>[id,false]));
    a.applySettings({...a.settings,musicEnabledSongs:off});
    a.applySettings({...a.settings,musicDuringPause:true});
    expect(a._vinylPauseSession.shouldResume).toBe(true);
    const activate=jest.fn(()=>{d.started=true;return true;});
    a._activateStemMusic=activate;
    a.applySettings({...a.settings,musicEnabledSongs:defaultSongSelection()});
    expect(activate).toHaveBeenCalledTimes(1);
    expect(a._vinylPauseSession).toMatchObject({shouldResume:false,restartOnResume:false});
    expect(a._paused).toBe(true);
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    expect(activate).toHaveBeenCalledTimes(1);
    a.destroy();
  });

  test('procedural source resumes AUDIBLY after toggling continuous Pause OFF',()=>{
    const {a,d,events,ctx}=setup();
    a.applySettings({...a.settings,musicDuringPause:true});
    d.started=false;d.transportPaused=false;d.pack=null;d.activeNodes.clear();
    a._musicTimer=71232;
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    a.applySettings({...a.settings,musicDuringPause:false});
    expect(a._vinylPauseSession).toMatchObject({shouldResume:true,procedural:true});
    a._activateStemMusic=jest.fn(()=>false);
    a._startScheduler=jest.fn(()=>{a._musicTimer=77277;});
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    jest.advanceTimersByTime(205); // existing reverse-vinyl scratch completes first
    expect(a._startScheduler).toHaveBeenCalledTimes(1);
    expect(a.nodes.musicSrc.gain.setTargetAtTime.mock.lastCall).toEqual([1,ctx.currentTime,.04]);
    a._musicTimer=null;
    a.destroy();
  });

  test('default-OFF all-songs-off/re-enable restarts normal fallback if catalog missing',()=>{
    const {a,d,events,ctx}=setup();
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    const off=Object.fromEntries(Object.keys(a.settings.musicEnabledSongs).map(id=>[id,false]));
    a.applySettings({...a.settings,musicEnabledSongs:off});
    a.applySettings({...a.settings,musicEnabledSongs:defaultSongSelection()});
    expect(a._vinylPauseSession.restartOnResume).toBe(true);
    d.ready=false;d.started=false;d.transportPaused=false;
    a._activateStemMusic=jest.fn(()=>false);
    a._ensureCtx=jest.fn(()=>true);
    a._startScheduler=jest.fn(()=>{a._musicTimer=1221;});
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    expect(a._paused).toBe(false);
    expect(a._startScheduler).toHaveBeenCalledTimes(1);
    expect(a.nodes.musicSrc.gain.setTargetAtTime.mock.lastCall[0]).toBe(1);
    expect(a._baseRng).toBeTruthy();
    a._musicTimer=null;
    a.destroy();
  });

  test('OFF pause all-songs-off then re-enabled only starts music AFTER gameplay resumes',()=>{
    const {a,d,events}=setup();
    a._autoStartAttempted=true;
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    expect(a._vinylPauseSession.shouldResume).toBe(true);
    const off=Object.fromEntries(Object.keys(a.settings.musicEnabledSongs).map(id=>[id,false]));
    a.applySettings({...a.settings,musicEnabledSongs:off});
    // The director intentionally invalidates the original frozen source
    // when the last enabled song turns OFF.
    d.transportPaused=false;d._token++;d._resumeOffset=0;
    a.jukeboxPlay=jest.fn();
    a.applySettings({...a.settings,musicEnabledSongs:defaultSongSelection()});
    expect(a.jukeboxPlay).not.toHaveBeenCalled();
    expect(a._vinylPauseSession).toMatchObject({
      shouldResume:true,manualOverride:false,restartOnResume:true});
    expect(a._musicWanted).toBe(false);
    const activate=jest.fn(()=>{d.started=true;return true;});
    a._activateStemMusic=activate;
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    expect(a._paused).toBe(false);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(a._musicWanted).toBe(true);
    expect(d.transportPlay).not.toHaveBeenCalled(); // never revive stale source
    a.destroy();
  });

  test('turning continuous Pause ON after re-enabling all songs starts only the new source',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    const off=Object.fromEntries(Object.keys(a.settings.musicEnabledSongs).map(id=>[id,false]));
    a.applySettings({...a.settings,musicEnabledSongs:off});
    d.transportPaused=false;d._token++;d._resumeOffset=0;
    a.applySettings({...a.settings,musicEnabledSongs:defaultSongSelection()});
    expect(a._vinylPauseSession.restartOnResume).toBe(true);
    const activate=jest.fn(()=>{d.started=true;return true;});
    a._activateStemMusic=activate;
    a.applySettings({...a.settings,musicDuringPause:true});
    expect(activate).toHaveBeenCalledTimes(1);
    expect(a._vinylPauseSession).toMatchObject({
      restartOnResume:false,shouldResume:false,manualOverride:false});
    expect(a._musicWanted).toBe(true);
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    expect(activate).toHaveBeenCalledTimes(1);
    a.destroy();
  });

  test('original stem loading failure during opted-in Pause activates audible fallback',()=>{
    const {a,d,events}=setup();
    a.applySettings({...a.settings,musicDuringPause:true});
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    expect(a._jukeboxMode).toBe(true);
    expect(a._musicWanted).toBe(true);
    d.started=false; // real decoder reports a failed original pack
    // This is the first run; music started in Title, so startMusic() never
    // initialized the fallback RNG before the source fails mid-pause.
    a._baseRng=null;a._progOrder=undefined;a._musicSeed=null;
    a._startScheduler=jest.fn(()=>{a._musicTimer=71;});
    a.musicProviderFailed();
    expect(a._baseRng).toBeTruthy();
    expect(a._progOrder).toHaveLength(4);
    expect(a._startScheduler).toHaveBeenCalledTimes(1);
    expect(a.nodes.musicSrc.gain.setTargetAtTime.mock.lastCall[0]).toBe(1);
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    expect(a._musicWanted).toBe(true);
    expect(a._startScheduler).toHaveBeenCalledTimes(1);
    a._musicTimer=null;
    a.destroy();
  });

  test('re-enabling songs during default OFF pause is NOT a manual jukebox PLAY',()=>{
    const {a,d,events}=setup();
    a._autoStartAttempted=true;
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    const before=d.transportPlay.mock.calls.length;
    a.jukeboxPlay=jest.fn();
    const off=Object.fromEntries(Object.keys(a.settings.musicEnabledSongs).map(id=>[id,false]));
    a.applySettings({...a.settings,musicEnabledSongs:off});
    a.applySettings({...a.settings,musicEnabledSongs:defaultSongSelection()});
    expect(a.jukeboxPlay).not.toHaveBeenCalled();
    expect(a._vinylPauseSession.manualOverride).toBe(false);
    expect(d.transportPlay).toHaveBeenCalledTimes(before);
    expect(a._paused).toBe(true);
    a.destroy();
  });

  test('opted-in Pause starts an original song when its catalog finishes loading late',()=>{
    const {a,d,events}=setup();
    a.applySettings({...a.settings,musicDuringPause:true});
    d.ready=false;d.started=false;d.pack=null;
    a._musicWanted=true;
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    expect(a._paused).toBe(true);
    expect(a._musicWanted).toBe(true);
    expect(a._vinylPauseSession.shouldResume).toBe(false);
    d.ready=true;
    d.start=jest.fn(function(){this.started=true;return true;});
    a._activateStemMusic=AudioSynth.prototype._activateStemMusic.bind(a);
    // The real catalog callback must be permitted to start music while the
    // authoritative RunScene remains paused, without a second sound player.
    a._onStemCatalogReady();
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(d.started).toBe(true);
    expect(a._paused).toBe(true);
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    expect(a._paused).toBe(false);
    expect(d.transportPlay).not.toHaveBeenCalled();
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

  test('ON then OFF during async stem reload preserves original saved song offset',()=>{
    const {a,d,events}=setup();
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    const saved=d._resumeOffset;
    a.applySettings({...a.settings,musicDuringPause:true});
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    // The actual StemMusicDirector owns the in-flight offset independently
    // of a single PauseScene token (tested below against its real method).
    // Director consumed its resume offset while loading, before it owns a
    // pack/clockStart. Another OFF must not silently seek back to song zero.
    d.pack=null;d.clockStart=null;d.activeNodes.clear();
    d._resumeOffset=0;d._pendingResumeOffset=saved;
    d._loading=Promise.resolve('loading');
    // Match the real director's in-flight behavior, tested independently.
    d.transportPause.mockImplementationOnce(function(){
      this._resumeOffset=this._pendingResumeOffset;
      this._pendingResumeOffset=null;
      this.started=false;this.transportPaused=true;this._token++;
      return true;
    });
    a.applySettings({...a.settings,musicDuringPause:false});
    expect(d.transportPause).toHaveBeenCalledTimes(2);
    expect(d._resumeOffset).toBe(saved);
    expect(a._vinylPauseSession).toMatchObject({shouldResume:true,offset:saved});
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    jest.advanceTimersByTime(205);
    expect(d.transportPlay).toHaveBeenCalledTimes(2);
    a.destroy();
  });

  test('suspended stem context does not consume pending ON restore until real unlock',()=>{
    const {a,d,ctx,events}=setup();
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    ctx.state='suspended';
    a.applySettings({...a.settings,musicDuringPause:true});
    expect(d.transportPlay).not.toHaveBeenCalled();
    expect(a._vinylPauseSession.shouldResume).toBe(true);
    ctx.state='running';
    a._afterResume();
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    expect(a._vinylPauseSession.shouldResume).toBe(false);
    events.emit(EVT.GAME_RESUME,{reason:'manual'});
    jest.advanceTimersByTime(1000);
    expect(d.transportPlay).toHaveBeenCalledTimes(1);
    a.destroy();
  });

  test('no duplicate procedural scheduler while an opted-in stem transport is active',()=>{
    const {a,events}=setup();
    a.applySettings({...a.settings,musicDuringPause:true});
    events.emit(EVT.GAME_PAUSE,{reason:'manual'});
    a._jukeboxMode=false; // fail-safe even if an unusual mode toggle races
    a._activateStemMusic=jest.fn(()=>false);
    a._startScheduler=jest.fn();
    a.applySettings({...a.settings,musicDuringPause:true,musicVolume:.35});
    expect(a._startScheduler).not.toHaveBeenCalled();
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
