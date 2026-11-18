#!/usr/bin/env python3
"""Fail-closed, independent-human-review consensus for Gym quarter-note pulses.

Inputs are recording-bound human annotations. Output is NOT a valid production
BeatGridTiming format, and NEVER changes any actual game beat metadata.
Two reviewers must independently listen, attest and mark the SAME pulse per
12-second source segment (within tolerance); conflicts become uncertain.
Text attestations can be forged; formal release still requires real human
approval and source hash checks. This tool does not certify musical truth.
"""
import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path

FORMAT = 'bitstream-quarter-pulse-human-review-v1'
CANDIDATE_FORMAT = 'bitstream-quarter-pulse-consensus-candidate-v1'
ATTESTATION = 'I independently listened to the original recording and marked the regular musical quarter-note pulse, not a subdivision or syncopated accent.'
MIN_CONFIDENCE = .90
MAX_PHASE_ERROR_SECONDS = .045


def sha_file(path):
	return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def ensure(condition, message):
	if not condition:
		raise ValueError(message)


def valid_int(value):
	return type(value) is int and value >= 0


def source_identity(queue, manifest, manifest_hash):
	ensure(queue.get('format') == 'bitstream-gym-source-bound-human-beat-review-queue-v1',
		'Expected source-bound queue')
	ensure(queue.get('status') == 'UNVERIFIED_RESEARCH_ONLY_NO_SHIPPING_BEAT_GRIDS',
		'Queue unexpectedly no longer research-only')
	ensure(queue.get('metadataSha256') == manifest_hash, 'Shipped music pack changed')
	for key, val in [('trackId', manifest.get('id')),
		('originalFrameCount',manifest.get('frameCount')),
		('originalSampleRate', manifest.get('sampleRate'))]:
		ensure(queue.get(key) == val, f'Pack mismatch: {key}')
	hash_ = queue.get('originalWavSha256')
	ensure(isinstance(hash_,str) and len(hash_) == 64 and
		all(ch in '0123456789abcdef' for ch in hash_), 'Missing original WAV hash')
	segments = manifest.get('segments')
	ensure(isinstance(segments,list) and 1 <= len(segments) <= 200,
		'Pack sections missing')
	ensure(len(queue.get('allSections',[])) == len(segments),
		'Queue section count differs from music pack')
	for i, (queue_section, segment) in enumerate(zip(queue['allSections'],segments)):
		ensure(queue_section.get('segmentIndex') == i, 'Section index mismatch')
		ensure(queue_section.get('originalSourceStartFrame') == segment['startFrame'],
			'Queue section start frame differs from source')
		ensure(queue_section.get('originalSourceEndFrame') ==
			segment['startFrame']+segment['frames'],
			'Queue section end frame differs from source')
	return dict(trackId=manifest['id'],originalWavSha256=hash_,
		manifestSha256=manifest_hash,sourceFrameCount=manifest['frameCount'],
		sourceSampleRate=manifest['sampleRate'])


def make_template(queue, manifest, manifest_hash):
	identity = source_identity(queue,manifest,manifest_hash)
	return dict(format=FORMAT,**identity,
		reviewerId='',reviewerRole='independent-human',
		attestation='PENDING',
		reviewVersion='1',
		sections=[dict(segmentIndex=i,status='uncertain',confidence=0,
			meter='unresolved',pulseFrames=[],notes='Not yet independently reviewed')
			for i,_ in enumerate(manifest['segments'])],
		instructions=['Enter your own nonempty reviewer ID, without using another reviewer\'s answers',
			'Review the actual original WAV whose SHA-256 is recorded above',
			'For every source section, independently identify the regular quarter-note pulse',
			'Only use status reviewed if you listened and marked every expected pulse in that segment',
			'Set meter regular-quarter-note, confidence >=0.90, pulseFrames as original 48kHz sample indices',
			'Otherwise leave uncertain with empty pulseFrames; document ambiguity',
			'Set attestation to the documented exact sentence only after actually reviewing',
			'Do not merge or promote this template, or output from this tool, into the game'])


def validate_review(review, identity, segments):
	ensure(review.get('format') == FORMAT, 'Wrong review format')
	for name,expected in identity.items():
		ensure(review.get(name) == expected,f'Reviewer provenance mismatch: {name}')
	who=review.get('reviewerId')
	ensure(isinstance(who,str) and 2 <= len(who.strip()) <= 120,
		'Missing independent reviewer identity')
	ensure(review.get('reviewerRole') == 'independent-human',
		'Reviewer must identify as independent human')
	ensure(review.get('attestation') == ATTESTATION,
		'Missing accountable listening attestation')
	values=review.get('sections')
	ensure(isinstance(values,list) and len(values) == len(segments),
		'Missing section judgments; unreviewed sections must be explicitly uncertain')
	rate=identity['sourceSampleRate']
	for i,(entry,seg) in enumerate(zip(values,segments)):
		ensure(entry.get('segmentIndex') == i, f'Reviewer section {i} identity mismatch')
		status=entry.get('status')
		ensure(status in ('uncertain','reviewed'),f'Section {i} invalid review status')
		beats=entry.get('pulseFrames')
		ensure(isinstance(beats,list) and all(valid_int(p) for p in beats),
			f'Section {i} noninteger pulse frame')
		ensure(all(seg['startFrame'] <= p < seg['startFrame']+seg['frames']
			for p in beats),f'Section {i} pulse outside section')
		ensure(all(right > left for left,right in zip(beats,beats[1:])),
			f'Section {i} unsorted/duplicate pulse positions')
		confidence=entry.get('confidence')
		ensure(type(confidence) in (int,float) and math.isfinite(confidence) and
			0 <= confidence <= 1,f'Section {i} invalid confidence')
		ensure(isinstance(entry.get('notes'),str),f'Section {i} missing review notes')
		if status == 'uncertain':
			ensure(len(beats) == 0,f'Section {i} uncertain must contain no beat frames')
			continue
		ensure(entry.get('meter') == 'regular-quarter-note',
			f'Section {i} meter identity not confirmed')
		ensure(confidence >= MIN_CONFIDENCE,
			f'Section {i} reviewer confidence insufficient')
		ensure(len(beats) >= 6,f'Section {i} underannotated: require >=6 beat anchors')
		spacings=[(right-left)/rate for left,right in zip(beats,beats[1:])]
		ensure(all(.24 <= interval <= 2.01 for interval in spacings),
			f'Section {i} implausible rhythmic pulse interval')
		median=statistics.median(spacings)
		ensure(all(.62*median <= delta <= 1.62*median for delta in spacings),
			f'Section {i} missing pulse or abrupt unreviewed tempo discontinuity')
		# No 2-sec isolated high-confidence island buried inside a 12-sec
		# section. This check still does not infer meter/phase without people.
		first_gap=(beats[0]-seg['startFrame'])/rate
		last_gap=(seg['startFrame']+seg['frames']-beats[-1])/rate
		ensure(first_gap <= median*1.6 and last_gap <= median*1.6,
			f'Section {i} incomplete quarter-note coverage')
	return who.strip()


