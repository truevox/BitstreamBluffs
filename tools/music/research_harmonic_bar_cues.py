#!/usr/bin/env python3
"""Additional UNVERIFIED original guitar/piano/other chroma-change evidence.

This is not a chord transcription, human listening test, or a release bar grid.
Stem separation artifacts correlate channels; do not label stems independent.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks, stft

RATE = 11025
HOP = 128
FFT = 2048
STEP = HOP / RATE
ROLES = ('guitar', 'piano', 'other')
FORMAT = 'bitstream-original-harmonic-downbeat-cues-UNVERIFIED-v1'

def decode_source(source: Path, duration=11.5) -> np.ndarray:
	p = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-i', str(source),
		'-t', str(duration), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', 'pipe:1'],
		check=True, timeout=30, capture_output=True)
	return np.frombuffer(p.stdout, dtype='<f4').astype(np.float64)

def harmonic_novelty(samples: np.ndarray) -> np.ndarray:
	"""Pitch-class distribution changes across ~0.2-second neighborhoods."""
	if len(samples) < RATE * 2:
		return np.zeros(0)
	_, _, z = stft(samples, fs=RATE, nperseg=FFT, noverlap=FFT-HOP,
		boundary='zeros', padded=False)
	freq = np.fft.rfftfreq(FFT, 1/RATE)
	valid = (freq >= 105) & (freq <= 2700)
	pitch_class = np.rint(69 + 12*np.log2(freq[valid]/440)).astype(int) % 12
	magnitude = np.abs(z[valid]) ** .7
	chroma = np.zeros((12, z.shape[1]), dtype=np.float64)
	for pc in range(12):
		chroma[pc] = magnitude[pitch_class == pc].sum(axis=0)
	energy = chroma.sum(axis=0)
	chroma /= np.maximum(energy[None, :], 1e-9)
	chroma = gaussian_filter1d(chroma, sigma=2, axis=1)
	shift = 9  # 104ms before and after each proposed harmonic boundary
	before = np.roll(chroma, shift, axis=1)
	after = np.roll(chroma, -shift, axis=1)
	novelty = np.sqrt(np.sum((after-before)**2, axis=0))
	active = np.minimum(np.roll(energy, shift), np.roll(energy, -shift))
	gate = np.clip(active / max(np.percentile(energy, 75), 1e-9), 0, 1) ** .5
	novelty *= gate
	novelty[:shift+3] = 0
	novelty[-shift-3:] = 0
	novelty = gaussian_filter1d(novelty, sigma=2)
	peak = np.percentile(novelty, 97)
	return np.clip(novelty / peak, 0, 1) if peak > 1e-7 else np.zeros_like(novelty)

def nearby_salience(novelty: np.ndarray, seconds: float, radius=.07) -> float:
	at = int(round(seconds / STEP))
	r = int(round(radius / STEP))
	a = max(0, at-r); b = min(len(novelty), at+r+1)
	return float(np.max(novelty[a:b])) if b > a else 0.0

def offset_comparisons(tracks: dict[str, np.ndarray], bpm: float, phase: float,
	max_seconds: float) -> list[dict]:
	pulse = np.arange(phase, max_seconds-.1, 60/bpm)
	if len(pulse) < 10:
		return []
	values = {role: np.array([nearby_salience(tracks[role], t) for t in pulse])
		for role in ROLES}
	result = []
	for off in range(4):
		bars = np.arange(off, len(pulse), 4)
		other = np.array([i for i in range(len(pulse)) if i % 4 != off])
		if len(bars) < 2: continue
		contrasts = {role: round(float(values[role][bars].mean() -
			values[role][other].mean()), 4) for role in ROLES}
		result.append({'beatOneOffset': off,
			'normalizedHarmonicChangeContrast': round(sum(contrasts.values())/3, 4),
			'stemChangeContrasts': contrasts,
			'stemsSupportingThisOffset': sum(v > .025 for v in contrasts.values()),
			'candidateOnly': True})
	return sorted(result, key=lambda r: (-r['normalizedHarmonicChangeContrast'],
		-r['stemsSupportingThisOffset'],r['beatOneOffset']))

def analyze(pack_dir: Path, candidate_file: Path) -> dict:
	manifest_bytes = (pack_dir/'pack.json').read_bytes()
	manifest = json.loads(manifest_bytes)
	candidate_bytes = candidate_file.read_bytes()
	candidates = json.loads(candidate_bytes)
	if hashlib.sha256(manifest_bytes).hexdigest() != candidates['manifestSha256']:
		raise ValueError('Source manifest mismatch: abort before claiming source provenance')
	if candidates['status'] != 'UNVERIFIED_NO_BEAT_OR_DOWNBEAT_APPROVAL':
		raise ValueError('Candidate report must remain explicitly unverified')
	if len(candidates['windows']) != len(manifest['segments']):
		raise ValueError('Expected complete source report to avoid missing windows')
	result=[]
	for window in candidates['windows']:
		index = window['segmentIndex']; seg = manifest['segments'][index]
		start = seg['startFrame'] / manifest['sampleRate']
		if round(start,4) != window['sourceStartSeconds']:
			raise ValueError('Source segment timeline mismatch')
		stems={}; tracks={}; span=seg['frames']/manifest['sampleRate']
		for role in ROLES:
			f=pack_dir / seg['sources'][role]
			if not f.is_file():raise FileNotFoundError(f)
			data=decode_source(f)
			if len(data)/RATE < min(11, span-.2):raise ValueError('Short decoded source OGG')
			tracks[role]=harmonic_novelty(data)
			stems[role]={'relativePath':seg['sources'][role],
				'sha256': hashlib.sha256(f.read_bytes()).hexdigest()}
		# Source-vocal hash completes the six original stem fingerprints used by browser audition.
		vocal=pack_dir/seg['sources']['vocals']
		if not vocal.is_file():raise FileNotFoundError(vocal)
		stems['vocals']={'relativePath':seg['sources']['vocals'],
			'sha256':hashlib.sha256(vocal.read_bytes()).hexdigest()}
		span=min((len(v)-1)*STEP for v in tracks.values())
		phases=[]
		for model in window['hypotheses']:
			seen=set()
			for c in model['rankedLocalCandidates']:
				phase=c['beatPhaseWithinWindowSeconds']
				if phase in seen:continue
				seen.add(phase)
				rivals=offset_comparisons(tracks,model['bpm'],phase,span)
				if not rivals:continue
				prior=sorted((x for x in model['rankedLocalCandidates'] if
					x['beatPhaseWithinWindowSeconds']==phase),
					key=lambda r:r['meterOffsetRankWithinPhase'])[0]
				phases.append({'bpmHypothesis':model['bpm'],'phaseSeconds':phase,
					'originalDrumBassRankOneOffset':prior['barOffsetBeats'],
					'harmonicRankOneOffset':rivals[0]['beatOneOffset'],
					'harmonicAndPercussionRankingAgree':rivals[0]['beatOneOffset']==prior['barOffsetBeats'],
					'harmonicChangeOffsets':rivals})
		peaks=[]
		for role in ROLES:
			t=tracks[role]
			indices,prop=find_peaks(t,height=.55,prominence=.22,distance=max(1,int(.3/STEP)))
			peaks.extend((round(start+float(i*STEP),4), role, round(float(t[i]),4))
				for i in indices)
		peaks.sort(key=lambda x:(-x[2],x[0]))
		result.append({'segmentIndex':index,'sourceStartSeconds':start,
			'sourceEndSeconds':(seg['startFrame']+seg['frames'])/manifest['sampleRate'],
			'stemEvidence':stems,'candidateStatus':'UNVERIFIED',
			'strongestLocalHarmonicChanges':[
				{'sourceSeconds':t,'stemRole':role,'relativeStrength':score}
				for t,role,score in peaks[:12]],'phaseOffsetComparisons':phases})
		print('HARMONIC_WINDOW',index,'phase/options',len(phases),'local peaks',len(peaks),flush=True)
	return {'format':FORMAT,'status':'SOURCE_HARMONIC_CUES_NOT_APPROVED_DOWNBEATS',
		'manifestSha256':candidates['manifestSha256'],
		'drumBassResearchReportSha256':hashlib.sha256(candidate_bytes).hexdigest(),
		'method':'Source original guitar/piano/other chroma novelty; compare bar-phase contrasts, not true chords',
		'limitations':['Demucs stem separation channels are correlated, not independent instruments',
			'Short segment-local normalization and novelty may favor fills over phrase starts',
			'Unidentified actual bridge / section boundaries and human judgment absent',
			'These score differences do not constitute probability, true beat one or tempo validation'],
		'windows':result}

def main():
	p=argparse.ArgumentParser()
	p.add_argument('--source-pack',type=Path,required=True)
	p.add_argument('--candidates',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing overwrite of harmonic report')
	result=analyze(a.source_pack,a.candidates)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('REPORT_SHA256',hashlib.sha256(a.out.read_bytes()).hexdigest())
if __name__=='__main__':main()
