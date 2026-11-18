#!/usr/bin/env python3
"""Offline research ONLY: analyze three 12-second samples per original recording.

Stems provide independent onset/tempo hypotheses; neither metrical quarter-note
identity nor phase is certified automatically. Never promotes candidate to
release BeatGridCatalog; no audio writing, no sound asset mutation.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d, uniform_filter1d
from scipy.signal import correlate, find_peaks

ROOT = Path(__file__).resolve().parents[2]
PACKS = ROOT / 'public/music/packs'
TARGET_RATE = 11025
HOP = 110
MIN_LAG, MAX_LAG = 27, 118


def decode_stem(path, seconds=11.5):
	cmd = ['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path), '-t', str(seconds),
		'-ar', str(TARGET_RATE), '-ac', '1', '-f', 'f32le', 'pipe:1']
	process = subprocess.run(cmd, capture_output=True, check=True, timeout=40)
	return np.frombuffer(process.stdout, dtype='<f4').astype('float64')


def onset_envelope(audio):
	# Two independent envelope scales detect short percussive and longer bass
	# transitions, avoiding a single naive broadband onset threshold.
	if len(audio) < TARGET_RATE * 5:
		return np.zeros(0)
	energy = audio * audio
	short = np.sqrt(np.maximum(0, uniform_filter1d(energy, size=256)[::HOP]))
	long = np.sqrt(np.maximum(0, uniform_filter1d(energy, size=900)[::HOP]))
	ratio = np.maximum(0, short / (long + 1e-5) - 1.0)
	flux = np.maximum(0, np.diff(np.log1p(short * 100), prepend=0))
	combined = gaussian_filter1d(flux * 0.7 + ratio * 0.3, sigma=1)
	combined -= np.percentile(combined, 45)
	combined = np.maximum(0, combined)
	if np.max(combined) > 0:
		combined /= np.max(combined)
	return combined


def candidates(envelope):
	if len(envelope) < 300 or float(np.std(envelope)) < .005:
		return []
	centered = envelope - np.mean(envelope)
	acf = correlate(centered, centered, method='fft')[len(centered) - 1:]
	normalized = acf / (np.maximum(np.arange(len(acf), 0, -1), 1) *
		(float(np.var(centered)) + 1e-9))
	region = normalized[MIN_LAG:MAX_LAG]
	peaks, _ = find_peaks(region, distance=8)
	values = sorted([(float(region[i]), int(i + MIN_LAG)) for i in peaks], reverse=True)
	if not values:
		values = [(float(np.max(region)), int(np.argmax(region) + MIN_LAG))]
	out = []
	for strength, lag in values[:5]:
		period = lag * HOP / TARGET_RATE
		# Evaluate phase in sample bins; never claim onsets are downbeats.
		frames = np.arange(len(envelope), dtype=float)
		phases = np.linspace(0, lag, max(10, lag), endpoint=False)
		def score(phase):
			indices = np.arange(phase, len(envelope), lag).astype(int)
			indices = indices[(indices >= 0) & (indices < len(envelope))]
			return float(np.mean(envelope[indices])) if len(indices) else 0.0
		best_phase = max(phases, key=score)
		pulse_strength = score(best_phase)
		background = float(np.mean(envelope))
		out.append(dict(bpm=round(60 / period, 2), periodSeconds=round(period, 5),
			phaseOffsetSeconds=round(float(best_phase) * HOP / TARGET_RATE, 4),
			autocorrelation=round(strength, 4), pulseOnsetStrength=round(pulse_strength, 4),
			onsetMean=round(background, 4),
			note='Machine hypothesis only; subdivision vs quarter-note identity unknown'))
	return out


def main():
	p = argparse.ArgumentParser()
	p.add_argument('--out', required=True)
	args = p.parse_args()
	out = Path(args.out)
	if out.exists():
		raise SystemExit('Refusing to overwrite existing research report: ' + str(out))
	tracks = []
	for manifest in sorted(PACKS.glob('*/pack.json')):
		meta = json.loads(manifest.read_text())
		segments = meta['segments']
		selected = sorted(set([0, len(segments) // 2, max(0, len(segments) - 2)]))
		windows = []
		for index in selected:
			seg = segments[index]
			window = dict(startSeconds=round(seg['startFrame'] / meta['sampleRate'], 6),
				segmentIndex=index, stemEvidence={})
			for stem in ['drums', 'bass']:
				path = manifest.parent / seg['sources'][stem]
				audio = decode_stem(path)
				window['stemEvidence'][stem] = dict(
					sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
					durationSeconds=round(len(audio) / TARGET_RATE, 4),
					rms=round(float(np.sqrt(np.mean(audio * audio))), 5),
					candidatePulses=candidates(onset_envelope(audio)))
			windows.append(window)
		tracks.append(dict(trackId=meta['id'], sampleRate=meta['sampleRate'],
			frameCount=meta['frameCount'], durationSeconds=round(meta['frameCount'] / meta['sampleRate'], 3),
			status='RESEARCH_ONLY_UNVERIFIED_NOT_GYM_TRUSTED',
			manifestSha256=hashlib.sha256(manifest.read_bytes()).hexdigest(),
			windows=windows))
		print('ANALYZED', meta['id'],
			[(w['startSeconds'],w['stemEvidence']['drums']['candidatePulses'][0]['bpm']
				if w['stemEvidence']['drums']['candidatePulses'] else None) for w in windows], flush=True)
	report=dict(format='bitstream-gym-beat-candidate-research-v1',
		status='RESEARCH_ONLY_NO_TRUSTED_GRIDS',
		method='dual-stem onset envelopes + autocorrelation + phase ranking in 3 sampled 11.5s sections',
		limitations=['half/double-time ambiguity','cannot distinguish quarter pulse from syncopation',
			'sampled windows not full audio','source stem separation artifacts',
			'no independent human musical spot check'],tracks=tracks)
	out.parent.mkdir(parents=True, exist_ok=True)
	out.write_text(json.dumps(report, indent=2) + '\n')
	print('REPORT', out, 'SHA256', hashlib.sha256(out.read_bytes()).hexdigest())


if __name__=='__main__':
	main()
