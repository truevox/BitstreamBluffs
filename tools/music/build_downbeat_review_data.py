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
PACK = ROOT / 'public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json'
DEST = ROOT / 'public/music-review/downbeat-review/candidates.json'

def build_packet(report: dict, pack: dict, report_hash: str) -> dict:
	if report['status'] != 'UNVERIFIED_NO_BEAT_OR_DOWNBEAT_APPROVAL':
		raise ValueError('Research report is not explicitly unverified')
	if report['trackId'] != pack['id'] or report['sourceFrameCount'] != pack['frameCount']:
		raise ValueError('Report does not describe this source pack')
	if report['sourceSampleRate'] != pack['sampleRate']:
		raise ValueError('Source sample rates disagree')
	out = []
	for w in report['windows']:
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
				if sorted(c['barOffsetBeats'] for c in rivals) != [0, 1, 2, 3]:
					raise ValueError('Every phase must preserve four 4/4 meter offsets')
				phases.append({
					'phaseSeconds': phase,
					'offsets': [{
						'beatOneOffset': r['barOffsetBeats'],
						'barStartsSeconds': r['localBarStartSourceSeconds'],
						'score': r['combinedEvidenceScore'],
						'rank': r['meterOffsetRankWithinPhase']
					} for r in sorted(rivals, key=lambda x: x['barOffsetBeats'])]
				})
			by_bpm.append({'bpmHypothesis': h['bpm'], 'phases': phases})
		out.append({
			'segmentIndex': w['segmentIndex'], 'startSeconds': w['sourceStartSeconds'],
			'endSeconds': w['sourceEndSeconds'], 'hypotheses': by_bpm,
			'status': 'unverified', 'reviewerStatus': 'pending'
		})
	return {
		'format': 'bitstream-unverified-source-downbeat-audition-v1',
		'status': 'CANDIDATE_ONLY_NOT_VERIFIED_NOT_RELEASE',
		'source': {'trackId': pack['id'], 'sampleRate': pack['sampleRate'],
			'frameCount': pack['frameCount'], 'manifestSha256': report['manifestSha256'],
			'candidateReportSha256': report_hash},
		'originalSegmentCount': len(pack['segments']),
		'note': 'All 15 source segments analyzed; shorter 6.6-second ending has reduced evidence; all downbeats are unverified',
		'windows': out
	}

def main() -> None:
	report_bytes = SOURCE.read_bytes()
	pack_bytes = PACK.read_bytes()
	report = json.loads(report_bytes)
	if hashlib.sha256(pack_bytes).hexdigest() != report['manifestSha256']:
		raise ValueError('Source pack changed since candidate extraction; stop and re-analyze')
	payload = build_packet(report, json.loads(pack_bytes), hashlib.sha256(report_bytes).hexdigest())
	DEST.parent.mkdir(parents=True, exist_ok=True)
	DEST.write_text(json.dumps(payload, indent=2) + '\n')
	print('REVIEW_PACKET', DEST.relative_to(ROOT), 'windows', len(payload['windows']),
		'sha256', hashlib.sha256(DEST.read_bytes()).hexdigest())

if __name__ == '__main__':
	main()
