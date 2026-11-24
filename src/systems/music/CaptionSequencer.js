/** Word timing belongs to the recorded performance, never the prompt text. */
export function normalizeCaptions(raw, durationSeconds) {
	if (!raw || raw.format !== 'bitstream-lyrics-v1' || !Array.isArray(raw.words) ||
		raw.words.length > 50000) throw new Error('Invalid lyric timeline');
	let previousStart = -1;
	const words = raw.words.map((word) => {
		if (!word || !Number.isFinite(word.start) || !Number.isFinite(word.end) ||
			word.start < 0 || word.end <= word.start || word.end > durationSeconds + 0.5 ||
			word.start < previousStart || typeof word.text !== 'string' ||
			word.text.length < 1 || word.text.length > 100) throw new Error('Invalid lyric word timing');
		previousStart = word.start;
		return { start: word.start, end: word.end, text: word.text };
	});
	return { words };
}

export function captionAt(words, positionSeconds) {
	if (!Array.isArray(words) || !Number.isFinite(positionSeconds)) return null;
	// Find the last word that starts before the current musical position.
	let lo = 0, hi = words.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (words[mid].start <= positionSeconds) lo = mid + 1;
		else hi = mid;
	}
	const word = words[lo - 1];
	return word && positionSeconds < word.end ? word : null;
}

export function nextBeatTime(transportStart, positionSeconds, bpm, beatOffset = 0) {
	if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 350) return transportStart + Math.max(0, positionSeconds);
	const interval = 60 / bpm;
	const beats = Math.ceil((positionSeconds - beatOffset) / interval);
	return transportStart + Math.max(positionSeconds, beatOffset + Math.max(0, beats) * interval);
}
