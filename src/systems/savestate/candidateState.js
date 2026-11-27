/** #119 canonical single-file candidate composition, intentionally INERT.
 * This file is not a registered savestate layout or a player slot admission.
 * It prepares a detached internal reconstruction projection; does NOT
 * mutate a scene, activate a candidate, authorize a score or accept files
 * from arbitrary origins. Exact-build and independent replay remain required.
 */
import {canonicalBytes,parseCanonical,asUint8Array} from '../replay/canonicalJson.js';
import {digestOf} from '../replay/canonicalSha256.js';
import {CURRENT_RULESET_ID} from '../replay/currentRulesetId.js';
import {SIM_REVISION} from '../replay/ruleset.js';
import {encodeMatterState,decodeMatterState} from './matterState.js';
import {encodeEntityState,decodeEntityState,ENTITY_STATE_FIELDS} from './entityState.js';
import {encodeSceneSubsystemState,decodeSceneSubsystemState,SCENE_SUBSYSTEM_FIELDS} from './sceneSubsystemState.js';
import {captureTerrainState,restoreTerrainState} from './terrainState.js';
import {encodeSceneRemainderState,decodeSceneRemainderState} from './sceneRemainderState.js';
import {restoreRecorderState} from './recorderState.js';
import {createNativeRunSceneRestoreKit} from './RunSceneRestoreKit.js';
import {validateSectionBindings} from './sectionBindings.js';
import {magnetSpawn} from '../ShardMagnet.js';
import {PIXELS_PER_METER} from '../../constants.js';

