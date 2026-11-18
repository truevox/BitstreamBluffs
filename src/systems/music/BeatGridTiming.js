/** Verified source-performance quarter-note pulse lookup. No physics, no clock ownership.
 * Beat grid frame positions are authored/validated against unaltered OGG performance.
 * BPM-only and guessed percussion subdivisions NEVER authorize a Gym release.
 */
export const BEAT_GRID_FORMAT='bitstream-beat-grid-v1';
export const MIN_GRID_CONFIDENCE=.9;
const isInt=n=>Number.isSafeInteger(n)&&n>=0;
const fail=reason=>Object.freeze({trusted:false,reason});

/** Returns trusted, normalized beat-grid metadata or a typed rejection.
 * - section pulseFrames are strictly ordered quarter-note grid positions;
 * - invalid sections and section boundaries are never guessed across;
 * - source sample rate + length MUST match the actual music pack.
 * Proof metadata is supplied by an independent verification step, never by detection itself.
 */
export function validateBeatGrid(raw,pack){
	if(!raw||raw.format!==BEAT_GRID_FORMAT||raw.trackId!==pack?.id)
		return fail('missing-or-mismatched-grid');
	if(raw.status!=='verified'||raw.review?.humanSpotCheck!=='passed'||
		raw.review?.independentCheck!=='passed'||
		!Number.isFinite(raw.confidence)||raw.confidence<MIN_GRID_CONFIDENCE)
		return fail('unverified-beat-grid');
	if(raw.sourceSampleRate!==pack.sampleRate||raw.sourceFrameCount!==pack.frameCount)
		return fail('different-recording');
	if(typeof raw.sourceSha256!=='string'||!/^[0-9a-f]{64}$/.test(raw.sourceSha256)||
		typeof raw.version!=='string'||!raw.version.trim())
		return fail('missing-source-provenance');
	if(!Array.isArray(raw.sections)||!raw.sections.length)return fail('missing-sections');
	let cursor=0,approvedCount=0;
	const sections=[];
	for(const section of raw.sections){
		if(!isInt(section.startFrame)||!isInt(section.endFrame)||
			section.startFrame!==cursor||section.endFrame<=section.startFrame||
			section.endFrame>pack.frameCount)return fail('invalid-section-range');
		const safe=section.status==='verified'&&
			Number.isFinite(section.confidence)&&section.confidence>=MIN_GRID_CONFIDENCE;
		if(!['verified','uncertain'].includes(section.status))return fail('invalid-section-status');
		const beats=section.pulseFrames;
		if(!Array.isArray(beats)||!beats.every(isInt))return fail('invalid-pulses');
		let prev=-1;
		for(const frame of beats){
			if(frame<=prev||frame<section.startFrame||frame>=section.endFrame)
				return fail('invalid-pulse-order');
			prev=frame;
		}
		if(!safe&&beats.length)return fail('uncertain-section-must-not-have-pulses');
		if(safe){
			if(beats.length<2)return fail('underspecified-beats');
			for(let i=1;i<beats.length;i++){
				const interval=(beats[i]-beats[i-1])/pack.sampleRate;
				if(interval<.24||interval>2.01)return fail('implausible-quarter-note-interval');
			}
			approvedCount+=beats.length;
		}
		sections.push(Object.freeze({startFrame:section.startFrame,
			endFrame:section.endFrame,confidence:section.confidence,
			status:section.status,pulseFrames:Object.freeze(beats.slice())}));
		cursor=section.endFrame;
	}
	if(cursor!==pack.frameCount||approvedCount<2)return fail('incomplete-or-empty-grid');
	return Object.freeze({trusted:true,trackId:raw.trackId,version:raw.version,
		confidence:raw.confidence,sourceSha256:raw.sourceSha256,
		sourceSampleRate:raw.sourceSampleRate,sourceFrameCount:raw.sourceFrameCount,
		sections:Object.freeze(sections)});
}

/** Conservative next quarter-note pulse by frame, with no extrapolation. */
export function nextVerifiedPulse(validated,positionSeconds,maxWaitMs=300){
	if(!validated?.trusted)return fail(validated?.reason||'missing-grid');
	if(!Number.isFinite(positionSeconds)||positionSeconds<0)return fail('invalid-position');
	const frames=validated.sourceFrameCount;
	const currentFrame=Math.ceil(positionSeconds*validated.sourceSampleRate-1e-7);
	if(currentFrame>=frames)return fail('end-of-recording');
	const section=validated.sections.find(s=>currentFrame>=s.startFrame&&currentFrame<s.endFrame);
	if(!section||section.status!=='verified')return fail('uncertain-section');
	const pulses=section.pulseFrames;
	let lo=0,hi=pulses.length;
	while(lo<hi){const mid=(lo+hi)>>1;
		if(pulses[mid]<currentFrame)lo=mid+1;else hi=mid;
	}
	if(lo===pulses.length)return fail('no-verified-pulse-in-section');
	const beatFrame=pulses[lo],beatSeconds=beatFrame/validated.sourceSampleRate;
	const waitMs=Math.max(0,(beatSeconds-positionSeconds)*1000);
	if(waitMs>Math.min(300,Math.max(0,Number(maxWaitMs)||0))+1e-6)
		return fail('no-imminent-pulse');
	return Object.freeze({trusted:true,beatFrame,beatSeconds,waitMs,
		trackId:validated.trackId,gridVersion:validated.version,
		confidence:Math.min(validated.confidence,section.confidence)});
}
