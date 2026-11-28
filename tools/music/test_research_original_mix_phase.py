#!/usr/bin/env python3
"""Original mix provenance, matching-waveform and phase-source negative controls."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from research_original_mix_phase import (
	EXPECTED_MP3_SHA256,FORMAT,STATUS,RATE,TICK,
	zero_lag_reconstruction_match,decode_original_mp3,phase_comparison
)
from research_spectral_rhythm import spectral_onset,acf_periodicity
from research_global_pulse_phase import scan
from research_phase_motion import phase_trace

ROOT=Path(__file__).resolve().parents[2]


class TestOriginalMixIntegrity(unittest.TestCase):
	def test_same_pcm_source_has_strong_zero_lag(self):
		rng=np.random.default_rng(42)
		signal=rng.normal(size=RATE*2)
		other=signal*.81+rng.normal(size=len(signal))*.04
		r=zero_lag_reconstruction_match(signal,other)
		self.assertEqual(r['sourceLagSamplesAtAnalysisRate'],0)
		self.assertGreater(r['peakNormalizedPcmCorrelation'],.95)
		self.assertTrue(r['sourceReadOnly'])

	def test_shifted_source_can_identify_known_sample_lag(self):
		rng=np.random.default_rng(43)
		signal=rng.normal(size=RATE*2)
		shifted=np.r_[np.zeros(120),signal[:-120]]
		r=zero_lag_reconstruction_match(signal,shifted)
		self.assertEqual(r['sourceLagSamplesAtAnalysisRate'],-120)

	def test_silence_cannot_match_original(self):
		with self.assertRaises(ValueError):zero_lag_reconstruction_match(np.zeros(RATE),np.ones(RATE))

	def test_corrupt_mp3_sha_fails_before_decoding(self):
		with tempfile.TemporaryDirectory() as d:
			p=Path(d)/'one-more-run-original.mp3'
			p.write_bytes(b'different mp3 source content')
			with self.assertRaisesRegex(ValueError,'MP3 original mix source SHA-256 mismatch'):
				decode_original_mp3(p,174.6)

	def test_known_synthetic_full_mix_periodicity(self):
		seconds=18.
		x=np.zeros(round(seconds*RATE))
		t=.15
		while t<seconds-.2:
			c=round(t*RATE)
			window=np.arange(round(.024*RATE))/RATE
			burst=np.sin(2*np.pi*925*window)*np.hanning(len(window))
			x[c:c+len(burst)]+=burst
			t+=60/164.
		r=acf_periodicity(spectral_onset(x))
		self.assertAlmostEqual(r['preferredBpm'],164,delta=3)

	def test_identical_sources_have_consistent_window_phase(self):
		t=round(36/TICK)
		env=np.zeros(t)
		for sec in np.arange(.12,35.75,60/163.8):
			env[round(sec/TICK)]=1
		w=phase_trace(env,163.8)
		j=phase_comparison(w,w)
		self.assertEqual(j['coherentPairs'],len(w))
		self.assertTrue(all(r['originalMixMinusDrumPhaseCandidateBeats']==0 for r in j['comparisonWindows']))
		self.assertTrue(j['phaseOffsetIsNotVerifiedDownbeat'])

	def test_report_original_lossy_sha_and_unverified_status(self):
		j=json.loads((ROOT/'docs/music-review/one-more-run-original-mp3-mix-phase-UNVERIFIED-20261121.json').read_text())
		self.assertEqual(j['format'],FORMAT)
		self.assertEqual(j['status'],STATUS)
		self.assertEqual(j['sourceFrameCount'],8380800)
		self.assertEqual(j['originalMp3Sha256'],EXPECTED_MP3_SHA256)
		self.assertEqual(j['originalMp3Format'],'mp3')
		self.assertEqual(len(j['originalSourceSegmentReconstructionCheck']),3)
		self.assertTrue(all(r['sourceLagSamplesAtAnalysisRate']==0 for r in j['originalSourceSegmentReconstructionCheck']))
		self.assertTrue(all(r['peakNormalizedPcmCorrelation']>.55 for r in j['originalSourceSegmentReconstructionCheck']))
		self.assertEqual(len(j['localRhythmicPeriodComparisons']),28)
		self.assertNotIn('approvedBeatOnes',j)
		self.assertNotIn('verifiedTempo',j)

if __name__=='__main__':unittest.main()
