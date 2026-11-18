#!/usr/bin/env python3
"""Research ONLY: classify V2 drum-restrike vs delayed-copy echo proposals.

This never changes frozen scores, live stems, renderer behavior or settings.
Source-gold accuracy is unknown; do not promote on synthetic benchmarks.
"""
from collections import deque
import numpy as np
from scipy.signal import butter, sosfiltfilt
from detector_candidate_v2 import RATE, drum_simultaneous

BANDS = {'kick': (1600, 6500), 'snare': (450, 3300), 'hat': (4700, 7300)}


def aligned_attack_similarity(band, first, second):
	"""Compare attack texture in one pre-filtered family band.

	Returns maximum normalized correlation over a small alignment tolerance.
	This is a heuristic, NOT a probability of a genuine hit.
	"""
	a = int(first * RATE) + 48
	b = int(second * RATE) + 48
	length = int(.013 * RATE)
	if a < 0 or b < 0 or max(a, b) + length + 72 >= len(band):
		return 0.0, 0.0
	ref = band[a:a + length]
	ref_norm = float(np.linalg.norm(ref))
	if ref_norm < 1e-9:
		return 0.0, 0.0
	best = 0.0
	for offset in range(-64, 65, 8):
		comp = band[b + offset:b + offset + length]
		den = ref_norm * float(np.linalg.norm(comp))
		if den > 1e-9:
			best = max(best, abs(float(np.dot(ref, comp)) / den))
	ref_energy = float(np.sqrt(np.mean(ref ** 2)))
	comp_energy = float(np.sqrt(np.mean(band[b:b + length] ** 2)))
	return best, comp_energy / max(ref_energy, 1e-9)


def drum_echo_similarity_probe(y, *, correlation_cut=.65, energy_cut=.82):
	"""Return unapproved candidate events plus per-pair diagnostics."""
	y = np.asarray(y, dtype='float32')
	proposals, _ = drum_simultaneous(y, echo_guard='none')
	if not proposals:
		return [], {'algorithm':'v4-attack-texture-probe',
			'status':'synthetic-research-only-not-calibrated',
			'proposals':0,'accepted':0,'suspects':[],
			'confidenceCalibrated':False}
	filtered = {kind:sosfiltfilt(butter(3, [low, high],
		btype='bandpass', fs=RATE, output='sos'), y)
		for kind, (low, high) in BANDS.items()}
	accepted = []
	suspects = []
	recent = {kind:deque() for kind in BANDS}
	for proposal in proposals:
		kind = proposal['type']
		current = proposal['t']
		history = recent[kind]
		while history and current-history[0]['t'] > .17:
			history.popleft()
		prior = [hit for hit in history if .05 <= current-hit['t'] <= .17]
		if not prior:
			accepted.append(proposal)
			history.append(proposal)
			continue
		best_match = (0., 0., None)
		for hit in prior:
			corr, ratio = aligned_attack_similarity(filtered[kind], hit['t'], current)
			if corr > best_match[0]:
				best_match = (corr, ratio, hit['t'])
		corr, ratio, reference = best_match
		rejected = corr >= correlation_cut and ratio < energy_cut
		suspects.append({'type':kind, 't':current,
			'refT':reference, 'correlation':round(corr, 4),
			'ratio':round(ratio, 4), 'rejected':rejected})
		if not rejected:
			accepted.append(proposal)
			history.append(proposal)
	return accepted, {'algorithm':'v4-attack-texture-probe',
		'status':'synthetic-research-only-not-calibrated',
		'proposals':len(proposals),'accepted':len(accepted),
		'suspects':suspects,'confidenceCalibrated':False}
