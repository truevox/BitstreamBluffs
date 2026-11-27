import {jest} from "@jest/globals";
import {captureManualPauseCandidate,canCaptureManualPauseCandidate} from '../../src/systems/savestate/pausedCandidate.js';
import {suspendManualRun} from '../../src/systems/savestate/manualSuspendController.js';

const eligible=()=>({
 crashed:false,unrankedPractice:false,tapePlayer:null,_replayTape:null,
 takeover:null,coachSim:null,guestPractice:false,bsodGym:false,
 dailyOfficial:false,modded:false,upgradeRun:{enabled:false},
 magnetsDrop:false,kodiaksOn:false,appliedBoosts:[],
 simClock:{tick:481},ghostRecorder:{lastTick:481},
 _manualPausePending:true,scene:{isPaused:key=>key==='RunScene'},
});

test('rejects normal active gameplay without touching its manual pause state',()=>{
 const r=eligible();r._manualPausePending=false;
 expect(()=>captureManualPauseCandidate(r,{})).toThrow('suspend:manual-pause-required');
 expect(r._manualPausePending).toBe(false);
 r._manualPausePending=true;r.scene.isPaused=()=>false;
 expect(()=>captureManualPauseCandidate(r,{})).toThrow('suspend:manual-pause-required');
 expect(r._manualPausePending).toBe(true);
});

test.each([
 ['crash',r=>r.crashed=true],
 ['practice',r=>r.unrankedPractice=true],
 ['replay',r=>r._replayTape={}],
 ['takeover',r=>r.takeover={}],
 ['gym',r=>r.bsodGym=true],
 ['daily',r=>r.dailyOfficial=true],
 ['modified',r=>r.modded=true],
 ['upgrade',r=>r.upgradeRun.enabled=true],
 ['boost',r=>r.appliedBoosts=['headStart']],
 ['magnet',r=>r.magnetsDrop=true],
 ['Kodiak',r=>r.kodiaksOn=true],
 ['tick zero',r=>r.simClock.tick=0],
 ['missing recorder',r=>r.ghostRecorder=null],
])('%s cannot initiate an official one-use Suspend',(_,modify)=>{
 const r=eligible();modify(r);
 expect(()=>captureManualPauseCandidate(r,{})).toThrow('suspend:unsupported-active-run');
 expect(r._manualPausePending).toBe(true);
});

test('capture failure cannot leave a paused original run with its guard cleared',()=>{
 const r=eligible();
 // Valid manual pause but incomplete native runtime must fail capture.
 expect(()=>captureManualPauseCandidate(r,{})).toThrow();
 expect(r._manualPausePending).toBe(true);
 expect(r.simClock.tick).toBe(481);
});

test('malformed caller or absent scene fails before attempting a capture',()=>{
 expect(()=>captureManualPauseCandidate(null,{})).toThrow('suspend:unsupported-active-run');
 const r=eligible();r.scene=null;
 expect(()=>captureManualPauseCandidate(r,{})).toThrow('suspend:manual-pause-required');
});

/** A rejected mode must never enter the async identity/IDB phase. In particular,
 * changing a live run to an unsupported mode between opening Pause and clicking
 * Suspend must not create a READY slot or retire the existing paused scene.
 */
test.each([
 ['crashed',r=>r.crashed=true],
 ['unranked practice',r=>r.unrankedPractice=true],
 ['tape replay',r=>r.tapePlayer={}],
 ['replay source',r=>r._replayTape={}],
 ['replay takeover',r=>r.takeover={}],
 ['coach simulation',r=>r.coachSim={}],
 ['guest practice',r=>r.guestPractice=true],
 ['BSOD Gym',r=>r.bsodGym=true],
 ['official daily',r=>r.dailyOfficial=true],
 ['modded run',r=>r.modded=true],
 ['purchased upgrade',r=>r.upgradeRun.enabled=true],
 ['applied boost',r=>r.appliedBoosts=['headStart']],
 ['magnet modifier',r=>r.magnetsDrop=true],
 ['Kodiak modifier',r=>r.kodiaksOn=true],
 ['zero tick',r=>r.simClock.tick=0],
 ['negative tick',r=>r.simClock.tick=-1],
 ['fractional tick',r=>r.simClock.tick=481.5],
 ['missing clock',r=>r.simClock=null],
 ['missing recorder',r=>r.ghostRecorder=null],
])('unsupported %s never reaches storage and leaves the real run paused',async(_,modify)=>{
 const run=eligible();
 modify(run);
 const rejectedTick=run.simClock?.tick;
 const identity=jest.fn(async()=>{throw Error('identity must not be inspected');});
 const slot={put:jest.fn(async()=>{throw Error('storage must not be touched');})};
 const pause={scene:{get:key=>key==='RunScene'?run:null,
  isActive:key=>key==='PauseScene'}};
 expect(canCaptureManualPauseCandidate(run)).toBe(false);
 await expect(suspendManualRun(pause,{}, {slot,loadIdentity:identity}))
  .resolves.toEqual({ok:false,code:'suspend-refused'});
 expect(identity).not.toHaveBeenCalled();
 expect(slot.put).not.toHaveBeenCalled();
 expect(run._manualPausePending).toBe(true);
 expect(run.scene.isPaused('RunScene')).toBe(true);
 expect(run.simClock?.tick).toBe(rejectedTick);
});

test('closed Pause refuses even a stock run without a storage call',async()=>{
 const run=eligible(),slot={put:jest.fn()},identity=jest.fn();
 const pause={scene:{get:()=>run,isActive:()=>false}};
 await expect(suspendManualRun(pause,{}, {slot,loadIdentity:identity}))
  .resolves.toEqual({ok:false,code:'not-manually-paused'});
 expect(identity).not.toHaveBeenCalled();
 expect(slot.put).not.toHaveBeenCalled();
});
