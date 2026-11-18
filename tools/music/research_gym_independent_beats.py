#!/usr/bin/env python3
"""Source-bound original-mix beat-track hypotheses for independent *review*.

Use librosa dynamic-programming beat tracking with multiple competing initial
rates, rather than promoting one onset-comb Fourier peak to musical truth.
All proposed times are UNVERIFIED and this tool cannot write game beat grids.
Receives streamed, downsampled mono PCM via stdin; writes NO WAV/audio files.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import librosa
import numpy as np

from research_gym_beat_candidates import TARGET_RATE

HOP = 256
PRIORS = (80.0, 120.0, 160.0)


def score_agreement(left, right, tolerance_seconds=0.055):
	"""Bidirectional nearest-neighbor beat coincidence; independent of count."""
	l = np.array(left, dtype=float)
	r = np.array(right, dtype=float)
	if not len(l) or not len(r):
		return dict(matchedLeftFraction=0.0, matchedRightFraction=0.0,
			matchedLeft=0,matchedRight=0)
	def count_matches(source, target):
		idx = np.searchsorted(target, source)
		prior = np.maximum(idx - 1, 0)
		after = np.minimum(idx, len(target) - 1)
		return int(np.count_nonzero(np.minimum(abs(source - target[prior]),
			abs(source - target[after])) <= tolerance_seconds))
	m_left = count_matches(l, r)
	m_right = count_matches(r, l)
	return dict(matchedLeftFraction=round(m_left/len(l),4),
		matchedRightFraction=round(m_right/len(r),4),
		matchedLeft=m_left,matchedRight=m_right)


def analyze(original_pcm, pack, source_sha, source_name):
	expected_duration=pack['frameCount']/pack['sampleRate']
	if abs(len(original_pcm)/TARGET_RATE - expected_duration) >= .2:
		raise ValueError('PCM input must match the original shipped recording length')
	if not np.isfinite(original_pcm).all():
		raise ValueError('Nonfinite source samples')
	envelope=librosa.onset.onset_strength(y=original_pcm,
		sr=TARGET_RATE,hop_length=HOP,aggregate=np.median)
	seconds=librosa.frames_to_time(np.arange(len(envelope)),sr=TARGET_RATE,
		hop_length=HOP)
	if np.max(envelope)>0:
		envelope=envelope/np.max(envelope)
	runs=[]
	for prior in PRIORS:
		tempo, beats = librosa.beat.beat_track(onset_envelope=envelope,
			sr=TARGET_RATE,hop_length=HOP,start_bpm=prior,
			tightness=45,trim=False,units='frames')
		beat_seconds=librosa.frames_to_time(beats,sr=TARGET_RATE,hop_length=HOP)
		beat_seconds=beat_seconds[(beat_seconds>=0)&(beat_seconds<expected_duration)]
		actual_periods=np.diff(beat_seconds)
		local=[]
		for seg in pack['segments']:
			start=seg['startFrame']/pack['sampleRate']
			end=(seg['startFrame']+seg['frames'])/pack['sampleRate']
			inside=beat_seconds[(beat_seconds>=start)&(beat_seconds<end)]
			spacings=np.diff(inside)
			local.append(dict(startSeconds=round(start,5),endSeconds=round(end,5),
				proposedBeatCount=int(len(inside)),
				medianProposedIntervalSeconds=round(float(np.median(spacings)),5)
					if len(spacings) else None,
				status='UNVERIFIED_METRICAL_IDENTITY'))
		value=float(np.asarray(tempo).reshape(-1)[0])
		runs.append(dict(initialTempoBpm=prior,estimatedTempoBpm=round(value,3),
			totalBeats=int(len(beat_seconds)),
			medianBeatIntervalSeconds=round(float(np.median(actual_periods)),5)
				if len(actual_periods) else None,
			firstBeatSeconds=round(float(beat_seconds[0]),5) if len(beat_seconds) else None,
			proposedBeatsSeconds=[round(float(x),5) for x in beat_seconds],
			segmentSummary=local,
			status='PROPOSAL_ONLY_NO_GYM_VERIFICATION'))
	agreement=[]
	for i, left in enumerate(runs):
		for right in runs[i+1:]:
			pair=score_agreement(left['proposedBeatsSeconds'],
				right['proposedBeatsSeconds'])
			agreement.append(dict(leftPrior=left['initialTempoBpm'],
				rightPrior=right['initialTempoBpm'],toleranceSeconds=.055,
				**pair))
	return dict(format='bitstream-original-mix-librosa-multiprior-beat-hypotheses-v1',
		status='INDEPENDENT_ALGORITHM_CHECK_NOT_INDEPENDENT_HUMAN_REVIEW',
		source=dict(trackId=pack['id'],originalWavSha256=source_sha,
			originalName=source_name,originalSampleRate=pack['sampleRate'],
			originalFrameCount=pack['frameCount'],
			decodedMonoSampleRate=TARGET_RATE,
			decodedPcmSha256=hashlib.sha256(original_pcm.astype('<f4').tobytes()).hexdigest()),
		method=dict(library='librosa',version=librosa.__version__,
			onset='librosa onset_strength median aggregated',
			tracker='librosa dynamic-programming beat_track; multiple start tempo priors',
			pcmSampleRate=TARGET_RATE,hopLength=HOP,
			priorsBpm=list(PRIORS),
			warning='three runs share ONE beat-tracking algorithm; NOT independent musical validation'),
		trackerRuns=runs,pairwiseCandidateAgreement=agreement,
		limits=['autocorrelation tempo and dynamic-programming phase both can prefer subdivisions',
			'no human listening or accountable metrical quarter-note annotation',
			'processing downsampled mono compressed from original unmodified WAV',
			'never promote beat frame estimates into released beat catalog automatically'])


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--original-sha256',required=True)
	p.add_argument('--original-name',required=True)
	p.add_argument('--manifest',required=True)
	p.add_argument('--out',required=True)
	args=p.parse_args()
	out=Path(args.out)
	if out.exists():
		raise SystemExit('Refusing evidence overwrite: '+str(out))
	pack=json.loads(Path(args.manifest).read_text())
	if len(args.original_sha256)!=64 or not all(c in '0123456789abcdef' for c in args.original_sha256):
		raise SystemExit('Missing verified original SHA-256')
	raw=sys.stdin.buffer.read()
	if len(raw)%4:
		raise SystemExit('Input is not little-endian float32 mono PCM')
	pcm=np.frombuffer(raw,dtype='<f4').astype('float64')
	d=analyze(pcm,pack,args.original_sha256,args.original_name)
	out.write_text(json.dumps(d,indent=2)+'\n')
	print('SOURCE',d['source']['trackId'])
	for run in d['trackerRuns']:
		print('TRACKER',run['initialTempoBpm'],run['estimatedTempoBpm'],
			'beats',run['totalBeats'],'start',run['firstBeatSeconds'])
	for pair in d['pairwiseCandidateAgreement']:
		print('PAIR',pair)
	print('REPORT',out,'SHA256',hashlib.sha256(out.read_bytes()).hexdigest())


if __name__=='__main__':
	main()
