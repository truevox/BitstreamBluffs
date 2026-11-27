/**
 * #119 local, single-use pause -> Title -> native RunScene continuation.
 *
 * This is NOT a public Verified issuer or proof of human play. The blob is
 * app-local, exact-build, typed and independently hash-bound, but its bytes
 * and the browser's IndexedDB are still under player control.
 *
 * The claim holder owns the only consume/release operation. Title stays
 * active throughout an isolated, paused, hidden RunScene preparation; no
 * gameplay start is published before the successful consume transaction.
 */
import {parseCanonical} from '../replay/canonicalJson.js';
import {LocalSuspendSlot,withSuspendResumeLock} from './localSuspendSlot.js';
import {captureManualPauseCandidate} from './pausedCandidate.js';
import {candidateSuspendEnvelopeBytes,candidateSuspendLayout,inspectCandidateSuspendEnvelope} from './candidateSuspendEnvelope.js';
import {loadCurrentBuildDescriptor} from './runtimeIdentity.js';
import {createCandidateStateCodec} from './candidateState.js';
import {armPrivateRunSceneStage} from './privateStageOwnership.js';
import {DailyPatch} from '../DailyPatch.js';
import {enabledBiomeMask} from '../ProfileStore.js';
import {SCENES,REG} from '../../constants.js';
import {EVT} from '../../events.js';

const fail=(code)=>({ok:false,code});
const ids=[REG.SEED,REG.BIOME_MASK,REG.DAILY_OFFICIAL,REG.DAILY_MODE,REG.BSOD_GYM,
 REG.GUEST_PRACTICE,REG.GHOST_REPLAY,REG.TAKEOVER];
const snapshotRegistry=r=>new Map(ids.map(k=>{const value=r.get(k);return [k,{exists:value!==undefined,value}];}));
function restoreRegistry(r,saved){
 for(const [key,s] of saved){
  if(s.exists)r.set(key,s.value);
  else r.remove?.(key);
 }
}
function configureStockResume(reg,seed){
 const existingSeed=reg.get(REG.SEED),existingMask=reg.get(REG.BIOME_MASK);
 const defs=Object.values(reg.get(REG.CONTENT)?.biomes||{});
 const day=DailyPatch.dateKeyFromSeed(seed);
 const mask=existingSeed===seed&&Number.isSafeInteger(existingMask)&&existingMask>=0
  ? existingMask
  : day?DailyPatch.infoForDateKey(day).biomeMask
    :enabledBiomeMask(reg.get(REG.PROFILE),defs);
 reg.set(REG.SEED,seed);
 reg.set(REG.BIOME_MASK,mask>>>0);
 reg.set(REG.DAILY_OFFICIAL,false);
 reg.set(REG.DAILY_MODE,'classic');
 reg.set(REG.BSOD_GYM,false);
 for(const key of [REG.GUEST_PRACTICE,REG.GHOST_REPLAY,REG.TAKEOVER])reg.remove?.(key);
}

/** Store only a real paused, stock, unmodified run. Navigation belongs to UI. */
export async function suspendManualRun(pause,Phaser,{slot=new LocalSuspendSlot(),
 loadIdentity=loadCurrentBuildDescriptor}={}){
 const run=pause?.scene?.get?.(SCENES.RUN);
 if(!run||pause?.scene?.isActive?.(SCENES.PAUSE)!==true||
  run.scene?.isPaused?.(SCENES.RUN)!==true)return fail('not-manually-paused');
 try{
  const candidate=captureManualPauseCandidate(run,Phaser);
  const identity=await loadIdentity();
  if(pause.scene.isActive(SCENES.PAUSE)!==true||
   run.scene.isPaused(SCENES.RUN)!==true)return fail('pause-was-closed');
  const manifest=candidateSuspendEnvelopeBytes(candidate,identity);
  const stored=await slot.put(manifest,identity,candidateSuspendLayout);
  if(!stored.ok)return fail(stored.code);
  return {ok:true,runId:stored.runId,tick:stored.tick,bytes:stored.bytes,
   admission:'local-one-use-only'};
 }catch(e){
  return fail('suspend-refused');
 }
}

