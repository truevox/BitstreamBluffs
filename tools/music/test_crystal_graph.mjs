/** Pure Crystal graph-scheduling QA; the live and OfflineAudioContext use this module. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createCrystalGraph,synthesizeLanding} from '../../public/music-review/crystal-harmony/graph.mjs';
import {resonanceChanges,resonanceNotes,rowAtSourceTime} from '../../public/music-review/crystal-harmony/resonators.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../../public/music-review/crystal-harmony/harmony.json',import.meta.url)));
function mockAudio(){
	const nodes=[];
	const param=value=>({value,events:[],setValueAtTime(value,at){this.events.push(['set',value,at]);this.value=value;},
		linearRampToValueAtTime(value,at){this.events.push(['linear',value,at]);this.value=value;},
		exponentialRampToValueAtTime(value,at){this.events.push(['exp',value,at]);this.value=value;}});
	const node=type=>{const n={type,connected:[],connect(x){this.connected.push(x);return x;}};
		if(type==='gain')n.gain=param(1);
		if(type==='biquad'){n.frequency=param(400);n.Q=param(1);}
		if(type==='compressor'){n.threshold=param(0);n.knee=param(0);n.ratio=param(0);n.attack=param(0);n.release=param(0);}
		if(type==='osc'){n.frequency=param(440);n.start=at=>{n.started=at;};n.stop=at=>{n.stopped=at;};}
		nodes.push(n);return n;
	};
	return {ctx:{createGain:()=>node('gain'),createBiquadFilter:()=>node('biquad'),
		createDynamicsCompressor:()=>node('compressor'),createOscillator:()=>node('osc')},nodes};
}

test('shared graph clamps wet path, Q, routes dry source independently, no feedback loop',()=>{
	const {ctx,nodes}=mockAudio();const destination={type:'destination'};
	const g=createCrystalGraph(ctx,{destination,harmony:data,sourceStart:11.94,sourceEnd:20.94,
		startAt:.1,dryGain:.23,wetMix:100});
	assert.equal(g.dry.gain.value,.23);
	assert.equal(g.wetControl.gain.value,.55);
	assert.equal(g.comp.threshold.value,-24);
	assert.equal(g.comp.ratio.value,7);
	assert.deepEqual(g.dry.connected,[destination]);
	assert.deepEqual(g.wetControl.connected,[destination]);
	assert.equal(g.banks.length,2);
	assert.equal(nodes.filter(x=>x.Q&&x.frequency).length,6);
	assert.ok(nodes.filter(x=>x.Q&&x.frequency).every(x=>x.Q.value<=16));
	assert.ok(g.changeCount>5);
	assert.ok(g.banks.every(bank=>bank.filters.every(x=>x.connected.includes(bank.gain))));
	assert.ok(!g.wetControl.connected.includes(g.input),'Wet output must not feed back into input');
});

test('two muted resonator banks retune only after source-time boundaries',()=>{
	const {ctx}=mockAudio();const start=11.94,end=20.94,at=2;
	const g=createCrystalGraph(ctx,{destination:{},harmony:data,
		sourceStart:start,sourceEnd:end,startAt:at,dryGain:.23,wetMix:.25});
	const updates=resonanceChanges(data,start,end);
	assert.equal(g.changeCount,updates.length);
	for(let i=0;i<updates.length;i++){
		const b=g.banks[i%2];
		const t=at+updates[i].atSeconds-start;
		assert.ok(b.gain.gain.events.some(e=>e[0]==='set'&&e[1]===0&&Math.abs(e[2]-t)<1e-7),
			'Shared graph must mute bank before frequency retune');
		assert.ok(b.gain.gain.events.some(e=>e[0]==='linear'&&Math.abs(e[2]-(t+.07))<1e-7),
			'Changes must crossfade by 70ms');
	}
});

test('manual landing bell respects impact and routes to compressed wet bus only',()=>{
	const {ctx,nodes}=mockAudio();const graph=createCrystalGraph(ctx,{destination:{},harmony:data,
		sourceStart:11.94,sourceEnd:20.94,startAt:0,dryGain:.23,wetMix:.2});
	const pitches=resonanceNotes(rowAtSourceTime(data,16.5));
	assert.equal(pitches.length,3);
	const created=synthesizeLanding(ctx,graph,pitches,1,1.5);
	assert.equal(created.length,6);
	assert.equal(nodes.filter(x=>typeof x.start==='function').length,3);
	assert.ok(nodes.filter(x=>typeof x.start==='function').every(x=>x.started>=1.5 && x.stopped===2.8));
	const envelopes=created.filter(x=>x.type==='gain');
	assert.ok(envelopes.every(x=>x.connected.includes(graph.filtered)));
	assert.ok(envelopes.every(x=>!x.connected.includes(graph.dry)));
	assert.deepEqual(synthesizeLanding(ctx,graph,[],1,1.5),[]);
	assert.throws(()=>synthesizeLanding(ctx,graph,pitches,-1,1.5),RangeError);
});

test('invalid positions and unsafe dry gains fail without building filters',()=>{
	for(const overrides of [{sourceStart:-1},{sourceStart:21,sourceEnd:20.94},{dryGain:.9},{wetMix:Infinity}]){
		const {ctx,nodes}=mockAudio();
		assert.throws(()=>createCrystalGraph(ctx,{destination:{},harmony:data,
			sourceStart:11.94,sourceEnd:20.94,startAt:0,dryGain:.23,wetMix:.2,...overrides}),RangeError);
		assert.equal(nodes.length,0);
	}
});


test('actual twelve-passages stereo Chromium render is source-bound and never approves sound quality',()=>{
	const report=JSON.parse(fs.readFileSync(new URL(
		'../../docs/music-review/one-more-run-crystal-audio-render-metrics-UNVERIFIED-20261121.json',import.meta.url)));
	const sha=path=>createHash('sha256').update(fs.readFileSync(new URL(path,import.meta.url))).digest('hex');
	assert.equal(report.status,'RESEARCH_MEASURED_NOT_APPROVED_SOUND_OR_TRUE_PEAK');
	assert.equal(report.sourceHarmonySidecarSha256,
		sha('../../public/music-review/crystal-harmony/harmony.json'));
	assert.equal(report.sharedAudioGraphSha256,
		sha('../../public/music-review/crystal-harmony/graph.mjs'));
	assert.equal(report.originalSourceManifestSha256,
		sha('../../public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json'));
	assert.equal(report.originalStemSha256Count,90);
	assert.equal(report.analysisWindowCount,12);
	assert.equal(report.offlineRenderCount,48);
	assert.equal(report.passages.length,12);
	const seen=new Set();let suppressed=0;
	for(const p of report.passages){
		assert.equal(p.dry.channelCount,2);
		assert.equal(p.normal.channelCount,2);
		assert.equal(p.maxLanding.channelCount,2);
		assert.equal(p.toggle.channelCount,2);
		assert.equal(p.dry.clippedFrames,0);
		assert.equal(p.normal.clippedFrames,0);
		assert.equal(p.maxLanding.clippedFrames,0);
		assert.equal(p.toggle.clippedFrames,0);
		assert.ok(p.maxLanding.peak<.98);
		assert.ok(p.normal.peak<.9);
		assert.ok(p.normal.rms<=p.dry.rms*1.35);
		assert.ok(p.maxLanding.rms<=p.dry.rms*1.8);
		assert.ok(p.compareNormal.wetDifferenceRms>.00001);
		assert.ok(p.compareMax.wetResidualMaxAdjacentDelta<.06);
		assert.ok(p.compareToggle.wetResidualMaxAdjacentDelta<.06);
		assert.ok(p.normal.monoRms>p.normal.rms*.4);
		if(!p.maxLanding.landingNotesScheduled)suppressed++;
		else assert.equal(p.maxLanding.landingNotesScheduled,3);
		seen.add(p.range.join(':'));
	}
	assert.equal(seen.size,12);
	assert.ok(suppressed>=1,'Silent fallback must be actually exercised');
	assert.ok(report.limitations.some(s=>s.includes('not true peak')));
	assert.ok(report.limitations.some(s=>s.includes('not mobile runtime')));
});
