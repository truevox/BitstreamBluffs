/**
 * Pure validator for model-DISAGREEMENT review shorts, not human gold.
 * Never used by playback or in a source note correction automatically.
 */
const FORMAT='bitstream-music-review-queue-v1';
const STATUS='machine-ranked-disagreement-not-human-verified';
const ROLES=new Set(['bass','drums','guitar','piano','other']);
const integer=n=>Number.isSafeInteger(n);
const hex64=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);

export function validateMusicReviewQueue(raw,pack,base,candidate){
	if(!raw||raw.format!==FORMAT||raw.status!==STATUS||
		raw.songId!==pack?.id||!base||!candidate||
		raw.baselineScoreHash!==base.scoreHash||
		raw.experimentalScoreHash!==candidate.scoreHash||
		!hex64(raw.baselineScoreHash)||!hex64(raw.experimentalScoreHash)||
		pack.diagnosticReviewQueue?.baselineScoreHash!==base.scoreHash||
		pack.diagnosticReviewQueue?.experimentalScoreHash!==candidate.scoreHash||
		typeof raw.selectionMethod!=='string'||
		!raw.selectionMethod.includes('NOT correctness')||
		!Array.isArray(raw.excerpts)||raw.excerpts.length<1||
		raw.excerpts.length>20){
		throw new Error('Review shortlist provenance or non-gold status mismatch');
	}
	const seen=new Set();
	let priorRank=0;
	for(const item of raw.excerpts){
		if(!item||!ROLES.has(item.role)||
			!integer(item.startFrame)||!integer(item.endFrame)||
			item.startFrame<0||item.endFrame<=item.startFrame||
			item.endFrame>pack.frameCount||
			item.endFrame-item.startFrame>8*48000||
			item.id!==item.role+'-'+item.startFrame||
			seen.has(item.id)||
			!integer(item.priorityOrder)||item.priorityOrder<=priorRank||
			item.priorityOrder>20||
			!integer(item.releaseCount)||item.releaseCount<0||
			!integer(item.candidateCount)||item.candidateCount<0||
			!integer(item.samePitchWithin50ms)||item.samePitchWithin50ms<0||
			item.samePitchWithin50ms>Math.min(
				item.releaseCount,item.candidateCount)||
			!Number.isFinite(item.disagreementProxy)||
			item.disagreementProxy<0){
			throw new Error('Invalid or unreviewed musical review excerpt');
		}
		seen.add(item.id);
		priorRank=item.priorityOrder;
	}
	return raw;
}
