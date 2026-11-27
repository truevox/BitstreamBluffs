import {canCaptureManualPauseCandidate} from '../../src/systems/savestate/pausedCandidate.js';
import {suspendManualRun,resumeManualRun,peekManualSuspend,discardManualSuspend} from '../../src/systems/savestate/manualSuspendController.js';

const eligible=()=>({
 crashed:false,unrankedPractice:false,tapePlayer:null,_replayTape:null,
 takeover:null,coachSim:null,guestPractice:false,bsodGym:false,dailyOfficial:false,
 modded:false,upgradeRun:{enabled:false},magnetsDrop:false,kodiaksOn:false,
 appliedBoosts:[],simClock:{tick:181},ghostRecorder:{lastTick:181},
 _manualPausePending:true,scene:{isPaused:key=>key==='RunScene'},
});
test('SUSPEND action requires a real eligible paused source and original GhostTape',()=>{
 expect(canCaptureManualPauseCandidate(eligible())).toBe(true);
 for(const mutation of [r=>r.upgradeRun.enabled=true,r=>r._manualPausePending=false,
  r=>r.ghostRecorder=null,r=>r.scene.isPaused=()=>false,r=>r.dailyOfficial=true,
  r=>r.modded=true,r=>r.crashed=true,r=>r.tapePlayer={}]){
  const run=eligible();mutation(run);expect(canCaptureManualPauseCandidate(run)).toBe(false);
 }
});
test('manual suspend refuses inactive pause without even opening IndexedDB',async()=>{
 const run=eligible(),slot={put:()=>{throw Error('NEVER WRITE');}};
 const scene={get:()=>run,isActive:()=>false};
 expect(await suspendManualRun({scene},null,{slot})).toEqual({ok:false,code:'not-manually-paused'});
});
test('manual resume refuses non-Title scene, never claims existing slot',async()=>{
 const slot={claim:()=>{throw Error('NEVER CLAIM');}};
 const game={scene:{isActive:()=>false}};
 const scene={isActive:()=>false};
 expect(await resumeManualRun({scene,game},null,{slot})).toEqual({ok:false,code:'title-required'});
});
test('READONLY peek preserves incompatible and unavailable statuses',async()=>{
 const incompatible={ok:false,status:'incompatible',code:'build-mismatch'};
 expect(await peekManualSuspend({slot:{peek:async()=>incompatible},loadIdentity:async()=>({})})).toEqual(incompatible);
 expect(await peekManualSuspend({slot:{peek:async()=>{throw Error('privacy denied');}},loadIdentity:async()=>({})}))
  .toEqual({ok:false,status:'unavailable',code:'storage-unavailable'});
});
test('explicit discard delegates to atomic READY-only clear and propagates claim failure',async()=>{
 const claimed={ok:false,code:'slot-claimed'};
 expect(await discardManualSuspend({slot:{clearReady:async()=>claimed}})).toEqual(claimed);
 expect(await discardManualSuspend({slot:{clearReady:async()=>({ok:true,cleared:true})}}))
  .toEqual({ok:true,cleared:true});
 expect(await discardManualSuspend({slot:{clearReady:async()=>{throw Error('storage blocked');}}}))
  .toEqual({ok:false,code:'storage-unavailable'});
});
