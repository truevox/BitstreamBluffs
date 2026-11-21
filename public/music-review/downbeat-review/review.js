import { clicksForCandidate, sourceStemURL, candidateGroup, PACK_ROOT } from './clock.mjs';

const $ = id => document.getElementById(id);
let pack, packet, audioContext, playing = [], activeRequest = 0, currentOffset = 0;
const notes = new Map();
const sourceCache = new Map();
const roles = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];

function status(message) { $('status').textContent = message; }
function selected() {
	const w = packet.windows[Number($('window').value)];
	return { window: w, ...candidateGroup(w, Number($('bpm').value), Number($('phase').value), currentOffset) };
}
function key() {
	return [Number($('window').value), Number($('bpm').value), Number($('phase').value), currentOffset].join(':');
}
function refreshNotes() {
	const entry = notes.get(key());
	$('notes').value = entry?.notes ?? '';
	setJudgment(entry?.judgment ?? 'undecided');
	$('counts').textContent = notes.size + ' candidate observations in this page (not saved until downloaded).';
}
function setJudgment(value) {
	document.querySelectorAll('[data-judgment]').forEach(b => {
		b.setAttribute('aria-pressed', String(b.dataset.judgment === value));
	});
}
function refreshCandidate() {
	const c = selected();
	const offset = c.evidence;
	$('candidate').textContent = 'Source ' + c.window.startSeconds.toFixed(3)
		+ '–' + c.window.endSeconds.toFixed(3) + 's · ' + c.bpm + ' BPM *hypothesis*'
		+ ' · phase +' + c.phaseSeconds.toFixed(4) + 's · bar-offset ' + c.beatOneOffset
		+ ' · arbitrary source score ' + offset.score + ' (rank ' + offset.rank + '/4)'
		+ ' · sample bar lines: ' + offset.barStartsSeconds.slice(0, 5).join(', ') + 's';
	const h = c.window.hypotheses[Number($('bpm').value)].phases[Number($('phase').value)].harmonicRanking;
	const candidateHarmony = h?.find(row => row.beatOneOffset === c.beatOneOffset);
	const harmonicRank = h?.findIndex(row => row.beatOneOffset === c.beatOneOffset) + 1;
	const peaks = (c.window.strongHarmonicChanges ?? []).slice(0, 4)
		.map(row => row.sourceSeconds.toFixed(2) + 's (' + row.stemRole + ')').join(', ');
	$('harmony').textContent = candidateHarmony
		? 'HARMONY CROSS-CHECK (UNVERIFIED): this offset ranks ' + harmonicRank
			+ '/4 for local guitar/piano/other pitch-class changes; contrast '
			+ candidateHarmony.contrast.toFixed(4) + ', stems with positive support '
			+ candidateHarmony.stemSupport + '/3. Best harmony offset: '
			+ h[0].beatOneOffset + '. Selected strongest source change cues: ' + peaks + '.'
		: 'No source-bound harmonic cue comparison available for this phase.';
	const phase = c.window.phaseReview;
	$('phaseEvidence').textContent = phase && phase.candidateOnly && !phase.phraseOrMeterVerified
		? 'SOURCE PHASE CONTINUITY (UNVERIFIED): ' + phase.transitionsCovered
			+ ' nearby analysis transitions; ' + phase.uncertainTransitionCount
			+ ' insufficient multi-stem evidence, ' + phase.stableCandidateCount
			+ ' locally stable candidates and ' + phase.motionCandidateCount
			+ ' possible common-motion candidates. These are not verified musical beats, tempo drift or bar positions.'
		: 'No source-verified phase continuity analysis available; do not assume fixed tempo or approved beat one.';
	refreshNotes();
}
function refreshOffsets() {
	const window = packet.windows[Number($('window').value)];
	const model = window.hypotheses[Number($('bpm').value)];
	const phase = model.phases[Number($('phase').value)];
	currentOffset = phase.offsets.reduce((best, r) => r.rank < best.rank ? r : best).beatOneOffset;
	$('offsets').replaceChildren(...phase.offsets.map(r => {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = 'Beat-one shift +' + r.beatOneOffset + ' beats · rank ' + r.rank;
		button.setAttribute('aria-pressed', String(currentOffset === r.beatOneOffset));
		button.onclick = () => {
			stop();
			currentOffset = r.beatOneOffset;
			document.querySelectorAll('#offsets button').forEach((b, i) =>
				b.setAttribute('aria-pressed', String(i === r.beatOneOffset)));
			refreshCandidate();
		};
		return button;
	}));
	refreshCandidate();
}
function refreshPhases() {
	const w = packet.windows[Number($('window').value)];
	const model = w.hypotheses[Number($('bpm').value)];
	$('phase').replaceChildren(...model.phases.map((p, i) => new Option(
		'Phase ' + (i + 1) + ' (+' + p.phaseSeconds.toFixed(4) + 's)', String(i))));
	$('phase').value = '0';
	refreshOffsets();
}
function refreshBpm() {
	const w = packet.windows[Number($('window').value)];
	$('bpm').replaceChildren(...w.hypotheses.map((h, i) =>
		new Option(h.bpmHypothesis.toFixed(2) + ' BPM', String(i))));
	$('bpm').value = '0';
	refreshPhases();
}
function stop() {
	activeRequest++;
	for (const source of playing) {
		try { source.stop(); } catch { /* completed source */ }
		try { source.disconnect(); } catch { /* completed node */ }
	}
	playing = [];
	$('stop').disabled = true;
	$('play').disabled = !pack;
}
async function digest(text) {
	if (!crypto?.subtle) throw new Error('HTTPS or localhost required for source SHA-256 verification.');
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
async function originalStem(segmentIndex, role) {
	const url = sourceStemURL(pack, segmentIndex, role);
	const cached = sourceCache.get(url);
	if (cached) return cached;
	const response = await fetch(url);
	if (!response.ok) throw new Error('Missing original source stem: ' + role + ' (' + response.status + ')');
	const bytes = await response.arrayBuffer();
	const expected = packet.windows.find(w => w.segmentIndex === segmentIndex)
		?.originalStemHashesSha256?.[role];
	if (!expected) throw new Error('No exact source-stem fingerprint: ' + role);
	const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
		n => n.toString(16).padStart(2, '0')).join('');
	if (actual !== expected) throw new Error('Original audio SHA-256 mismatch for ' + role);
	const decoded = await audioContext.decodeAudioData(bytes);
	sourceCache.set(url, decoded);
	// Limit temporary decoded memory to two source windows.
	if (sourceCache.size > 12) {
		const first = sourceCache.keys().next().value;
		sourceCache.delete(first);
	}
	return decoded;
}
function click(time, beatOne) {
	const osc = audioContext.createOscillator(), gain = audioContext.createGain();
	osc.type = beatOne ? 'triangle' : 'sine';
	osc.frequency.setValueAtTime(beatOne ? 1150 : 650, time);
	gain.gain.setValueAtTime(0.0001, time);
	gain.gain.exponentialRampToValueAtTime(beatOne ? 0.14 : 0.045, time + 0.003);
	gain.gain.exponentialRampToValueAtTime(0.0001, time + (beatOne ? 0.075 : 0.045));
	osc.connect(gain).connect(audioContext.destination);
	osc.start(time); osc.stop(time + 0.085);
	playing.push(osc);
	osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}
