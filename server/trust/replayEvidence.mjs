/** Server-side evidence preparation and comparison. No signing, network or human attestation. */
import {validateEvidenceBundle} from '../../src/systems/replay/manifest.js';
import {f64Decode} from '../../src/systems/replay/canonicalJson.js';
import {digestOf} from '../../src/systems/replay/canonicalSha256.js';

const decodePose=row=>row.map(f64Decode);

export function prepareReplayEvidence(bytes,{rulesetId,ruleset}){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>16*1024*1024)return {ok:false,reason:'invalid-evidence'};
 if(digestOf(ruleset)!==rulesetId)throw Error('trusted ruleset mismatch');
 const resolver=id=>id===rulesetId?ruleset:null;
 const v=validateEvidenceBundle(bytes,resolver);
 if(!v.ok||v.outcome!=='valid')return {ok:false,reason:'invalid-evidence',detail:v.code??v.reasons};
 const b=v.bundle,c=b.manifest.causal;
 if(c.sim.rulesetId!==rulesetId||b.manifest.info.provenance!=='live-recording'||
    b.manifest.info.lane.mode!=='normal'||c.input.edgeRows!=='every-tick'||c.checkpoints.detail!=='combined'||
    !c.kodiak||c.input.endTick<120||c.input.endTick>40000||!b.exact?.sled)
  return {ok:false,reason:'unsupported-evidence'};
 const ticks=Array.from({length:Math.floor(c.input.endTick/120)},(_,i)=>(i+1)*120);
 if(JSON.stringify(b.checkpoints.map(x=>x[0]))!==JSON.stringify(ticks)||
    JSON.stringify(b.exact.sled.map(x=>x[0]))!==JSON.stringify(ticks))
  return {ok:false,reason:'incomplete-checkpoints'};
 const tape={seed:c.course.seed,biomeMask:c.course.biomeMask,dailyRuleId:c.course.dailyRuleId,
    syncLevel:c.bsod.syncLevel,magnetsDrop:c.loadout.magnetsDrop,kodiaksOn:c.kodiak.enabled,
    kodiakPackMode:c.kodiak.packMode,upgradeRanks:c.loadout.upgradeRanks,boosts:c.loadout.boosts,
    inputs:b.inputs,checkpoints:b.exact.sled.map(r=>[r[0],...decodePose(r.slice(1,7)),r[7]])};
 return {ok:true,tape,causal:c,identity:{bundleDigest:v.bundleDigest,manifestDigest:v.manifestDigest,tapeDigest:c.input.tapeDigest,rulesetId:c.sim.rulesetId},expected:{startPose:c.start.pose,physicsScramble:c.rng.physicsScramble,
    initial:[c.bsod.leftEdgeX,c.bsod.initial.wallX,c.bsod.initial.wallSpeedPxS,c.bsod.initial.accelerationPxS2],
    checkpoints:b.checkpoints,endTick:b.claims.endTick,score:b.claims.score,distanceM:b.claims.distanceM}};
}

/** This accepts observations ONLY from a host-controlled replay worker, not a client.
 * Matching physics is not a proof of human input, ownership, or entitlement. */
export function compareReplayObservation(e,actual){
 let match=false;
 try{
  // Canonical JSON (and its parser) reorder object keys. Comparing raw
  // JSON.stringify output rejected a legitimate independently serialized
  // observation. Compare the canonical content, not insertion order.
  match=digestOf(actual.start)===digestOf({pose:e.startPose,rng:e.physicsScramble,initial:e.initial})&&
    digestOf(actual.points)===digestOf(e.checkpoints)&&actual.seek?.done===true&&actual.seek?.crashed===true&&
    actual.seek.tick===e.endTick+1&&!actual.seek.desync&&actual.score===e.score&&actual.distanceM===e.distanceM&&
    actual.checked===e.checkpoints.length;
 }catch{return {ok:false,reason:'invalid-observation'};}
 return {ok:match,reason:match?'real-replay-match':'divergence',actual};
}
