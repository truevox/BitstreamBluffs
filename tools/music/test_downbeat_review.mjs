// Source-bound, dependency-free regression tests for the unverified listening tool.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { clicksForCandidate, candidateGroup, sourceStemURL } from
	'../../public/music-review/downbeat-review/clock.mjs';

const root = new URL('../../', import.meta.url);
const rawPack = fs.readFileSync(new URL('public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json', root));
const pack = JSON.parse(rawPack);
const packet = JSON.parse(fs.readFileSync(
	new URL('public/music-review/downbeat-review/candidates.json', root), 'utf8'));
const fullSource = JSON.parse(fs.readFileSync(
	new URL('docs/music-review/one-more-run-source-downbeat-candidates-ALL-WINDOWS-UNVERIFIED-20261120.json',root), 'utf8'));
const harmonicBuffer = fs.readFileSync(
	new URL('docs/music-review/one-more-run-harmonic-bar-cues-UNVERIFIED-20261120.json',root));
const harmony = JSON.parse(harmonicBuffer);
const digest = b => createHash('sha256').update(b).digest('hex');

test('source hash and research status must never masquerade as verified', () => {
	assert.equal(digest(rawPack), packet.source.manifestSha256);
	assert.equal(pack.id, packet.source.trackId);
	assert.equal(packet.status, 'CANDIDATE_ONLY_NOT_VERIFIED_NOT_RELEASE');
	assert.equal(packet.originalSegmentCount, 15);
	assert.equal(packet.windows.length, 15);
	assert.equal(packet.windows.every(w => w.status === 'unverified'), true);
	assert.equal(packet.windows.every(w => w.reviewerStatus === 'pending'), true);
});

test('original audio URLs are source-owned and never route to generated adaptive variants', () => {
	assert.equal(sourceStemURL(pack, 0, 'drums').endsWith('/0000-drums.ogg'), true);
	assert.throws(() => sourceStemURL({ segments: [{ sources: { drums: '../bad.ogg' } }] },
		0, 'drums'));
	assert.throws(() => sourceStemURL(pack, 0, 'unsupported'));
});

test('each hypothesis carries all four bar starts and the clicks match report timestamps', () => {
	for (const w of packet.windows) {
		for (let h = 0; h < w.hypotheses.length; h++) {
			for (let p = 0; p < w.hypotheses[h].phases.length; p++) {
				const phase = w.hypotheses[h].phases[p];
				assert.deepEqual(phase.offsets.map(o => o.beatOneOffset), [0, 1, 2, 3]);
				for (let offset = 0; offset < 4; offset++) {
					const c = candidateGroup(w, h, p, offset);
					const beats = clicksForCandidate({
						bpm: c.bpm, phaseSeconds: c.phaseSeconds, beatOneOffset: offset,
						startSeconds: w.startSeconds, durationSeconds: 11.5
					}).filter(x => x.beatOne);
					for (const expected of c.evidence.barStartsSeconds.filter(
						x => x < w.startSeconds + 11.5 - 0.00001)) {
						assert.ok(beats.some(t => Math.abs(t.sourceSeconds - expected) <= 0.001),
							'Candidate bar start not represented in scheduled downbeat clicks');
					}
				}
			}
		}
	}
});

test('meter accents are exclusive, regular, and remain inside the source time window', () => {
	const args = { bpm: 160, phaseSeconds: 0.05, startSeconds: 72, durationSeconds: 8 };
	const grids = Array.from({ length: 4 }, (_, i) =>
		clicksForCandidate({ ...args, beatOneOffset: i }));
	assert.deepEqual(grids.map(g => g.map(x => x.localSeconds)),
		Array(4).fill(grids[0].map(x => x.localSeconds)));
	for (let beat = 0; beat < grids[0].length; beat++) {
		assert.equal(grids.filter(g => g[beat].beatOne).length, 1);
		assert.ok(grids[0][beat].sourceSeconds >= 72);
		assert.ok(grids[0][beat].sourceSeconds < 80);
	}
	assert.throws(() => clicksForCandidate({ ...args, beatOneOffset: 4 }));
});

test('harmonic comparison remains explicitly uncertain and source-hash bound', () => {
	assert.equal(digest(harmonicBuffer), packet.source.harmonicReportSha256);
	assert.equal(harmony.manifestSha256, packet.source.manifestSha256);
	assert.equal(harmony.drumBassResearchReportSha256, packet.source.candidateReportSha256);
	assert.equal(harmony.status, 'SOURCE_HARMONIC_CUES_NOT_APPROVED_DOWNBEATS');
	assert.equal(fullSource.windows.length, packet.windows.length);
	for (const w of packet.windows) {
		assert.deepEqual(Object.keys(w.originalStemHashesSha256).sort(),
			['bass','drums','guitar','other','piano','vocals']);
		assert.equal(Object.values(w.originalStemHashesSha256)
			.every(hash => /^[a-f0-9]{64}$/.test(hash)), true);
		assert.equal(w.hypotheses.length,3);
		for (const model of w.hypotheses) for (const phase of model.phases) {
			assert.equal(phase.harmonicRanking.length,4);
			assert.deepEqual(phase.harmonicRanking.map(r=>r.beatOneOffset).sort(), [0,1,2,3]);
			assert.equal(phase.harmonicRanking.every(r=>Number.isFinite(r.contrast)),true);
		}
	}
});
