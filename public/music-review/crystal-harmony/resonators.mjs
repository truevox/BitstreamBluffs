/** Pure, beat-independent original-source harmony lookups for DSP audition.
 * No learned chord labels, no tempo/meter assumptions, no game-state writes.
 */
export const PITCH_CLASS_NAMES = Object.freeze(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']);
export const HARMONY_STATUS = 'SOURCE_TIME_HARMONY_DSP_RESEARCH_NOT_MUSICAL_TRANSCRIPTION';
export const MASTER_SHA256 = '636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721';
export const SOURCE_MANIFEST_SHA256 = 'e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a';
export const HARMONY_SHA256 = '4abe19d6b77645be13939b0406c7c4433be294cd0b7ce8be4eac1832bd714303';
export const MAX_RESONATOR_Q = 16;

export function validateHarmonyData(data, manifest, candidatePacket) {
	if (data?.format !== 'bsb-original-song-harmony-pitch-classes-UNVERIFIED-v1'
		|| data.status !== HARMONY_STATUS || data.originalManifestSha256 !== SOURCE_MANIFEST_SHA256
		|| candidatePacket?.source?.manifestSha256 !== SOURCE_MANIFEST_SHA256
		|| manifest?.frameCount !== data.originalFrameCount
		|| manifest.sampleRate !== data.originalSourceSampleRate
		|| data.binFrames !== 12000 || data.trackId !== manifest.id
		|| candidatePacket.status !== 'CANDIDATE_ONLY_NOT_VERIFIED_NOT_RELEASE'
		|| Object.keys(data.sourceStemSha256||{}).length !== manifest.segments.length
		|| manifest.segments.length !== 15
		|| data.tuning?.status !== 'UNSTABLE_TUNING_EVIDENCE_USE_A440'
		|| data.tuning.offsetCents !== 0
		|| !Array.isArray(data.timeline) || data.timeline.length !== 699)
		throw new Error('Original source harmony research integrity/status mismatch');
	if (data.pitchClassNames?.join(',') !== PITCH_CLASS_NAMES.join(','))
		throw new Error('Unsafe harmony pitch-class layout');
	let cursor = 0;
	for (const row of data.timeline) {
		if (row.startFrame !== cursor || row.endFrame <= cursor
			|| row.endFrame - row.startFrame > data.binFrames || row.candidateOnly !== true
			|| !Array.isArray(row.pitchClassWeights) || row.pitchClassWeights.length !== 12
			|| row.pitchClassWeights.some(x => !Number.isFinite(x) || x < 0 || x > 1)
			|| !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1)
			throw new Error('Invalid or approved/shifted original-source harmony interval');
		cursor = row.endFrame;
	}
	if (cursor !== manifest.frameCount) throw new Error('Harmony intervals do not cover source timeline');
	for (const [index, hashes] of Object.entries(data.sourceStemSha256)) {
		const packet = candidatePacket.windows[Number(index)];
		if (!packet || !['guitar','piano','other'].every(role =>
			hashes[role] === packet.originalStemHashesSha256?.[role]))
			throw new Error('Harmony source stem fingerprint does not match original game stems');
	}
	return true;
}

export function rowAtSourceTime(data, seconds) {
	if (!Number.isFinite(seconds) || seconds < 0 || seconds >= data.originalFrameCount / data.originalSourceSampleRate)
		return null;
	const frame = Math.floor(seconds * data.originalSourceSampleRate);
	const index = Math.floor(frame / data.binFrames);
	const row = data.timeline[index];
	return row && row.startFrame <= frame && frame < row.endFrame ? row : null;
}

export function resonanceNotes(row, minConfidence = .18) {
	if (!row || row.candidateOnly !== true || row.status !== 'UNVERIFIED_WEIGHTED_PITCH_CLASSES'
		|| row.confidence < minConfidence || !Array.isArray(row.pitchClassWeights)
		|| row.pitchClassWeights.length !== 12) return [];
	const indexes = Array.from({length:12},(_,i)=>i).sort((a,b)=>
		row.pitchClassWeights[b]-row.pitchClassWeights[a] || a-b).slice(0,3);
	if (indexes.some(i => row.pitchClassWeights[i] < .09)) return [];
	// C5–B5, A440 reference. The measured tuning was explicitly unstable.
	return indexes.map(pc => ({pc,name:PITCH_CLASS_NAMES[pc],
		frequencyHz:440 * 2**((72+pc-69)/12),weight:row.pitchClassWeights[pc]}));
}

export function resonanceChanges(data, beginSeconds, endSeconds) {
	if (![beginSeconds,endSeconds].every(Number.isFinite) || beginSeconds < 0
		|| endSeconds <= beginSeconds || endSeconds > data.originalFrameCount/data.originalSourceSampleRate + 1e-6)
		throw new RangeError('Original source seconds required');
	const first = Math.floor(beginSeconds*data.originalSourceSampleRate/data.binFrames);
	const last = Math.min(data.timeline.length-1,Math.floor((endSeconds*data.originalSourceSampleRate-1)/data.binFrames));
	const out=[];
	let previous = null;
	for (let i=first;i<=last;i++) {
		const row=data.timeline[i];
		const notes=resonanceNotes(row);
		const key=notes.map(n=>n.pc).join(',');
		const strength=notes.length ? .12 + Math.min(.30,row.confidence*.3) : 0;
		if (i===first || key!==previous?.key || Math.abs(strength-(previous?.strength||0))>.055) {
			out.push({atSeconds:Math.max(beginSeconds,row.startFrame/data.originalSourceSampleRate),
				sourceBinIndex:i,notes,strength,unverified:true});
			previous={key,strength};
		}
	}
	return out;
}

export function boundedWetMix(amount) {
	return Number.isFinite(amount) ? Math.min(.55,Math.max(0,amount)) : 0;
}
