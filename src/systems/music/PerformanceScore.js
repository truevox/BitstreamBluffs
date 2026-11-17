/**
 * The same immutable performance-v1 schema that offline release rendering
 * consumes, interpreted on the REAL game's 48kHz music clock.
 *
 * This module never runs a detector, guesses a beat, invents confidence or
 * changes live playback. Source audio and replacement routing remain owned
 * by StemMusicDirector; optional score sidecars are diagnostic evidence only.
 */
export const PERFORMANCE_FORMAT='bitstream-performance-v1';
export const PERFORMANCE_ROLES=Object.freeze([
	'melody','bass','drums','guitar','piano','other'
]);
export const PERFORMANCE_SAMPLE_RATE=48000;
const hex64=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const int=n=>Number.isSafeInteger(n)&&n>=0;
const safeId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{3,48}$/.test(s);

function validateScoreShape(raw,pack,asset,quality){
	if(!raw||raw.format!==PERFORMANCE_FORMAT||
		raw.songId!==pack.id||raw.frameCount!==pack.frameCount||
		raw.sampleRate!==PERFORMANCE_SAMPLE_RATE||
		raw.sampleRate!==pack.sampleRate||
		raw.featuredStem!==pack.adaptive?.featuredStem||
		raw.quality!==quality||
		raw.calibratedConfidence!==false||
		!hex64(raw.scoreHash)||
		raw.scoreHash!==asset?.scoreHash){
		throw new Error('Performance score identity/revision mismatch');
	}
	const stems=raw.provenance?.sourceStemSha256;
	if(!stems||Object.keys(stems).sort().join(',')!==
		['bass','drums','guitar','other','piano','vocals'].join(',')||
		!Object.values(stems).every(hex64)){
		throw new Error('Performance score source fingerprint invalid');
	}
	if(!raw.events||Object.keys(raw.events).sort().join(',')!==
		PERFORMANCE_ROLES.slice().sort().join(',')){
		throw new Error('Performance score lacks instrument roles');
	}
	const ids=new Set();
	for(const role of PERFORMANCE_ROLES){
		const events=raw.events[role];
		if(!Array.isArray(events)||events.length>150000)
			throw new Error('Performance score role event count invalid');
		let last=-1;
		for(const event of events){
			if(!event||!int(event.startFrame)||
				event.startFrame>=raw.frameCount||
				event.startFrame<last||!safeId(event.id)||ids.has(event.id)||
				event.confidence!==null){
				throw new Error('Performance score event corrupt');
			}
			ids.add(event.id);
			last=event.startFrame;
			if(role==='drums'){
				if(event.endFrame!==undefined ||
					!['kick','snare','hat','tom','cymbal'].includes(event.class))
					throw new Error('Performance drum hit corrupt');
			}else if(!int(event.endFrame)||
				event.endFrame<=event.startFrame||
				event.endFrame>raw.frameCount||
				!int(event.pitch)||event.pitch>127||event.class!=='note'){
				throw new Error('Performance note event corrupt');
			}
		}
	}
	return raw;
}

export function validatePerformanceScore(raw,pack){
	return validateScoreShape(raw,pack,pack.performance,'provisional-unreviewed');
}

/** This is READ-ONLY source-disagreement evidence; it can never be
 * substituted for the actual game's authoritative base performance score.
 * The parent hash and six original stem fingerprints must match exactly.
 */
export function validateExperimentalPerformanceScore(raw,pack,original){
	if(!original||!pack.experimentalPerformance||
		pack.experimentalPerformance.parentScoreHash!==original.scoreHash){
		throw new Error('Experimental score has no validated released parent');
	}
	validateScoreShape(raw,pack,pack.experimentalPerformance,
		'experimental-candidate-unreviewed');
	if(raw.provenance?.evidence?.parentScoreHash!==original.scoreHash){
		throw new Error('Experimental score is not descended from released score');
	}
	for(const role of ['vocals','bass','drums','guitar','piano','other']){
		if(raw.provenance.sourceStemSha256[role]!==
			original.provenance.sourceStemSha256[role]){
			throw new Error('Experimental candidate used different source audio');
		}
	}
	// The current experiment intentionally leaves released melody alone.
	// If future experiments modify it, they must explicitly version this
	// invariant rather than quietly claiming a like-for-like comparison.
	const before=original.events.melody;
	const after=raw.events.melody;
	if(before.length!==after.length||before.some((event,index)=>
		event.id!==after[index].id||
		event.startFrame!==after[index].startFrame||
		event.endFrame!==after[index].endFrame||
		event.pitch!==after[index].pitch)){
		throw new Error('Candidate unexpectedly changed baseline melody');
	}
	return raw;
}

/** Return source-start events near the clock, preserving simultaneous hits
 * and same-pitch re-attacks. This is O(log N + number of local events).
 */
export function nearbyPerformanceEvents(score,roles,frame,spanFrames=2400){
	if(!score||!int(frame)||!int(spanFrames))return [];
	const result=[];
	const left=Math.max(0,frame-spanFrames);
	const right=frame+spanFrames;
	for(const role of roles){
		const events=score.events[role]||[];
		let lo=0,hi=events.length;
		while(lo<hi){
			const mid=(lo+hi)>>1;
			if(events[mid].startFrame<left)lo=mid+1;
			else hi=mid;
		}
		while(lo<events.length&&events[lo].startFrame<=right){
			result.push({role,event:events[lo]});
			lo++;
		}
	}
	result.sort((a,b)=>a.event.startFrame-b.event.startFrame||
		a.role.localeCompare(b.role)||a.event.id.localeCompare(b.event.id));
	return result;
}

/** A human suspicion marker is NOT a gold label. Never directly edit the
 * score because it would invalidate the content hash and the shipped audio.
 */
export function makeIssueMarker(score,{songId,role,frame,biome,airborne,speed,
	replacements}){
	if(!int(frame))throw new Error('Cannot annotate a non-frame time');
	const roles=role==='ALL'?PERFORMANCE_ROLES:
		PERFORMANCE_ROLES.includes(role)?[role]:[];
	if(!roles.length)throw new Error('Unknown marker role');
	const near=nearbyPerformanceEvents(score,roles,frame,Math.round(.075*
		PERFORMANCE_SAMPLE_RATE));
	return {
		kind:'subjective-suspected-issue-not-gold-truth',
		songId,
		scoreHash:score?.scoreHash??null,
		frame,
		roles,
		nearbySourceEventIds:near.map(({event})=>event.id),
		biome,
		airborne:airborne===true,
		speedPxS:Number(speed)||0,
		replacements:replacements===true,
	};
}
