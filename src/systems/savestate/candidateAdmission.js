/** Local exact-build envelope-only registration for the typed candidate.
 * All eight sections are parsed and structurally validated here. This
 * deliberately does not regenerate terrain, authorize a run, or publish
 * a scene; the separate prepare/restore gate must still do that.
 */
import {canonicalBytes,parseCanonical,asUint8Array} from '../replay/canonicalJson.js';
import {digestOf} from '../replay/canonicalSha256.js';
import {SimClock} from '../SimClock.js';
import {runRandomStreams} from '../RunRandom.js';
import {restoreSimClockState,restoreRunRandomState} from './primitiveState.js';
import {decodeRecorderState} from './recorderState.js';
import {inspectTerrainState} from './terrainState.js';
import {decodeMatterState} from './matterState.js';
import {decodeEntityState} from './entityState.js';
import {decodeSceneSubsystemState} from './sceneSubsystemState.js';
import {inspectSceneRemainderState} from './sceneRemainderState.js';
import {SAVESTATE_LAYOUT_DESCRIPTOR} from './layoutDeclaration.js';
import {savestateLayoutIdOf} from './layout.js';
import {snapshotEnvelopeBytes,inspectSnapshotEnvelope} from './envelope.js';

const SECTION_KEYS=['clock','rng','recorder','terrain','matter','entities','subsystems','remainder'];
const HEADER=['kind','version','runId','tick','buildId','rulesetId','simRevision','seed','sections','integrity'];
const hash=v=>typeof v==='string'&&/^sha256:[0-9a-f]{64}$/.test(v);
const uint=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const need=(v,p)=>{if(!v)throw Error('candidate-admission:'+p);};
const exact=(v,keys,p)=>{
 need(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),p);
 return v;
};
/** Matter is trusted shipped code. All state targets below are newly
 * constructed pure objects, never game/scene objects. The outer envelope
 * parser has already bounded and frozen the complete data tree. */
export function validateCandidateSections(sections,envelope,Matter){
 exact(sections,['candidate'],'sections');
 const f=exact(sections.candidate,HEADER,'header'),{integrity,...unsigned}=f;
 const b=envelope.build;
 need(f.kind==='bb-internal-candidate-file'&&f.version===1&&hash(integrity)&&digestOf(unsigned)===integrity,'checksum');
 need(f.runId===envelope.runId&&f.tick===envelope.tick&&uint(f.tick)&&f.tick>0&&
  f.buildId===b.buildId&&f.rulesetId===b.physicsIdentity.rulesetId&&f.simRevision===b.physicsIdentity.simRevision&&
  typeof f.seed==='string'&&f.seed.length>0&&f.seed.length<=256,'identity');
 need(Matter?.version===b.matterVersion,'matter-version');
 const s=exact(f.sections,SECTION_KEYS,'candidate-sections'),base={runId:f.runId,tick:f.tick,buildId:f.buildId},
  scene={...base,seed:f.seed};
 need(s.clock?.tick===f.tick,'clock-tick');
 restoreSimClockState(new SimClock(),s.clock);
 restoreRunRandomState(runRandomStreams(f.seed),s.rng);
 const recorder=decodeRecorderState(canonicalBytes(s.recorder),{...base,rulesetId:f.rulesetId,simRevision:f.simRevision});
 need(recorder.header.seed===f.seed,'recorder-seed');
 // The graph root IDs are generated in a fixed order (clock=0, RNG=1).
 // The complete runtime must still regenerate terrain and bind every alias.
 const entities=decodeEntityState(canonicalBytes(s.entities),{...base,randomId:1});
 const sub=decodeSceneSubsystemState(canonicalBytes(s.subsystems),scene);
 const rest=inspectSceneRemainderState(canonicalBytes(s.remainder),scene);
 inspectTerrainState(canonicalBytes(s.terrain),base);
 const matter=decodeMatterState(canonicalBytes(s.matter),base,Matter);
 // Reject duplicate node IDs even before regeneration. Do NOT treat external
 // terrain aliases as validated here (requires the actual trusted recipe).
 const ids=new Set([0,1]),pending=[entities,sub,rest.game];
 while(pending.length){
  const n=pending.pop();if(!n||typeof n!=='object')continue;
  if(Object.hasOwn(n,'__id')){need(!ids.has(n.__id),'duplicate-node');ids.add(n.__id);}
  for(const v of Object.values(n))pending.push(v);
 }
 need(Object.hasOwn(matter.bodies,'sled'),'sled-body');
 return true;
}
export function createCandidateLayoutRegistration(Matter){
 need(Matter?.version==='0.20.0','matter-version');
 return Object.freeze({descriptor:SAVESTATE_LAYOUT_DESCRIPTOR,
  validateSections:(sections,envelope)=>validateCandidateSections(sections,envelope,Matter)});
}
export function sealSuspendCandidate(file,identity,layout){
 const candidate=parseCanonical(asUint8Array(file,'candidate file'));
 const bytes=snapshotEnvelopeBytes({kind:'bb-savestate-cache',version:1,purpose:'suspend',
  build:identity,runId:candidate.runId,tick:candidate.tick,payload:{sections:{candidate}}});
 const admitted=inspectSnapshotEnvelope(bytes,identity,layout);
 need(admitted.ok&&admitted.admission==='envelope-only','envelope:'+admitted.code);
 return bytes;
}
export function openSuspendCandidate(bytes,identity,layout){
 const result=inspectSnapshotEnvelope(asUint8Array(bytes,'suspend envelope'),identity,layout);
 need(result.ok&&result.admission==='envelope-only'&&result.envelope.purpose==='suspend','envelope:'+result.code);
 const f=result.envelope.payload.sections.candidate;
 return {file:canonicalBytes(f),runId:f.runId,tick:f.tick,seed:f.seed};
}
