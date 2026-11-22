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

// Plan a source-exact clip across original segments WITHOUT re-encoding or
// re-timing them. AudioBufferSource instances play their verified OGG slices.
export function sourceClipSlices(pack, startSeconds, endSeconds) {
	const rate = pack?.sampleRate;
	if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(startSeconds)
		|| !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds
		|| endSeconds > pack.frameCount / rate + 1e-7)
		throw new RangeError('Invalid original source clip range');
	const startFrame = Math.round(startSeconds * rate);
	const endFrame = Math.round(endSeconds * rate);
	let covered = startFrame;
	const slices = [];
	for (let index = 0; index < pack.segments.length; index++) {
		const seg = pack.segments[index], segStart = seg.startFrame;
		const segEnd = segStart + seg.frames;
		const from = Math.max(startFrame, segStart), to = Math.min(endFrame, segEnd);
		if (to <= from) continue;
		if (from !== covered) throw new Error('Source clip would cross a missing audio segment');
		slices.push({ segmentIndex: index, sourceStartSeconds: from / rate,
			sourceEndSeconds: to / rate,
			bufferOffsetSeconds: (from - segStart) / rate,
			clipOffsetSeconds: (from - startFrame) / rate,
			durationSeconds: (to - from) / rate });
		covered = to;
		if (covered >= endFrame) break;
	}
	if (!slices.length || covered !== endFrame)
		throw new Error('Original source clip is not completely covered by segmented OGGs');
	return slices;
}

// Preserve the identical absolute hypothetical click positions when seeking
// into a later source window or across segment cuts. Never treat as true beats.
export function clicksForSourceClip({ bpm, phaseSeconds, beatOneOffset,
	windowStartSeconds, clipStartSeconds, durationSeconds }) {
	if (![bpm, phaseSeconds, windowStartSeconds, clipStartSeconds,
		durationSeconds].every(Number.isFinite) || bpm <= 0 || phaseSeconds < 0)
		throw new RangeError('Invalid source clip click hypothesis');
	const period = 60 / bpm;
	const absoluteFirst = windowStartSeconds + phaseSeconds;
	const shiftIndex = Math.ceil((clipStartSeconds - absoluteFirst) / period - 1e-10);
	const normalizedPhase = Math.max(0, absoluteFirst + shiftIndex * period - clipStartSeconds);
	const shiftedOffset = ((beatOneOffset - shiftIndex) % 4 + 4) % 4;
	return clicksForCandidate({ bpm, phaseSeconds: normalizedPhase,
		beatOneOffset: shiftedOffset, startSeconds: clipStartSeconds, durationSeconds });
}
