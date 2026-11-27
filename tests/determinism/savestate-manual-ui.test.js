import {canCaptureManualPauseCandidate} from '../../src/systems/savestate/pausedCandidate.js';
import {suspendManualRun,resumeManualRun,peekManualSuspend,discardManualSuspend,backupManualSuspend} from '../../src/systems/savestate/manualSuspendController.js';

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

// #424: unsupported configurations must fail BEFORE identity fetch or IDB write.
// This protects the paused player's source while upgraded/special-mode native
// restore fixtures remain unapproved for one-use player continuation.
test.each([
 ['purchased upgrade',r=>r.upgradeRun.enabled=true],
 ['official daily',r=>r.dailyOfficial=true],
 ['practice',r=>r.unrankedPractice=true],
 ['gym',r=>r.bsodGym=true],
 ['guest practice',r=>r.guestPractice=true],
 ['ghost replay',r=>r.tapePlayer={}],
 ['recorded replay',r=>r._replayTape={}],
 ['takeover',r=>r.takeover={}],
 ['coach simulation',r=>r.coachSim={}],
 ['modified content',r=>r.modded=true],
 ['active boost',r=>r.appliedBoosts=['test']],
 ['magnet drop',r=>r.magnetsDrop=true],
 ['Kodiak',r=>r.kodiaksOn=true],
 ['crashed run',r=>r.crashed=true],
 ['missing recorder',r=>r.ghostRecorder=null],
 ['zero tick',r=>r.simClock.tick=0],
 ['fractional tick',r=>r.simClock.tick=181.5],
 ['invalid tick',r=>r.simClock.tick=NaN],
 ['unpaused run',r=>r.scene.isPaused=()=>false],
 ['not manually paused',r=>r._manualPausePending=false],
])('unsupported %s leaves source state intact and never writes a slot',async(_,mutate)=>{
 const run=eligible();mutate(run);
 const initialTick=run.simClock.tick,initialRun=run.ghostRecorder;
 const scene={get:()=>run,isActive:key=>key==='PauseScene'};
 const pause={scene};
 let writes=0,identities=0;
 const result=await suspendManualRun(pause,null,{
  slot:{put:async()=>{writes++;throw Error('IDB must never be touched');}},
  loadIdentity:async()=>{identities++;throw Error('identity must never be loaded');},
 });
 expect(result.ok).toBe(false);
 expect(result.code).toBe(_==='unpaused run'?'not-manually-paused':'suspend-refused');
 expect(writes).toBe(0);
 expect(identities).toBe(0);
 expect(run.simClock.tick).toBe(initialTick);
 expect(run.ghostRecorder).toBe(initialRun);
 expect(run.scene.isPaused('RunScene')).toBe(_==='unpaused run'?false:true);
 expect(scene.isActive('PauseScene')).toBe(true);
});

test('manual backup delegates only to nonclaiming READY reader; errors keep original save',async()=>{
 const bytes=Uint8Array.of(1,2,3);
 expect(await backupManualSuspend({slot:{backupReady:async()=>({ok:true,bytes,admission:'inert-local-backup-only'})}}))
  .toEqual({ok:true,bytes,admission:'inert-local-backup-only'});
 expect(await backupManualSuspend({slot:{backupReady:async()=>{throw Error('denied');}}}))
  .toEqual({ok:false,code:'storage-unavailable'});
});