def compare_pulses(left,right,max_difference_frames):
	if len(left)!=len(right):
		return dict(trustedConsensus=False,reason='different-beat-count',
			maxDifferenceFrames=None,consensusFrames=[])
	diff=[abs(a-b) for a,b in zip(left,right)]
	if not diff:
		return dict(trustedConsensus=False,reason='no-beats',
			maxDifferenceFrames=None,consensusFrames=[])
	if max(diff)>max_difference_frames:
		return dict(trustedConsensus=False,reason='phase-disagreement',
			maxDifferenceFrames=max(diff),consensusFrames=[])
	return dict(trustedConsensus=True,reason='two-reviewer-pulse-agreement',
		maxDifferenceFrames=max(diff),consensusFrames=[(a+b)//2 for a,b in zip(left,right)])


def compile_candidate(queue,manifest,manifest_hash,left,right):
	identity=source_identity(queue,manifest,manifest_hash)
	who_a=validate_review(left,identity,manifest['segments'])
	who_b=validate_review(right,identity,manifest['segments'])
	ensure(who_a.casefold()!=who_b.casefold(),'Two distinct human reviewer IDs required')
	sections=[]
	for i,segment in enumerate(manifest['segments']):
		a=left['sections'][i]
		b=right['sections'][i]
		status='uncertain'
		reason='at-least-one-reviewer-uncertain'
		frames=[]
		confidence=0
		maximum=None
		if a['status']=='reviewed' and b['status']=='reviewed':
			match=compare_pulses(a['pulseFrames'],b['pulseFrames'],
				int(MAX_PHASE_ERROR_SECONDS * identity['sourceSampleRate']))
			reason=match['reason']
			maximum=match['maxDifferenceFrames']
			if match['trustedConsensus']:
				status='human-consensus-candidate'
				confidence=min(a['confidence'],b['confidence'])
				frames=match['consensusFrames']
		sections.append(dict(segmentIndex=i,startFrame=segment['startFrame'],
			endFrame=segment['startFrame']+segment['frames'],
			status=status,confidence=confidence,reason=reason,
			maxInterReviewerDifferenceFrames=maximum,
			candidateQuarterPulseFrames=frames,
			reviewerConfidence=[a['confidence'],b['confidence']],
			approvedForGame=False))
	return dict(format=CANDIDATE_FORMAT,**identity,
		status='RESEARCH_CANDIDATE_NOT_APPROVED_FOR_GAME',
		reviewers=[who_a,who_b],
		maxInterReviewerDisagreementMs=MAX_PHASE_ERROR_SECONDS*1000,
		allSections=sections,
		consensusCandidateSections=sum(x['status']=='human-consensus-candidate' for x in sections),
		unresolvedSections=sum(x['status']=='uncertain' for x in sections),
		note='Even reviewer agreement is not release approval. This output is not the runtime beat-grid format and CANNOT authorize Gym timing. Requires independent final musical/source integrity signoff and manual release promotion.')


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--mode',choices=['template','compare'],required=True)
	p.add_argument('--manifest',required=True)
	p.add_argument('--queue',required=True)
	p.add_argument('--review-a')
	p.add_argument('--review-b')
	p.add_argument('--out',required=True)
	args=p.parse_args()
	out=Path(args.out)
	ensure(not out.exists(),f'Refusing to overwrite existing evidence {out}')
	manifest_path=Path(args.manifest)
	manifest=json.loads(manifest_path.read_text())
	queue=json.loads(Path(args.queue).read_text())
	manifest_hash=sha_file(manifest_path)
	if args.mode=='template':
		data=make_template(queue,manifest,manifest_hash)
	else:
		ensure(bool(args.review_a and args.review_b),
			'Both independent reviewer submissions required')
		data=compile_candidate(queue,manifest,manifest_hash,
			json.loads(Path(args.review_a).read_text()),
			json.loads(Path(args.review_b).read_text()))
	out.write_text(json.dumps(data,indent=2)+'\n')
	print('STATUS',data.get('status','PENDING_REVIEW_TEMPLATE'))
	print('SOURCE',data['trackId'],data['originalWavSha256'])
	if args.mode=='compare':
		print('CONSENSUS_SECTIONS',data['consensusCandidateSections'],
			'UNRESOLVED_SECTIONS',data['unresolvedSections'])
	print('REPORT',out,'SHA256',sha_file(out))


if __name__=='__main__':
	main()
