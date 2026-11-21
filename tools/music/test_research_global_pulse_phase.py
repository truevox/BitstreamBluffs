#!/usr/bin/env python3
"""Synthetic whole-source beat periodicity phase controls, not source truth."""
import json
import unittest
from pathlib import Path
import numpy as np
from research_global_pulse_phase import (
	TICK,FORMAT,STATUS,phase_vector,scan,compare_segments
)
ROOT=Path(__file__).resolve().parents[2]


def pulse(bpm_at,seconds=36):
	s=np.zeros(round(seconds/TICK))
	t=.12
	while t<seconds-.3:
		c=round(t/TICK)
		for i in range(-5,6):
			if 0<=c+i<len(s):s[c+i]+=np.exp(-(i/2.5)**2)
		t+=60/bpm_at(t)
	return s

class TestGlobalPhaseNoApproval(unittest.TestCase):
	def test_known_steady_tempo_has_coherent_pulse(self):
		s=pulse(lambda _:163.84)
		r=scan(s)
		self.assertEqual(r['status'],'CANDIDATES_UNVERIFIED')
		self.assertAlmostEqual(r['best']['bpm'],163.84,delta=.1)
		self.assertGreater(r['best']['relativeCoherence'],.8)
		self.assertTrue(r['candidateOnly'])

	def test_other_constant_tempo_independent_of_prompt(self):
		r=scan(pulse(lambda _:158.0))
		self.assertAlmostEqual(r['best']['bpm'],158,delta=.1)

	def test_known_tempo_drift_degrades_global_phase_coherence(self):
		steady=scan(pulse(lambda _:163.84))['best']['relativeCoherence']
		drift=scan(pulse(lambda t:155+17*t/36))['best']['relativeCoherence']
		self.assertGreater(steady,drift+.25)

	def test_phase_segments_preserve_original_absolute_timestamps(self):
		x=pulse(lambda _:163.84,seconds=50.)
		w=compare_segments(x,163.84,50.)
		self.assertEqual([v['sourceStartSeconds'] for v in w],[0,12,24,36])
		self.assertTrue(all(v['candidateOnly'] for v in w))
		self.assertLess(max(abs(v['phaseOffsetRadiansToWholeSong']) for v in w),.2)

	def test_silence_and_weak_source_cannot_claim_a_tempo(self):
		for x in (np.zeros(3000),np.ones(3000)*.001):
			self.assertEqual(scan(x)['status'],'INSUFFICIENT_PHASE_EVIDENCE')
			self.assertIsNone(scan(x)['best'])

	def test_nan_negative_and_empty_fail_closed(self):
		for x in (np.array([]),np.array([np.nan]),np.array([-1.,2.])):
			with self.subTest(data=str(x)):
				with self.assertRaises(ValueError):phase_vector(x,163.8)

	def test_output_preserves_genuine_source_and_no_meter_approval(self):
		p=ROOT/'docs/music-review/one-more-run-global-pulse-coherence-UNVERIFIED-20261121.json'
		r=json.loads(p.read_bytes())
		self.assertEqual(r['format'],FORMAT)
		self.assertEqual(r['status'],STATUS)
		self.assertEqual(r['frameCount'],8380800)
		self.assertEqual(len(r['originalSourceStemSha256']),15)
		self.assertEqual(set(r['roles']),{'drums','bass','guitar','piano','other'})
		self.assertNotIn('trueBeatOne',r)
		self.assertNotIn('verifiedBpm',r)

if __name__=='__main__':unittest.main()