const KIND='bb-internal-candidate-file',VERSION=1;
const EARLY=['simClock','runRandom','terrain','_chunkQueue'];
const SECTION_KEYS=['clock','rng','recorder','terrain','matter','entities','subsystems','remainder'];
const HEADER=['kind','version','runId','tick','buildId','rulesetId','simRevision','seed','sections'];
const need=(v,p)=>{if(!v)throw Error('candidate-state:'+p);};
const hash=v=>typeof v==='string'&&/^sha256:[0-9a-f]{64}$/.test(v);
const uint=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
function exact(o,keys,p){
 need(o&&typeof o==='object'&&!Array.isArray(o)&&[null,Object.prototype].includes(Object.getPrototypeOf(o)),p);
 const d=Object.getOwnPropertyDescriptors(o),own=Reflect.ownKeys(d);
 need(own.length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k].enumerable&&Object.hasOwn(d[k],'value')),p);
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
const base=c=>({runId:c.runId,tick:c.tick,buildId:c.buildId});
const scene=c=>({...base(c),seed:c.seed});
const recorder=c=>({...base(c),rulesetId:c.rulesetId,simRevision:c.simRevision});
const keysOf=Object.keys;
const typed=bytes=>parseCanonical(bytes);
const bytes=canonicalBytes;
function identity(c,run){
 need(typeof c.runId==='string'&&/^[A-Za-z0-9_.:-]{1,96}$/.test(c.runId)&&uint(c.tick)&&c.tick>0&&
  hash(c.buildId)&&c.buildId===run.registry?.get('currentBuildId')&&c.rulesetId===CURRENT_RULESET_ID&&
  c.simRevision===SIM_REVISION&&typeof c.seed==='string'&&c.seed===run.seed,'identity');
}
function validateSpecialSpawns(run,game,preparedTerrain){
 const generator=run.createTerrainGenerator();
 for(const [chunk,list] of game.powerups.__map)for(const p of list.__arr){
  const v=p.__obj;
  if(!v.key.endsWith(':magnet'))continue;
  const def=run.content.powerups.shardMagnet,source=preparedTerrain.terrain.active.get(chunk);
  need(run.magnetsDrop===true&&def&&source,'magnet-config');
  const want=magnetSpawn(run.seed,source,def,x=>generator.heightAt(x),PIXELS_PER_METER,run.upgradeFx?.magnetSpawnMul);
  const got=v.spawn.__obj;
  need(want&&got?.defId===want.defId&&Object.is(got.x,want.x)&&Object.is(got.y,want.y),'magnet-placement');
 }
 const effect=game.magnetEff;
 if(effect!==null){
  need(game.magnetId==='shardMagnet'&&effect.__content==='/powerups/shardMagnet/effect'&&
   run.content.powerups.shardMagnet?.effect,'magnet-effect');
 }
}
export function createCandidateStateCodec(Phaser){
 const kit=createNativeRunSceneRestoreKit(Phaser),Matter=Phaser.Physics.Matter.Matter;
 return Object.freeze({
  capture(run){
   const s=kit.capture(run),c={...s.ctx,seed:run.seed};
   identity(c,run);
   const {world}=s,game=world.game;
   const omitted=new Set([...EARLY,...ENTITY_STATE_FIELDS,...SCENE_SUBSYSTEM_FIELDS]);
   const remainder=Object.fromEntries(Object.entries(game).filter(([k])=>!omitted.has(k)));
   const sections={
    clock:s.clock,rng:s.rng,recorder:world.recorder,
    terrain:typed(captureTerrainState(run.terrain,run._chunkQueue,[...run.mesh.chunks.keys()],base(c))),
    matter:typed(encodeMatterState(world.matter,base(c),Matter)),
    entities:typed(encodeEntityState(game,{...base(c),randomId:game.runRandom.__id})),
    subsystems:typed(encodeSceneSubsystemState(game,scene(c))),
    remainder:typed(encodeSceneRemainderState(remainder,{camera:world.camera,telegraph:world.telegraph,ghost:world.ghost,
     fingerprint:s.fingerprint,config:world.config},scene(c))),
   };
   // Capture must also bind the live section graph, without mutating it.
   validateSectionBindings(game,world.matter,world.meshOrder,world.telegraph);
   const unsigned={kind:KIND,version:VERSION,...c,sections};
   return bytes({...unsigned,integrity:digestOf(unsigned)});
  },
  prepare(run,file){
   need(run.simClock?.tick===0&&run.ghostRecorder?.lastTick===0,'fresh-candidate');
   const f=exact(parseCanonical(asUint8Array(file,'candidate file')),[...HEADER,'integrity'],'file');
   const {integrity,...unsigned}=f;
   need(f.kind===KIND&&f.version===VERSION&&hash(integrity)&&digestOf(unsigned)===integrity,'integrity');
   const c={runId:f.runId,tick:f.tick,buildId:f.buildId,rulesetId:f.rulesetId,simRevision:f.simRevision,seed:f.seed};
   identity(c,run);
   const s=exact(f.sections,SECTION_KEYS,'sections');
   need(s.clock?.tick===c.tick,'clock-tick');
   // Strict native recorder validation is performed into a detached object,
   // not just envelope shape inspection or a record supplied by a file.
   restoreRecorderState(bytes(s.recorder),run.ghostRecorder,recorder(c));
   const terrain=restoreTerrainState(bytes(s.terrain),run.createTerrainGenerator().options,base(c));
   const early=kit.projectEarly(run,s.clock,s.rng,terrain.terrain,terrain.queue,[]);
   const entities=decodeEntityState(bytes(s.entities),{...base(c),randomId:early.runRandom.__id});
   need(entities.collectedPowerups.__id===early.collectedPowerups.__id,'collected-id');
   delete early.collectedPowerups;
   const subsystems=decodeSceneSubsystemState(bytes(s.subsystems),scene(c));
   const config=kit.projectConfig(run),rest=decodeSceneRemainderState(bytes(s.remainder),scene(c),config);
   const matter=decodeMatterState(bytes(s.matter),base(c),Matter);
   const sections=[early,entities,subsystems,rest.game],all=sections.flatMap(keysOf);
   need(new Set(all).size===all.length,'field-overlap');
   const game=Object.assign({},...sections);
   validateSectionBindings(game,matter,terrain.meshOrder,rest.telegraph);
   validateSpecialSpawns(run,game,terrain);
   return {kind:'bb-internal-native-world-candidate',version:1,ctx:recorder(c),clock:s.clock,rng:s.rng,
    fingerprint:rest.fingerprint,world:{kind:'bb-runscene-diagnostic-snapshot',version:1,diagnosticOnly:true,
     ghost:rest.ghost,game,telegraph:rest.telegraph,matter,camera:rest.camera,meshOrder:terrain.meshOrder,pool:[],
     config,classes:{SIM:all,unclassified:[]},audit:[],skipped:0,recorder:s.recorder}};
  },
  /** Internal caller only; destination must be disposable and isolated.
   * Production transaction and registration deliberately not implemented here. */
  restore(run,file){return kit.restore(run,this.prepare(run,file));},
 });
}
