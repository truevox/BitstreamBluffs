// Source-hash-bound harmony DSP research: only candidate weights, no beat map.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { validateHarmonyData,rowAtSourceTime,resonanceNotes,resonanceChanges,
	boundedWetMix,HARMONY_SHA256,MASTER_SHA256,SOURCE_MANIFEST_SHA256,MAX_RESONATOR_Q } from
	'../../public/music-review/crystal-harmony/resonators.mjs';

const root=new URL('../../',import.meta.url);
const buffer=fs.readFileSync(new URL('public/music-review/crystal-harmony/harmony.json',root));
const archived=fs.readFileSync(new URL('docs/music-review/one-more-run-source-time-harmony-UNVERIFIED-20261121.json',root));
const packBytes=fs.readFileSync(new URL('public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json',root));
const packet=JSON.parse(fs.readFileSync(new URL('public/music-review/downbeat-review/candidates.json',root)));
const harmony=JSON.parse(buffer),pack=JSON.parse(packBytes);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('source and browser sidecar exact byte identity, no source media copied',()=>{
	assert.equal(sha(buffer),HARMONY_SHA256);
	assert.equal(sha(archived),HARMONY_SHA256);
	assert.equal(sha(packBytes),SOURCE_MANIFEST_SHA256);
	assert.equal(packet.source.originalMasterWavSha256,MASTER_SHA256);
	assert.equal(buffer.equals(archived),true);
	assert.equal(validateHarmonyData(harmony,pack,packet),true);
	assert.equal(harmony.sourceStemSha256['14'].other,packet.windows[14].originalStemHashesSha256.other);
	assert.equal(harmony.tuning.status,'UNSTABLE_TUNING_EVIDENCE_USE_A440');
	assert.equal(harmony.tuning.offsetCents,0);
	assert.equal(harmony.timeline.length,699);
});

test('250ms bins use absolute original sample frames, including OGG seams and short tail',()=>{
	assert.equal(harmony.binFrames,12000);
	assert.equal(rowAtSourceTime(harmony,11.999)?.startFrame,11.75*48000);
	assert.equal(rowAtSourceTime(harmony,12.000)?.startFrame,12*48000);
	assert.equal(rowAtSourceTime(harmony,24.000)?.startFrame,24*48000);
	assert.equal(rowAtSourceTime(harmony,174.599)?.endFrame,8380800);
	assert.equal(rowAtSourceTime(harmony,-1),null);
	assert.equal(rowAtSourceTime(harmony,174.6),null);
	assert.equal(rowAtSourceTime(harmony,Number.NaN),null);
	assert.equal(harmony.timeline[48].startFrame,576000);
	assert.equal(harmony.timeline[48].candidateOnly,true);
});

test('resonators choose the actual source pitch weights, never chord names or unverified tuning',()=>{
	const row=rowAtSourceTime(harmony,16.5);
	const notes=resonanceNotes(row);
	assert.deepEqual(notes.map(n=>n.name),['A#','F','D']);
	assert.equal(notes.length,3);
	assert.ok(notes.every(n=>n.frequencyHz>=523 && n.frequencyHz<=1000));
	assert.deepEqual(resonanceNotes({...row,confidence:.05}),[]);
	assert.deepEqual(resonanceNotes({...row,status:'INSUFFICIENT_SOURCE_HARMONY'}),[]);
	assert.deepEqual(resonanceNotes({...row,candidateOnly:false}),[]);
	assert.ok(MAX_RESONATOR_Q<=20);
});

test('resonators schedule only in original source seconds even across 12s segments',()=>{
	const changes=resonanceChanges(harmony,11.94,20.94);
	assert.ok(changes.length>5);
	assert.equal(changes[0].atSeconds,11.94);
	assert.ok(changes.some(x=>x.atSeconds>=12 && x.atSeconds<12.5));
	assert.ok(changes.every(x=>x.unverified && x.atSeconds>=11.94 && x.atSeconds<20.94));
	assert.ok(changes.every(x=>x.notes.length===0||x.notes.length===3));
	assert.throws(()=>resonanceChanges(harmony,-2,3),RangeError);
	assert.throws(()=>resonanceChanges(harmony,175,176),RangeError);
});

test('mutated source/harmony/chord approval gates fail closed',()=>{
	const wrong={...harmony,originalFrameCount:harmony.originalFrameCount-100};
	assert.throws(()=>validateHarmonyData(wrong,pack,packet));
	const altered={...harmony,sourceStemSha256:{...harmony.sourceStemSha256,
		'3':{...harmony.sourceStemSha256['3'],piano:'0'.repeat(64)}}};
	assert.throws(()=>validateHarmonyData(altered,pack,packet));
	const approved={...harmony,timeline:[{...harmony.timeline[0],candidateOnly:false},...harmony.timeline.slice(1)]};
	assert.throws(()=>validateHarmonyData(approved,pack,packet));
	assert.equal(boundedWetMix(-1),0);
	assert.equal(boundedWetMix(Infinity),0);
	assert.equal(boundedWetMix(3),.55);
	assert.equal(boundedWetMix(.24),.24);
});
