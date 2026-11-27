import {captureManualPauseCandidate,canCaptureManualPauseCandidate,manualSuspendUnavailableReason} from '../../src/systems/savestate/pausedCandidate.js';

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

// Player-facing reason and the authoritative guard MUST stay coupled: no
// unsupported state can be accidentally represented as an eligible save.
test.each([
 ['CRASHED RUN',r=>r.crashed=true],
 ['UNRANKED PRACTICE',r=>r.unrankedPractice=true],
 ['REPLAY MODE',r=>r.tapePlayer={}],
 ['REPLAY TAKEOVER',r=>r.takeover={}],
 ['COACH SIMULATION',r=>r.coachSim={}],
 ['GUEST PRACTICE',r=>r.guestPractice=true],
 ['BSOD GYM',r=>r.bsodGym=true],
 ['OFFICIAL DAILY',r=>r.dailyOfficial=true],
 ['MODDED RUN',r=>r.modded=true],
 ['UPGRADED RUN',r=>r.upgradeRun.enabled=true],
 ['MAGNETS ENABLED',r=>r.magnetsDrop=true],
 ['KODIAKS ENABLED',r=>{r.magnetsDrop=true;r.kodiaksOn=true;}],
 ['BOOSTED RUN',r=>r.appliedBoosts=['headStart']],
 ['INVALID RUN TICK',r=>r.simClock.tick=0],
 ['NO GHOST RECORDER',r=>r.ghostRecorder=null],
 ['MANUAL PAUSE REQUIRED',r=>r._manualPausePending=false],
 ['MANUAL PAUSE REQUIRED',r=>r.scene.isPaused=()=>false],
])('reason %s matches actual Suspend refusal without mutating the source',(_,change)=>{
 const r=eligible();change(r);
 const before={guard:r._manualPausePending,tick:r.simClock.tick,recorder:r.ghostRecorder};
 expect(manualSuspendUnavailableReason(r)).toBe(_);
 expect(canCaptureManualPauseCandidate(r)).toBe(false);
 expect(r._manualPausePending).toBe(before.guard);
 expect(r.simClock.tick).toBe(before.tick);
 expect(r.ghostRecorder).toBe(before.recorder);
});

test('eligible manual pause has no restriction, and missing run is explained',()=>{
 const r=eligible();
 expect(manualSuspendUnavailableReason(r)).toBeNull();
 expect(canCaptureManualPauseCandidate(r)).toBe(true);
 expect(manualSuspendUnavailableReason(null)).toBe('NO ACTIVE RUN');
 expect(canCaptureManualPauseCandidate(null)).toBe(false);
});
