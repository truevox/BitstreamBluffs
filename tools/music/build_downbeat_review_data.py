#!/usr/bin/env python3
"""Build a small, explicitly unverified browser listening packet from source evidence.

The source audio is NEVER copied, resampled, or modified here. Only candidate
metadata is repackaged, with the manifest and report hashes retained.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'docs/music-review/one-more-run-source-downbeat-candidates-ALL-WINDOWS-UNVERIFIED-20261120.json'
HARMONY_SOURCE = ROOT / 'docs/music-review/one-more-run-harmonic-bar-cues-UNVERIFIED-20261120.json'
GLOBAL_SOURCE = ROOT / 'docs/music-review/one-more-run-global-pulse-coherence-UNVERIFIED-20261121.json'
PHASE_SOURCE = ROOT / 'docs/music-review/one-more-run-source-phase-motion-UNVERIFIED-20261121.json'
ORIGINAL_MP3_SOURCE = ROOT / 'docs/music-review/one-more-run-original-mp3-mix-phase-UNVERIFIED-20261121.json'
ORIGINAL_WAV_SOURCE = ROOT / 'docs/music-review/one-more-run-verified-wav-master-structure-UNVERIFIED-20261121.json'
PACK = ROOT / 'public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json'
DEST = ROOT / 'public/music-review/downbeat-review/candidates.json'

def build_packet(report: dict, pack: dict, report_hash: str, harmony: dict, harmony_hash: str,
		global_report:dict, global_hash:str, phase_report:dict, phase_hash:str,
		original_mp3:dict, mp3_hash:str, original_wav:dict, wav_hash:str) -> dict:
	if report['status'] != 'UNVERIFIED_NO_BEAT_OR_DOWNBEAT_APPROVAL':
		raise ValueError('Research report is not explicitly unverified')
	if report['trackId'] != pack['id'] or report['sourceFrameCount'] != pack['frameCount']:
		raise ValueError('Report does not describe this source pack')
	if report['sourceSampleRate'] != pack['sampleRate']:
		raise ValueError('Source sample rates disagree')
	if harmony['format'] != 'bitstream-original-harmonic-downbeat-cues-UNVERIFIED-v1' or harmony['status'] != 'SOURCE_HARMONIC_CUES_NOT_APPROVED_DOWNBEATS':
		raise ValueError('Harmonic cues must be explicitly unverified')
	if harmony['manifestSha256'] != report['manifestSha256'] or harmony['drumBassResearchReportSha256'] != report_hash:
		raise ValueError('Harmonic cues are not bound to this exact source/candidate report')
	if len(harmony['windows']) != len(report['windows']):
		raise ValueError('Harmonic window count differs from original source research')
	if (global_report.get('status') != 'NO_VERIFIED_MUSICAL_BEATS_OR_TEMPO_DRIFT'
		or global_report.get('originalSourceManifestSha256') != report['manifestSha256']
		or global_report.get('priorReportSha256') != report_hash
		or global_report.get('harmonicReportSha256') != harmony_hash):
		raise ValueError('Global phase evidence/source hash mismatch')
	if (phase_report.get('status') != 'RESEARCH_ONLY_PHASE_MOTION_NO_SOURCE_BEAT_APPROVAL'
		or phase_report.get('sourceManifestSha256') != report['manifestSha256']
		or phase_report.get('globalRhythmReportSha256') != global_hash
		or phase_report.get('priorReportSha256') != report_hash
		or phase_report.get('harmonicReportSha256') != harmony_hash):
		raise ValueError('Phase motion report does not match source evidence chain')
	if phase_report.get('sourceFrameCount') != pack['frameCount']:
		raise ValueError('Phase report source frame count mismatch')
	if (original_mp3.get('status')!='ORIGINAL_MIX_MATCHED_NO_VERIFIED_SOURCE_BEAT_OR_DRIFT'
		or original_mp3.get('sourceManifestSha256')!=report['manifestSha256']
		or original_mp3.get('sourceFrameCount')!=pack['frameCount']
		or original_mp3.get('priorGlobalSourcePhaseReportSha256')!=global_hash):
		raise ValueError('Original MP3 source comparison report identity mismatch')
	master=original_wav.get('master',{})
	if (original_wav.get('status')!='MASTER_VERIFIED_RHYTHM_AND_PHRASE_CANDIDATES_ONLY'
		or original_wav.get('originalMp3PriorReportSha256')!=mp3_hash
		or original_wav.get('originalMp3Sha256')!=original_mp3['originalMp3Sha256']
		or master.get('masterSha256')!='636bbd42f7ece1c085b4768f25fb0e65d7f29963a22a948e0b6e697ef0284721'
		or master.get('sourceFrameCount')!=pack['frameCount']
		or master.get('remoteReadOnly') is not True
		or master.get('noPersistentAudioCopy') is not True):
		raise ValueError('Master WAV source review does not match archived source evidence')
	master_passages=original_wav['suggestedShortHumanListeningReview']
	if not master_passages or any(p.get('candidateOnly') is not True or
		p.get('humanVerified') is not False or len(p.get('suggestedListenRangeSeconds',[]))!=2 or
		not (0<=p['suggestedListenRangeSeconds'][0]<p['centerSeconds']<
			p['suggestedListenRangeSeconds'][1]<=pack['frameCount']/pack['sampleRate']+.0001)
		for p in master_passages):
		raise ValueError('Invalid or accidentally promoted master WAV phrase candidate')
	phase_rows = phase_report['crossStemCommonMotionCandidates']
	if len(phase_rows) != 27 or any(row.get('candidateOnly') is not True for row in phase_rows):
		raise ValueError('Unverified source phase transition coverage incomplete')
	harmony_by_index = {w['segmentIndex']: w for w in harmony['windows']}
	out = []
	for w in report['windows']:
		hw = harmony_by_index[w['segmentIndex']]
		if hw['sourceStartSeconds'] != w['sourceStartSeconds'] or hw['candidateStatus'] != 'UNVERIFIED':
			raise ValueError('Harmonic segment timeline/status mismatch')
		harmony_by_phase = {(p['bpmHypothesis'], p['phaseSeconds']): p for p in hw['phaseOffsetComparisons']}
		segment = pack['segments'][w['segmentIndex']]
		if round(segment['startFrame']/pack['sampleRate'], 4) != w['sourceStartSeconds']:
			raise ValueError('Window/source segment start mismatch')
		if set(('drums', 'bass')) - set(segment['sources']):
			raise ValueError('Original drum and bass sources missing')
		by_bpm = []
		for h in w['hypotheses']:
			groups: dict[float, list[dict]] = {}
			for c in h['rankedLocalCandidates']:
				groups.setdefault(c['beatPhaseWithinWindowSeconds'], []).append(c)
			phases = []
			for phase, rivals in groups.items():
				harmonic_phase = harmony_by_phase.get((h['bpm'], phase))
				if harmonic_phase is None:
					raise ValueError('Missing precise harmonic comparison for BPM/phase')
				harmonic_offsets = harmonic_phase['harmonicChangeOffsets']
				if sorted(r['beatOneOffset'] for r in harmonic_offsets) != [0, 1, 2, 3]:
					raise ValueError('Incomplete harmonic four-way offset analysis')
				if sorted(c['barOffsetBeats'] for c in rivals) != [0, 1, 2, 3]:
					raise ValueError('Every phase must preserve four 4/4 meter offsets')
				phases.append({
					'phaseSeconds': phase,
					'harmonicRanking': [{'beatOneOffset': o['beatOneOffset'],
						'contrast': o['normalizedHarmonicChangeContrast'],
						'stemSupport': o['stemsSupportingThisOffset']} for o in harmonic_offsets],
					'offsets': [{
						'beatOneOffset': r['barOffsetBeats'],
						'barStartsSeconds': r['localBarStartSourceSeconds'],
						'score': r['combinedEvidenceScore'],
						'rank': r['meterOffsetRankWithinPhase']
					} for r in sorted(rivals, key=lambda x: x['barOffsetBeats'])]
				})
			by_bpm.append({'bpmHypothesis': h['bpm'], 'phases': phases})
		transition_rows = [row for row in phase_rows if
			w['sourceStartSeconds'] <= row['toCenterSeconds'] < w['sourceEndSeconds']]
		phase_summary = {
			'uncertainTransitionCount': sum(row['gate'] == 'INSUFFICIENT_MULTIROLE_EVIDENCE' for row in transition_rows),
			'stableCandidateCount': sum(row['gate'] == 'MULTIROLE_PHASE_STABLE_CANDIDATE_NOT_VERIFIED' for row in transition_rows),
			'motionCandidateCount': sum(row['gate'] == 'MULTIROLE_PHASE_CHANGE_CANDIDATE_NOT_VERIFIED' for row in transition_rows),
			'transitionsCovered': len(transition_rows),
			'candidateOnly': True,
			'phraseOrMeterVerified': False}
		stem_hashes = {role: evidence['sha256'] for role, evidence in
			(w['stemEvidence'] | hw['stemEvidence']).items()}
		if set(stem_hashes) != {'drums','bass','vocals','piano','other','guitar'}:
			raise ValueError('All six original source stem hashes required')
		out.append({
			'originalStemHashesSha256': stem_hashes,
			'phaseReview': phase_summary,
			'segmentIndex': w['segmentIndex'], 'startSeconds': w['sourceStartSeconds'],
			'endSeconds': w['sourceEndSeconds'], 'hypotheses': by_bpm,
			'strongHarmonicChanges': hw['strongestLocalHarmonicChanges'][:6],
			'status': 'unverified', 'reviewerStatus': 'pending'
		})
	return {
		'format': 'bitstream-unverified-source-downbeat-audition-v1',
		'status': 'CANDIDATE_ONLY_NOT_VERIFIED_NOT_RELEASE',
		'source': {'trackId': pack['id'], 'sampleRate': pack['sampleRate'],
			'frameCount': pack['frameCount'], 'manifestSha256': report['manifestSha256'],
			'candidateReportSha256': report_hash, 'harmonicReportSha256': harmony_hash,
			'globalPhaseReportSha256': global_hash, 'phaseMotionReportSha256': phase_hash,
			'originalMp3MixReportSha256': mp3_hash, 'originalWavMasterStructureReportSha256': wav_hash,
			'originalMasterWavSha256': master['masterSha256']},
		'originalSegmentCount': len(pack['segments']),
		'suggestedSourcePassages': master_passages,
		'note': 'All 15 source segments analyzed; shorter 6.6-second ending has reduced evidence; all downbeats are unverified',
		'windows': out
	}

def main() -> None:
	report_bytes = SOURCE.read_bytes()
	pack_bytes = PACK.read_bytes()
	report = json.loads(report_bytes)
	if hashlib.sha256(pack_bytes).hexdigest() != report['manifestSha256']:
		raise ValueError('Source pack changed since candidate extraction; stop and re-analyze')
	harmonic_bytes = HARMONY_SOURCE.read_bytes()
	global_bytes = GLOBAL_SOURCE.read_bytes()
	phase_bytes = PHASE_SOURCE.read_bytes()
	mp3_bytes = ORIGINAL_MP3_SOURCE.read_bytes()
	wav_bytes = ORIGINAL_WAV_SOURCE.read_bytes()
	payload = build_packet(report, json.loads(pack_bytes), hashlib.sha256(report_bytes).hexdigest(),
		json.loads(harmonic_bytes), hashlib.sha256(harmonic_bytes).hexdigest(),
		json.loads(global_bytes), hashlib.sha256(global_bytes).hexdigest(),
		json.loads(phase_bytes), hashlib.sha256(phase_bytes).hexdigest(),
		json.loads(mp3_bytes), hashlib.sha256(mp3_bytes).hexdigest(),
		json.loads(wav_bytes), hashlib.sha256(wav_bytes).hexdigest())
	DEST.parent.mkdir(parents=True, exist_ok=True)
	DEST.write_text(json.dumps(payload, indent=2) + '\n')
	print('REVIEW_PACKET', DEST.relative_to(ROOT), 'windows', len(payload['windows']),
		'sha256', hashlib.sha256(DEST.read_bytes()).hexdigest())

if __name__ == '__main__':
	main()
