import {captureManualPauseCandidate} from '../../src/systems/savestate/pausedCandidate.js';

const eligible=()=>({
 crashed:false,unrankedPractice:false,tapePlayer:null,_replayTape:null,
 takeover:null,coachSim:null,guestPractice:false,bsodGym:false,
 dailyOfficial:false,modded:false,upgradeRun:{enabled:false},
 biomeMask:0,magnetsDrop:false,kodiaksOn:false,appliedBoosts:[],
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
 ['nonbase biome',r=>r.biomeMask=1],
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
