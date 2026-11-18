#!/usr/bin/env python3
"""Research-only cross-song, recording-position phase coherence.

The phase of a *percussion-onset comb* is NOT proof of musical quarter beats.
This script does not edit game beat metadata, tag a song verified, or assume
beat onset phase = regular pulse. Use it to prioritize independent reviews.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks

from research_gym_beat_candidates import (
	PACKS, TARGET_RATE, HOP, decode_stem, onset_envelope,
)

RATE = TARGET_RATE / HOP


def analyze(manifest):
	pack = json.loads(manifest.read_text())
	length_seconds = pack['frameCount'] / pack['sampleRate']
	grid = np.zeros(int(np.ceil(length_seconds * RATE)) + 2, dtype='float64')
	segments = []
	for index, segment in enumerate(pack['segments']):
		clip = manifest.parent / segment['sources']['drums']
		length = segment['frames'] / pack['sampleRate']
		samples = decode_stem(clip, seconds=length)
		env = onset_envelope(samples)
		if not len(env):
			continue
		start = segment['startFrame'] / pack['sampleRate']
		frame0 = int(round(start * RATE))
		indices = frame0 + np.arange(len(env))
		indices = indices[indices < len(grid)]
		env = env[:len(indices)]
		grid[indices] += env
		segments.append((start, indices, env))
	# FFT finds a *global* periodic attack train, not metrical tempo.
	length = 1 << 19
	spectrum = np.fft.rfft(grid, n=length)
	frequencies = np.fft.rfftfreq(length, 1 / RATE)
	power = np.abs(spectrum)
	valid = (frequencies >= .75) & (frequencies <= 3.6)
	candidates = np.flatnonzero(valid)
	peaks, _ = find_peaks(power[valid], distance=90)
	peaks = candidates[peaks]
	ordered = sorted(peaks, key=lambda i: power[i], reverse=True)[:12]
	out = []
	for fi in ordered:
		f = float(frequencies[fi]);period = 1/f
		global_angle = float(np.angle(spectrum[fi]))
		phase = ((-global_angle / (2*np.pi*f)) % period)
		local = []
		for start, indices, env in segments:
			times = indices/RATE
			vector = np.sum(env * np.exp(-2j*np.pi*f*times))
			local.append((start, vector))
		phases = [v / abs(v) for _, v in local if abs(v) > .01]
		coherence = abs(sum(phases)) / len(phases) if phases else 0
		left = sum(v for t,v in local if t < length_seconds/2)
		right = sum(v for t,v in local if t >= length_seconds/2)
		shift = 0
		if left and right:
			shift = float(np.angle(right / left) * period / (2*np.pi))
		out.append(dict(bpm=round(f*60,3),periodSeconds=round(period,6),
			globalOnsetPhaseSeconds=round(phase,6),
			periodicOnsetAmplitude=round(float(power[fi]),4),
			sectionPhaseVectorCoherence=round(float(coherence),4),
			halfRecordingPhaseDifferenceSeconds=round(shift,4),
			method='non-metrical FFT/percussive-onset phase; quarter-note identity NOT confirmed'))
	return dict(trackId=pack['id'],lengthSeconds=round(length_seconds,3),
		manifestSha256=hashlib.sha256(manifest.read_bytes()).hexdigest(),
		segmentsAnalyzed=len(segments),hypotheses=out,
		status='RESEARCH_ONLY_NOT_A_VERIFIED_BEAT_GRID')


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument('--out', required=True)
	args = parser.parse_args()
	path = Path(args.out)
	if path.exists():
		raise SystemExit('Refusing evidence overwrite: '+str(path))
	tracks = []
	for manifest in sorted(PACKS.glob('*/pack.json')):
		result = analyze(manifest)
		tracks.append(result)
		print('PHASE_PROBE',result['trackId'],
			[(h['bpm'],h['sectionPhaseVectorCoherence']) for h in result['hypotheses'][:4]],flush=True)
	report = dict(format='bitstream-global-onset-phase-coherence-research-v1',
		status='RESEARCH_ONLY_NEVER_AUTO_APPROVE',
		cautions=['Fourier peaks reflect onset periodicity, not metrical quarter-note truth',
			'Half/quarter/double time and syncopated phase ambiguity unresolved',
			'Phase and FFT of audio stems may reflect source separation or section changes',
			'Independent review and musical spot checks required before Gym beat timing'],
		tracks=tracks)
	path.write_text(json.dumps(report,indent=2)+'\n')
	print('REPORT',str(path),'SHA256',hashlib.sha256(path.read_bytes()).hexdigest())

if __name__=='__main__':
	main()
