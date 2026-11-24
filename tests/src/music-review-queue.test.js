import {validateMusicReviewQueue}
	from '../../src/systems/music/MusicReviewQueue.js';

const A='a'.repeat(64),B='b'.repeat(64);
const fixture=()=>{
	const pack={id:'song',frameCount:48000*40,
		diagnosticReviewQueue:{path:'review-queue-v1.json',
			baselineScoreHash:A,experimentalScoreHash:B}};
	const released={scoreHash:A},experimental={scoreHash:B};
	const queue={format:'bitstream-music-review-queue-v1',
		status:'machine-ranked-disagreement-not-human-verified',
		songId:pack.id,baselineScoreHash:A,experimentalScoreHash:B,
		selectionMethod:'one-to-one pitch/class within 50ms, NOT correctness',
		excerpts:[{
			id:'drums-96000',role:'drums',startFrame:96000,
			endFrame:480000,priorityOrder:1,releaseCount:29,
			candidateCount:44,samePitchWithin50ms:17,
			disagreementProxy:3.1,
		}]};
	return {pack,released,experimental,queue};
};

describe('Source-pinned music review shortlist is never a gold set',()=>{
	test('accepts a bound original/candidate pair without modifying either',()=>{
		const {pack,released,experimental,queue}=fixture();
		const original=JSON.stringify(queue);
		expect(validateMusicReviewQueue(queue,pack,released,experimental))
			.toBe(queue);
		expect(JSON.stringify(queue)).toBe(original);
		expect(queue.status).toContain('not-human-verified');
	});
	test('rejects false verified/gold status even with valid score hashes',()=>{
		const x=fixture();x.queue.status='human-verified';
		expect(()=>validateMusicReviewQueue(
			x.queue,x.pack,x.released,x.experimental)).toThrow(/non-gold/);
	});
	test('rejects candidate/pack parent-score mismatch or wrong song',()=>{
		const x=fixture();x.experimental.scoreHash='f'.repeat(64);
		expect(()=>validateMusicReviewQueue(
			x.queue,x.pack,x.released,x.experimental)).toThrow();
		x.experimental.scoreHash=B;
		x.queue.songId='other-song';
		expect(()=>validateMusicReviewQueue(
			x.queue,x.pack,x.released,x.experimental)).toThrow();
	});
	test('rejects unbounded frames, fabricated counts and duplicates',()=>{
		const x=fixture();
		x.queue.excerpts[0].samePitchWithin50ms=30;
		expect(()=>validateMusicReviewQueue(
			x.queue,x.pack,x.released,x.experimental)).toThrow();
		x.queue.excerpts[0].samePitchWithin50ms=17;
		x.queue.excerpts[0].endFrame=x.pack.frameCount+1;
		expect(()=>validateMusicReviewQueue(
			x.queue,x.pack,x.released,x.experimental)).toThrow();
		x.queue.excerpts[0].endFrame=480000;
		x.queue.excerpts.push({...x.queue.excerpts[0],priorityOrder:2});
		expect(()=>validateMusicReviewQueue(
			x.queue,x.pack,x.released,x.experimental)).toThrow();
	});
	test('does not allow melody, fake roles or unordered review ranks',()=>{
		const x=fixture();
		x.queue.excerpts[0].role='melody';
		expect(()=>validateMusicReviewQueue(
			x.queue,x.pack,x.released,x.experimental)).toThrow();
		x.queue.excerpts[0].role='drums';
		x.queue.excerpts.push({...x.queue.excerpts[0],id:'drums-576000',
			startFrame:576000,endFrame:960000,priorityOrder:1});
		expect(()=>validateMusicReviewQueue(
			x.queue,x.pack,x.released,x.experimental)).toThrow();
	});
	test('descriptive priority is a proxy, never calibrated confidence',()=>{
		const x=fixture();x.queue.excerpts[0].disagreementProxy=Infinity;
		expect(()=>validateMusicReviewQueue(
			x.queue,x.pack,x.released,x.experimental)).toThrow();
	});
});
