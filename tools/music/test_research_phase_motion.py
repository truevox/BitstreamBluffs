#!/usr/bin/env python3
"""Synthetic phase-vs-accent controls, no real song timing labels."""
from __future__ import annotations
import json
import unittest
from pathlib import Path
import numpy as np
from research_phase_motion import (
	TICK,FORMAT,STATUS,wrapped_beats,phase_trace,circular_steps,
	cross_role_phase_motion,
)
ROOT=Path(__file__).resolve().parents[2]


def fake(bpm_at,seconds=72.,onset_offset=.15,late_shift=0.,gain=1.):
	x=np.zeros(round(seconds/TICK),dtype=float)
	t=onset_offset
	while t<seconds-.25:
		center=round((t+(late_shift if t>=seconds/2 else 0.))/TICK)
		if center<len(x):
			for n in range(-5,6):
				if 0<=center+n<len(x):x[center+n]+=np.exp(-.22*n*n)*gain
		t+=60/bpm_at(t)
	return x


class TestSourcePhaseMotion(unittest.TestCase):
	def test_wrapped_circular_phase_beats_cross_boundary(self):
		self.assertAlmostEqual(wrapped_beats(2*np.pi*.49,2*np.pi*(-.49)),.02,places=4)
		self.assertAlmostEqual(wrapped_beats(0.,np.pi),.5,places=4)

	def test_constant_pulse_with_instrument_offsets_has_no_coherent_motion(self):
		streams={r:phase_trace(fake(lambda t:163.8,onset_offset=.10+i*.016),163.8)
			for i,r in enumerate(('drums','bass','guitar','piano','other'))}
		c=cross_role_phase_motion(streams)
		self.assertGreater(len(c),5)
		self.assertTrue(all(a['gate']=='MULTIROLE_PHASE_STABLE_CANDIDATE_NOT_VERIFIED' for a in c))
		self.assertTrue(all(not a['candidateCommonChange'] for a in c))

	def test_single_stem_accent_shift_is_not_multi_role_drift(self):
		streams={r:phase_trace(fake(lambda t:163.8,seconds=72,late_shift=(.18 if r=='bass' else 0.)),163.8)
			for r in ('drums','bass','guitar','piano','other')}
		c=cross_role_phase_motion(streams)
		self.assertTrue(all(not a['candidateCommonChange'] for a in c))
		self.assertTrue(any(abs(a['phaseStepCandidateBeats'])>.3 for a in circular_steps(streams['bass'])
			if a['phaseStepCandidateBeats'] is not None))

	def test_known_every_stem_drift_can_produce_shared_phase_motion(self):
		streams={r:phase_trace(fake(lambda t:160.+6*t/72,onset_offset=.12+i*.01),163.8)
			for i,r in enumerate(('drums','bass','guitar','piano','other'))}
		c=cross_role_phase_motion(streams)
		self.assertTrue(any(a['candidateCommonChange'] for a in c))
		self.assertTrue(all(a['candidateOnly'] for a in c))

	def test_silence_must_not_claim_common_phase_motion(self):
		traces={r:phase_trace(np.zeros(round(50/TICK)),163.8) for r in ('drums','bass','guitar','piano','other')}
		c=cross_role_phase_motion(traces)
		self.assertTrue(all(a['gate']=='INSUFFICIENT_MULTIROLE_EVIDENCE' for a in c))
		self.assertTrue(all(not a['candidateCommonChange'] for a in c))

	def test_invalid_inputs_fail_closed(self):
		for x in (np.array([]),np.array([-1.,1.]),np.array([np.nan,1.])):
			with self.assertRaises(ValueError):phase_trace(x,163.8)
		for bpm in (0.,float('nan'),-3.):
			with self.assertRaises(ValueError):phase_trace(np.ones(300),bpm)
		with self.assertRaises(ValueError):cross_role_phase_motion({},minimum_roles=3)

	def test_exact_source_hashes_and_no_true_beat_labels(self):
		p=ROOT/'docs/music-review/one-more-run-source-phase-motion-UNVERIFIED-20261121.json'
		j=json.loads(p.read_bytes())
		self.assertEqual(j['status'],STATUS)
		self.assertEqual(j['format'],FORMAT)
		self.assertEqual(j['sourceFrameCount'],8380800)
		self.assertEqual(len(j['originalStemSha256']),15)
		self.assertEqual(len(j['perStemSourcePhase']),5)
		self.assertGreater(len(j['crossStemCommonMotionCandidates']),20)
		self.assertTrue(all(r['candidateOnly'] for r in j['crossStemCommonMotionCandidates']))
		self.assertNotIn('verifiedBeatOnes',j)
		self.assertNotIn('approvedTempoMap',j)

if __name__=='__main__':unittest.main()
