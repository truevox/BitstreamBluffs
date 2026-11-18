#!/usr/bin/env python3
"""Research-only original-stem cross-spectral pulse agreement and phase maps.

No musical beat identities, quarter notes, or source grids are approved by
this script. All candidate pulse frames are EXPERIMENTAL REVIEW REFERENCES.
Uses decoded OGG stems in memory, never writes audio or game metadata.
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

ENVELOPE_RATE = TARGET_RATE / HOP
FFT_SIZE = 1 << 19
STEMS = ('drums', 'bass')



def phase_seconds(phasor, frequency):
	return float((-np.angle(phasor) / (2 * np.pi * frequency)) % (1 / frequency))


def wrapped_residual(a, b, period):
	return float((a - b + period / 2) % period - period / 2)


def top_spectral_peaks(envelope, n=20):
	fft = np.fft.rfft(envelope, n=FFT_SIZE)
	freq = np.fft.rfftfreq(FFT_SIZE, d=1 / ENVELOPE_RATE)
	mag = np.abs(fft)
	selection = (freq >= .55) & (freq <= 4.1)
	low = np.flatnonzero(selection)
	peaks, _ = find_peaks(mag[selection], distance=38)
	indices = sorted(low[peaks], key=lambda i: mag[i], reverse=True)[:n]
	return fft, freq, mag, [(float(freq[i]), float(mag[i])) for i in indices]


def phases_for_frequency(windows, frequency):
	period = 1 / frequency
	global_phasor = sum(
		complex(np.sum(env * np.exp(-2j * np.pi * frequency * indices / ENVELOPE_RATE)))
		for indices, env in windows
	)
	global_phase = phase_seconds(global_phasor, frequency)
	section = []
	for indices, env in windows:
		vec = np.sum(env * np.exp(-2j * np.pi * frequency * indices / ENVELOPE_RATE))
		strength = float(abs(vec) / max(float(np.sum(env)), 1e-6))
		local_phase = phase_seconds(vec, frequency)
		residual = wrapped_residual(local_phase, global_phase, period)
		section.append(dict(
			absoluteStartSeconds=round(float(indices[0]) / ENVELOPE_RATE, 6),
			phaseResidualMs=round(residual * 1000, 2),
			periodicConcentration=round(strength, 4),
			phaseDirectionCoherent=abs(residual) <= .055 and strength >= .07,
		))
	return global_phase, section


def related_frequency_pairs(first, second, max_items=14):
	out = []
	for f1, a1 in first[:max_items]:
		for f2, a2 in second[:max_items]:
			ratio = f1 / f2
			for num in range(1, 7):
				for den in range(1, 7):
					if abs(ratio - num / den) > .0045:
						continue
					if num == den and abs(f1 - f2) > .065:
						continue
					out.append(dict(drumsBpm=round(f1 * 60, 3),
						bassBpm=round(f2 * 60, 3),ratio=f'{num}:{den}',
						fractionalRatioResidual=round(abs(ratio - num / den), 6),
						drumPeakAmplitude=round(a1, 3),bassPeakAmplitude=round(a2, 3)))
					break
				else:
					continue
				break
	return sorted(out, key=lambda v:v['drumPeakAmplitude']*v['bassPeakAmplitude'], reverse=True)[:22]


def align_harmonic_sections(drum_check, bass_check, drum_bpm, bass_bpm,
		max_phase_error_ms=65, min_concentration=.09, ratio=2):
	"""Compare a bass pulse with a 2x drum subdivision, never declare meter.

	Reports reviewer-interest windows, not approved beat sections. The phase
	comparison wraps at the faster drum period (allowing alternating hits).
	"""
	if not np.isfinite(drum_bpm) or not np.isfinite(bass_bpm) or bass_bpm <= 0:
		return None
	if ratio not in (1, 2) or abs(drum_bpm / bass_bpm - ratio) > .005:
		return None
	period = 60 / drum_bpm
	sections = []
	for d, b in zip(drum_check['sections'], bass_check['sections']):
		if abs(d['absoluteStartSeconds'] - b['absoluteStartSeconds']) > .02:
			continue
		phase_d = drum_check['absoluteOnsetPhaseSeconds'] + d['phaseResidualMs'] / 1000
		phase_b = bass_check['absoluteOnsetPhaseSeconds'] + b['phaseResidualMs'] / 1000
		error_ms = wrapped_residual(phase_d, phase_b, period) * 1000
		strong = (d['periodicConcentration'] >= min_concentration and
			b['periodicConcentration'] >= min_concentration)
		interesting = strong and abs(error_ms) <= max_phase_error_ms
		sections.append(dict(startSeconds=d['absoluteStartSeconds'],
			bassDrumHarmonicPhaseErrorMs=round(error_ms, 2),
			bothStemsHavePeriodicOnsetEnergy=strong,
			candidateForHumanSpotCheck=interesting,
			status='REVIEW_ONLY_UNVERIFIED'))
	strong_windows=sum(s['bothStemsHavePeriodicOnsetEnergy'] for s in sections)
	aligned=sum(s['candidateForHumanSpotCheck'] for s in sections)
	# A descriptive null baseline, NOT a statistical significance test: the
	# rhythm/frequency pair and thresholds were selected after inspecting data.
	# Also section phases are not independent and may contain multiple meter.
	null_chance=min(1.0,2 * max_phase_error_ms / (period * 1000))
	null_expectation=strong_windows * null_chance
	return dict(ratio=f'{ratio}:1',drumsBpm=drum_bpm,bassBpm=bass_bpm,
		maxPhaseErrorMs=max_phase_error_ms,
		minConcentration=min_concentration,
		machineAlignedSections=aligned,bothStemsStrongSections=strong_windows,
		uniformRandomPhaseNullExpectedAlignments=round(null_expectation,3),
		uniformRandomPhaseNullProbability=round(null_chance,4),
		nullModelWarning='DESCRIPTIVE ONLY: post-selection and correlated sections invalidate formal significance claims',
		totalSections=len(sections),sections=sections,
		status='RESEARCH_ONLY_BOTH_STEMS_SUGGEST_PATTERN_NOT_METRICAL_BEAT')


def preview_frames(phase, frequency, total_frames, sample_rate, max_preview=10):
	# No machine-selected rhythm is promoted to a verified public grid.
	period = 1 / frequency
	frames = []
	for beat in range(max_preview):
		sec = phase + beat * period
		frame = int(round(sec * sample_rate))
		if 0 <= frame < total_frames:
			frames.append(frame)
	return frames


def analyze(manifest):
	pack = json.loads(manifest.read_text())
	count = int(pack['frameCount'] / pack['sampleRate'] * ENVELOPE_RATE) + 16
	windows = {}
	stem_info = {}
	for stem in STEMS:
		grid = np.zeros(count, dtype='float64')
		parts = []
		segment_hashes = []
		for segment in pack['segments']:
			file = manifest.parent / segment['sources'][stem]
			compressed = file.read_bytes()
			segment_hashes.append(hashlib.sha256(compressed).hexdigest())
			wave = decode_stem(file, seconds=segment['frames'] / pack['sampleRate'])
			env = onset_envelope(wave)
			if len(env) == 0:
				continue
			start = int(round(segment['startFrame'] / pack['sampleRate'] * ENVELOPE_RATE))
			indices = start + np.arange(len(env), dtype='int32')
			keep = indices < len(grid)
			indices, env = indices[keep], env[keep]
			grid[indices] += env
			parts.append((indices, env))
		windows[stem] = parts
		fft, freqs, mag, peaks = top_spectral_peaks(grid)
		stem_info[stem] = dict(
			segmentsAnalyzed=len(parts),
			segmentCompressedSha256=segment_hashes,
			strongestPeriodicities=[dict(bpm=round(f * 60, 3), peakMagnitude=round(v, 4)) for f,v in peaks[:12]],
			_fft=fft, _freqs=freqs, _mag=mag, _peaks=peaks,
		)
	# Rank only candidate rhythmic harmonics that BOTH independent stems have.
	pairs = related_frequency_pairs(stem_info['drums']['_peaks'], stem_info['bass']['_peaks'])
	independent = []
	for bpm in sorted(set(round(x, 3) for x in (
		[stem_info['bass']['_peaks'][0][0] * 60, stem_info['drums']['_peaks'][0][0] * 60]
		+ [pair['bassBpm'] for pair in pairs[:6]]
		+ [pair['drumsBpm'] for pair in pairs[:6]]
	))):
		f = bpm / 60
		stem_checks = {}
		for stem in STEMS:
			phase, sections = phases_for_frequency(windows[stem], f)
			stem_checks[stem] = dict(
				absoluteOnsetPhaseSeconds=round(phase, 6),
				sections=sections,
				coherentSections=sum(1 for s in sections if s['phaseDirectionCoherent']),
			)
		period = 1/f
		delta = abs(wrapped_residual(
			stem_checks['drums']['absoluteOnsetPhaseSeconds'],
			stem_checks['bass']['absoluteOnsetPhaseSeconds'], period))
		independent.append(dict(
			bpm=bpm, rhythmicPeriodSeconds=round(period, 6),
			betweenStemOnsetPhaseDifferenceMs=round(delta*1000, 2),
			stemPhaseEvidence=stem_checks,
			# These frames are preview-only, not a trusted quarter pulse grid.
			unverifiedPreviewPulseFrames=preview_frames(
				stem_checks['bass']['absoluteOnsetPhaseSeconds'], f,
				pack['frameCount'], pack['sampleRate']),
			status='NON_METRICAL_REVIEW_CANDIDATE_NOT_APPROVED',
		))
	# Check the strongest actual 2:1 harmonic pair, if present. Independent
	# stem peaks alone do not certify a listener's quarter-note definition.
	double_pair = next((p for p in pairs if p['ratio'] == '2:1'), None)
	double_support = None
	if double_pair:
		d = min(independent, key=lambda v: abs(v['bpm']-double_pair['drumsBpm']))
		b = min(independent, key=lambda v: abs(v['bpm']-double_pair['bassBpm']))
		if abs(d['bpm']-double_pair['drumsBpm']) < .01 and abs(b['bpm']-double_pair['bassBpm']) < .01:
			double_support=align_harmonic_sections(
				d['stemPhaseEvidence']['drums'],b['stemPhaseEvidence']['bass'],
				d['bpm'],b['bpm'])
	# 1:1 drum/bass frequency agreement is also useful, but it still
	# cannot tell us whether the shared periodicity is a quarter note.
	equal_pair = next((p for p in pairs if p['ratio'] == '1:1'), None)
	equal_support = None
	if equal_pair:
		d = min(independent, key=lambda v: abs(v['bpm']-equal_pair['drumsBpm']))
		b = min(independent, key=lambda v: abs(v['bpm']-equal_pair['bassBpm']))
		if abs(d['bpm']-equal_pair['drumsBpm']) < .01 and abs(b['bpm']-equal_pair['bassBpm']) < .01:
			equal_support=align_harmonic_sections(
				d['stemPhaseEvidence']['drums'],b['stemPhaseEvidence']['bass'],
				d['bpm'],b['bpm'],ratio=1)
	clean_stems = {}
	for stem, info in stem_info.items():
		clean_stems[stem] = {key:value for key,value in info.items() if not key.startswith('_')}
	return dict(
		trackId=pack['id'],sampleRate=pack['sampleRate'],frameCount=pack['frameCount'],
		manifestSha256=hashlib.sha256(manifest.read_bytes()).hexdigest(),
		stemEvidence=clean_stems,harmonicRelationships=pairs,
		doubleTimeCrossStemReview=double_support,
		equalTempoCrossStemReview=equal_support,
		pulseAlternatives=independent,
		status='RESEARCH_ONLY_NO_QUARTER_NOTE_APPROVAL',
	)


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument('--out', required=True)
	parser.add_argument('--track', default='local-one-more-run-bitstream-bluffs')
	args = parser.parse_args()
	out = Path(args.out)
	if out.exists():
		raise SystemExit(f'Refusing to overwrite: {out}')
	results = []
	for manifest in sorted(PACKS.glob('*/pack.json')):
		if args.track != 'all' and json.loads(manifest.read_text())['id'] != args.track:
			continue
		result=analyze(manifest)
		results.append(result)
		print('CROSS_STEM',result['trackId'],
			[(p['drumsBpm'],p['bassBpm'],p['ratio']) for p in result['harmonicRelationships'][:5]],
			'double_time_review',
			(result['doubleTimeCrossStemReview'] or {}).get('machineAlignedSections'),
			'equal_tempo_review',
			(result['equalTempoCrossStemReview'] or {}).get('machineAlignedSections'), flush=True)
	if not results:
		raise SystemExit(f'Unknown track: {args.track}')
	report=dict(format='bitstream-cross-stem-phase-research-v1',
		status='RESEARCH_ONLY_NEVER_AUTOMATICALLY_APPROVE',
		cautions=['musical quarter note not inferred from Fourier power',
			'half time/double time and polyrhythmic harmonics remain possible',
			'zero evidence of an accountable listening/spot check',
			'preview frames are not a verified release beat grid',
			'local phase concentration does not ensure source metrical truth'],
		tracks=results)
	out.write_text(json.dumps(report,indent=2)+'\n')
	print('REPORT',out,'SHA256',hashlib.sha256(out.read_bytes()).hexdigest())


if __name__ == '__main__':
	main()
