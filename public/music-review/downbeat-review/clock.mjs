// Audition-only clock. Never imported by the game or its release beat catalog.
export const PACK_ROOT = '/music/packs/33_local-one-more-run-bitstream-bluffs/';

export function clicksForCandidate({ bpm, phaseSeconds, beatOneOffset, startSeconds, durationSeconds }) {
	if (![bpm, phaseSeconds, beatOneOffset, startSeconds, durationSeconds].every(Number.isFinite))
		throw new TypeError('Every timing field must be finite');
	if (bpm < 30 || bpm > 300 || phaseSeconds < 0 || durationSeconds <= 0
		|| !Number.isInteger(beatOneOffset) || beatOneOffset < 0 || beatOneOffset > 3)
		throw new RangeError('Invalid research timing');
	const pulse = 60 / bpm;
	const first = startSeconds + phaseSeconds;
	const lower = Math.floor((startSeconds - first) / pulse) - 1;
	const upper = Math.ceil((startSeconds + durationSeconds - first) / pulse) + 1;
	const result = [];
	for (let i = lower; i <= upper; i++) {
		const t = first + i * pulse;
		if (t < startSeconds - 1e-5 || t >= startSeconds + durationSeconds - 1e-5) continue;
		result.push({
			sourceSeconds: t,
			localSeconds: t - startSeconds,
			beatOne: ((i - beatOneOffset) % 4 + 4) % 4 === 0
		});
	}
	return result;
}

export function sourceStemURL(pack, index, role) {
	if (!['drums', 'bass', 'guitar', 'piano', 'other', 'vocals'].includes(role))
		throw new RangeError('Unknown source role');
	const relative = pack?.segments?.[index]?.sources?.[role];
	if (typeof relative !== 'string' || !/^[\w./-]+\.ogg$/.test(relative)
		|| relative.includes('..') || relative.startsWith('/'))
		throw new Error('Unsafe or unavailable original OGG stem');
	return PACK_ROOT + relative;
}

export function candidateGroup(window, bpmIndex, phaseIndex, offset) {
	if (window?.status !== 'unverified') throw new Error('Not an unverified research window');
	const model = window.hypotheses?.[bpmIndex], phase = model?.phases?.[phaseIndex];
	const rival = phase?.offsets?.find(row => row.beatOneOffset === offset);
	if (!rival) throw new Error('Four-offset candidate was not retained');
	return { bpm: model.bpmHypothesis, phaseSeconds: phase.phaseSeconds,
		beatOneOffset: offset, evidence: rival };
}