async function play() {
	stop();
	const request = activeRequest;
	const c = selected();
	const mix = $('mix').value;
	const selectedRoles = mix === 'full' ? roles : mix === 'harmony'
		? ['guitar', 'piano', 'other'] : [mix];
	$('play').disabled = true;
	status('Loading real, unchanged OGG stems…');
	try {
		audioContext ??= new AudioContext();
		await audioContext.resume();
		const buffers = await Promise.all(selectedRoles.map(role =>
			originalStem(c.window.segmentIndex, role)));
		if (request !== activeRequest) return;
		const length = Math.min(9.5, c.window.endSeconds - c.window.startSeconds - 0.15,
			...buffers.map(b => b.duration - 0.15));
		if (length < 3) throw new Error('Source window unexpectedly short');
		const start = audioContext.currentTime + 0.16;
		const gainNode = audioContext.createGain();
		gainNode.gain.value = mix === 'full' ? 0.30 : mix === 'harmony' ? 0.45 : 0.9;
		gainNode.connect(audioContext.destination);
		playing.push(gainNode); // stop() also disconnects the shared mix node
		for (const buffer of buffers) {
			const source = audioContext.createBufferSource();
			source.buffer = buffer;
			source.connect(gainNode);
			source.start(start, 0, length);
			playing.push(source);
		}
		if ($('metronome').checked) {
			for (const tick of clicksForCandidate({
				bpm: c.bpm, phaseSeconds: c.phaseSeconds,
				beatOneOffset: c.beatOneOffset,
				startSeconds: c.window.startSeconds, durationSeconds: length
			})) click(start + tick.localSeconds, tick.beatOne);
		}
		status('Playing original ' + mix + ' stems + ' + ($('metronome').checked
			? 'UNVERIFIED accent hypothesis' : 'no click overlay') + '.');
		$('stop').disabled = false;
	} catch (error) {
		status('Playback unavailable: ' + error.message);
		$('play').disabled = false;
	}
}
async function load() {
	try {
		const [packResponse, candidatesResponse] = await Promise.all([
			fetch(PACK_ROOT + 'pack.json'), fetch('./candidates.json')]);
		if (!packResponse.ok || !candidatesResponse.ok) throw new Error('Research data or source pack not served.');
		const packText = await packResponse.text();
		pack = JSON.parse(packText);
		packet = await candidatesResponse.json();
		if (packet.status !== 'CANDIDATE_ONLY_NOT_VERIFIED_NOT_RELEASE'
			|| packet.source.trackId !== pack.id
			|| packet.source.frameCount !== pack.frameCount
			|| packet.source.sampleRate !== pack.sampleRate
			|| packet.source.manifestSha256 !== await digest(packText)) {
			throw new Error('Research/source pack identity mismatch: refusing to play misleading clicks.');
		}
		$('window').replaceChildren(...packet.windows.map((w, i) => new Option(
			'Segment ' + w.segmentIndex + ' · ' + w.startSeconds.toFixed(0)
			+ '–' + w.endSeconds.toFixed(1) + 's', String(i))));
		$('window').value = '0';
		refreshBpm();
		$('play').disabled = false;
		status('Ready: ' + packet.windows.length + ' original-source research windows. No downbeats approved.');
	} catch (error) {
		pack = null;
		status('Cannot initialize source-verified research packet: ' + error.message);
	}
}
$('window').addEventListener('change', () => { stop(); refreshBpm(); });
$('bpm').addEventListener('change', () => { stop(); refreshPhases(); });
$('phase').addEventListener('change', () => { stop(); refreshOffsets(); });
$('mix').addEventListener('change', stop);
$('play').addEventListener('click', play);
$('stop').addEventListener('click', () => { stop(); status('Stopped.'); });
document.querySelectorAll('[data-judgment]').forEach(b =>
	b.addEventListener('click', () => setJudgment(b.dataset.judgment)));
$('save').addEventListener('click', () => {
	if (!packet) return;
	const c = selected();
	const judgment = document.querySelector('[data-judgment][aria-pressed=true]').dataset.judgment;
	notes.set(key(), { segmentIndex: c.window.segmentIndex, sourceStartSeconds: c.window.startSeconds,
		bpmHypothesis: c.bpm, phaseSeconds: c.phaseSeconds,
		beatOneOffset: c.beatOneOffset, judgment, notes: $('notes').value });
	status('Observation held in this browser tab. Download JSON to retain it.');
	refreshNotes();
});
$('export').addEventListener('click', () => {
	if (!packet) return;
	const payload = { format: 'bitstream-unverified-listening-notes-v1',
		source: packet.source, status: 'HUMAN_OBSERVATIONS_NOT_VERIFIED_RELEASE_DATA',
		createdAt: new Date().toISOString(), observations: [...notes.values()] };
	const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'],
		{ type: 'application/json' }));
	const link = document.createElement('a');
	link.href = url; link.download = 'one-more-run-unverified-listening-notes.json';
	document.body.append(link); link.click(); link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
	status('Research notes downloaded. No game data was changed.');
});
load();