/** Restore into a PRIVATE fresh scene. Failure never publishes the stage. */
async function resumeManualRunLocked(title,Phaser,{slot=new LocalSuspendSlot(),
 loadIdentity=loadCurrentBuildDescriptor,createCodec=createCandidateStateCodec,
 armStage=armPrivateRunSceneStage,leaseProof=null}={}){
 if(!title?.scene?.isActive?.(SCENES.TITLE)||title.game?.scene?.isActive?.(SCENES.RUN))
  return fail('title-required');
 let token=null,stage=null,arm=null,consumed=false,originalRegistry=null;
 const reg=title.registry,game=title.game;
 try{
  const identity=await loadIdentity();
  if(!title.scene.isActive(SCENES.TITLE))return fail('title-left');
  const claim=await slot.claim(identity,candidateSuspendLayout,{leaseProof});
  if(!claim.ok)return fail(claim.code);
  token=claim.token;
  const inspected=inspectCandidateSuspendEnvelope(claim.bytes,identity);
  if(!inspected.ok||inspected.admission!=='envelope-only')throw Error('admission-rejected');
  const source=parseCanonical(inspected.candidateBytes);
  if(source.runId!==claim.runId||source.tick!==claim.tick||!source.seed)
   throw Error('candidate-header-mismatch');
  originalRegistry=snapshotRegistry(reg);
  configureStockResume(reg,source.seed);
  if(!title.scene.isActive(SCENES.TITLE))throw Error('title-left');
  arm=armStage(game);
  game.scene.start(SCENES.RUN);
  stage=await arm.ready;
  if(!title.scene.isActive(SCENES.TITLE)||!stage.sys?.isPaused?.()||
   stage.sys.settings.visible||stage.simClock?.tick!==0)
   throw Error('private-stage-not-quiescent');
  // The full native candidate schema and captured CONFIG digest are checked
  // against the brand-new world before we mutate the stage.
  const codec=createCodec(Phaser),prepared=codec.prepare(stage,inspected.candidateBytes);
  const res=codec.restore(stage,inspected.candidateBytes);
  if(stage.simClock?.tick!==claim.tick||stage.runId!==claim.runId||
   res?.exact===false||res?.calls>0||!prepared?.world)
   throw Error('native-restore-mismatch');
  if(!title.scene.isActive(SCENES.TITLE)||!stage.sys.isPaused())
   throw Error('stage-escaped-before-commit');
  const done=await slot.consume(token);
  if(!done.ok||done.consumed!==true)throw Error('one-use-consume-refused');
  consumed=true;
  token=null;
  // Commit only AFTER local one-use consumption. No other scene gets a
  // precommit RUN_START, no unverified status is issued by this flow.
  // Past this boundary the one-use blob has irreversibly been consumed.
  // An unrelated observer or HUD callback MUST NOT enter the precommit
  // rollback path and discard the only surviving run.
  const issues=[];
  try{title.scene.stop(SCENES.TITLE);}catch{issues.push('title-stop');}
  try{stage.sys.setVisible(true);}catch{issues.push('stage-visibility');}
  try{stage.scene.launch(SCENES.UI);}catch{issues.push('hud-activation');}
  try{stage.sys.resume();stage.inputRouter?.setEnabled?.(true);}
  catch{issues.push('stage-resume');}
  try{game.events.emit(EVT.RUN_START,{
   runId:stage.runId,seed:stage.seed,dailyRuleId:stage.dailyRuleId,startedAt:stage.startedAt,
   dailyOfficial:false,dailyMode:stage.dailyMode,gym:false,practice:stage.unrankedPractice===true,
   resumed:true,
  });}catch{issues.push('run-start-observer');}
  return {ok:true,runId:stage.runId,tick:stage.simClock.tick,consumed:true,
   admission:'local-one-use-only',...(issues.length?{warning:'postcommit-observer-warning'}:{})};
 }catch(e){
  // A consumed slot is irreversible: NEVER destroy a successfully restored
  // stage or pretend its unique snapshot can be reclaimed again.
  if(consumed){
   try{stage?.sys?.setVisible?.(true);stage?.sys?.resume?.();}catch{}
   return {ok:true,consumed:true,warning:'postcommit-recovery',admission:'local-one-use-only'};
  }
  // Failed stage is disposable. ALWAYS remove mutated RunScene + HUD before
  // the original exact holder releases its claim for a later retry.
  try{game.scene.stop(SCENES.UI);}catch{}
  try{if(stage||game.scene.isActive(SCENES.RUN))game.scene.stop(SCENES.RUN);}catch{}
  arm?.cancel?.();
  if(originalRegistry&&!consumed)restoreRegistry(reg,originalRegistry);
  let released=true;
  if(token){
   try{const r=await slot.release(token);released=r.ok&&r.released===true;}
   catch{released=false;}
  }
  return fail(!released?'claim-held-after-failure':'native-restore-refused');
 }
}

/** An exclusive browser lock covers the WHOLE native restore transaction.
 * No lock support = old fail-closed protocol (no crash recovery). A second
 * active tab gets a non-mutating rejection, never a second resume.
 */
export async function resumeManualRun(title,Phaser,options={}){
 return withSuspendResumeLock(leaseProof=>
  resumeManualRunLocked(title,Phaser,{...options,leaseProof}));
}

/** Deliberately requested by the player from a claimed Title slot.
 * Reclaim only claims that were created under a Web Lock AND when no other
 * tab still holds that same lock. Never auto-run after claim recovery.
 */
export async function recoverInterruptedManualSuspend({slot=new LocalSuspendSlot()}={}){
 return withSuspendResumeLock(async leaseProof=>{
  if(!leaseProof)return fail('recovery-lock-unavailable');
  return slot.recoverInterrupted({leaseProof});
 });
}

/** Explicit user-requested deletion of a READY save only. The slot's
 * atomic clearReady() refuses any existing claim, even a stale one. Only a
 * confirmed Title UI action may call this; never do it during peek or error.
 */
export async function discardManualSuspend({slot=new LocalSuspendSlot()}={}){
 try{return await slot.clearReady();}
 catch{return fail('storage-unavailable');}
}

/** Read-only status: never claims or repairs the slot on Title. */
export async function peekManualSuspend({slot=new LocalSuspendSlot(),
 loadIdentity=loadCurrentBuildDescriptor}={}){
 try{
  const identity=await loadIdentity();
  return await slot.peek(identity,candidateSuspendLayout);
 }catch{return {ok:false,status:'unavailable',code:'storage-unavailable'};}
}
