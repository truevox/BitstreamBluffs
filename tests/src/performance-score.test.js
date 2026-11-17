import {validatePerformanceScore,nearbyPerformanceEvents,makeIssueMarker,
	PERFORMANCE_ROLES} from '../../src/systems/music/PerformanceScore.js';

function fixture(){
	const pack={id:'example-song',sampleRate:48000,frameCount:96000,
		adaptive:{featuredStem:'other'},
		performance:{path:'performance.json',scoreHash:'a'.repeat(64)}};
	const score={format:'bitstream-performance-v1',songId:'example-song',
		sampleRate:48000,frameCount:96000,featuredStem:'other',
		quality:'provisional-unreviewed',calibratedConfidence:false,
		scoreHash:'a'.repeat(64),
		provenance:{sourceStemSha256:Object.fromEntries(
			['vocals','bass','drums','guitar','piano','other'].map(k=>[k,'b'.repeat(64)]))},
		events:Object.fromEntries(PERFORMANCE_ROLES.map(role=>[role,[]]))};
	score.events.guitar=[{id:'gu-11111111111111111111',
		startFrame:48000,endFrame:58000,pitch:60,class:'note',confidence:null},
		{id:'gu-22222222222222222222',
		startFrame:48000,endFrame:58100,pitch:60,class:'note',confidence:null},
		{id:'gu-33333333333333333333',
		startFrame:60000,endFrame:70000,pitch:61,class:'note',confidence:null}];
	score.events.drums=[{id:'dr-11111111111111111111',
		startFrame:48000,class:'kick',confidence:null},
		{id:'dr-22222222222222222222',
		startFrame:48000,class:'snare',confidence:null}];
	return {score,pack};
}

describe('Single-game-score performance-v1 and mark export contract',()=>{
	test('source revision and song ID must exactly match game pack',()=>{
		const {score,pack}=fixture();
		expect(validatePerformanceScore(score,pack)).toBe(score);
		pack.id='wrong';
		expect(()=>validatePerformanceScore(score,pack)).toThrow(/identity/);
		pack.id=score.songId;
		pack.performance.scoreHash='f'.repeat(64);
		expect(()=>validatePerformanceScore(score,pack)).toThrow(/identity/);
	});
	test('rejects fake confidence and duplicate or unordered events',()=>{
		const {score,pack}=fixture();
		score.events.drums[0].confidence=.92;
		expect(()=>validatePerformanceScore(score,pack)).toThrow(/corrupt/);
		score.events.drums[0].confidence=null;
		score.events.drums[1].id=score.events.drums[0].id;
		expect(()=>validatePerformanceScore(score,pack)).toThrow(/corrupt/);
		score.events.drums[1].id='dr-22222222222222222222';
		score.events.guitar[2].startFrame=0;
		expect(()=>validatePerformanceScore(score,pack)).toThrow(/corrupt/);
	});
	test('nearby events retain co-hits and repeated same-pitch attacks',()=>{
		const {score,pack}=fixture();
		validatePerformanceScore(score,pack);
		const near=nearbyPerformanceEvents(score,
			['guitar','drums'],48000,480);
		expect(near).toHaveLength(4);
		expect(near.map(x=>x.event.id)).toEqual(expect.arrayContaining([
			'gu-11111111111111111111','gu-22222222222222222222',
			'dr-11111111111111111111','dr-22222222222222222222',
		]));
		expect(nearbyPerformanceEvents(score,['guitar'],60000,10))
			.toHaveLength(1);
	});
	test('one subjective marker never modifies game event score',()=>{
		const {score,pack}=fixture();
		validatePerformanceScore(score,pack);
		const original=JSON.stringify(score);
		const mark=makeIssueMarker(score,{
			songId:score.songId,role:'ALL',frame:48000,
			biome:'crystal-cavern',airborne:true,speed:850,replacements:true,
		});
		expect(mark).toMatchObject({
			kind:'subjective-suspected-issue-not-gold-truth',
			scoreHash:score.scoreHash,frame:48000,airborne:true,
		});
		expect(mark.nearbySourceEventIds).toHaveLength(4);
		expect(JSON.stringify(score)).toBe(original);
	});
	test('never attach wrong, unversioned, or arbitrary voice scores',()=>{
		const {score,pack}=fixture();
		score.provenance.sourceStemSha256.vocals='notsha';
		expect(()=>validatePerformanceScore(score,pack)).toThrow(/fingerprint/);
		score.provenance.sourceStemSha256.vocals='b'.repeat(64);
		score.events.other=[{id:'other',startFrame:0,endFrame:1,pitch:200,
			class:'note',confidence:null}];
		expect(()=>validatePerformanceScore(score,pack)).toThrow(/corrupt/);
	});
});
