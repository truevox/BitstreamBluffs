#!/usr/bin/env python3
"""Metamorphic and control tests, not real One More Run beat annotations."""
import json
import unittest
import hashlib
from pathlib import Path
import numpy as np
from research_rhythm_consensus import (
	TICK, STATUS, FORMAT, periodicity_evidence, acf_strength,
	phase_lag_crosscheck, beat_path_agreement, standardized)


def synth_onsets(bpm=160.0, offset=.15, seconds=24., half_time=False):
	n=int(seconds/TICK)
	x=np.zeros(n,dtype=float)
	t=offset;i=0
	while t<seconds-.2:
		idx=int(round(t/TICK))
		if idx<n:
			x[idx]=1. if not half_time or i%2==0 else .08
		t+=60./bpm;i+=1
	return x


class TestPeriodicityHypotheses(unittest.TestCase):
	def test_silence_never_returns_fake_bpm(self):
		for x in (np.zeros(1700),np.ones(1700)*.2):
			with self.subTest(x=x[0]):
				r=periodicity_evidence(x)
				self.assertEqual(r['status'],'INSUFFICIENT_RHYTHM')
				self.assertIsNone(r['preferredQuarterTick'])
				self.assertIsNone(phase_lag_crosscheck(x,x)['bestLagTicks'])

	def test_steady_synthetic_pulse_lag_and_interpolation(self):
		x=synth_onsets(160.)
		r=periodicity_evidence(x)
		self.assertEqual(r['status'],'CANDIDATES_UNVERIFIED')
		self.assertAlmostEqual(r['quarterAlternatives'][0]['candidateBpm'],160,delta=3)
		self.assertIn('interpolatedLagTicks',r['quarterAlternatives'][0])
		self.assertTrue(r['candidateOnly'])

	def test_tempo_sensitivity_to_different_constant_fixture(self):
		for bpm in (154,160,166):
			with self.subTest(bpm=bpm):
				r=periodicity_evidence(synth_onsets(float(bpm)))
				self.assertAlmostEqual(r['quarterAlternatives'][0]['candidateBpm'],bpm,delta=3.5)

	def test_half_time_accent_is_not_musical_80bpm_proof(self):
		r=periodicity_evidence(synth_onsets(160,half_time=True))
		self.assertTrue(r['candidateOnly'])
		self.assertTrue(any(k['hypothesis']=='half_time' for k in r['octaveFamily']))
		self.assertGreater(r['quarterAlternatives'][0]['candidateBpm'],140)

	def test_lag_can_identify_shift_without_assigning_beat_one(self):
		bass=synth_onsets(160,offset=.15)
		drums=synth_onsets(160,offset=.18)
		r=phase_lag_crosscheck(drums,bass,window_seconds=.1)
		self.assertAlmostEqual(r['bestLagSeconds'],.03,delta=.015)
		self.assertFalse(r['lagIsBeatOneEvidence'])

	def test_two_streams_half_pulse_displaced_report_both_phases(self):
		p=list(range(15,1500,38))
		b=[x+19 for x in p]
		r=beat_path_agreement(p,b,period_seconds=38*TICK)
		self.assertLess(r['alignments'][0]['within40msFraction'],.2)
		self.assertGreater(max(a['within40msFraction'] for a in r['alignments']),.95)
		self.assertTrue(r['bestShiftIsNotActualBeatOne'])

	def test_invalid_inputs_fail_explicitly(self):
		for values in (np.array([]),np.array([-1.,0.]),np.array([float('nan'),.5])):
			with self.subTest(values=str(values)):
				with self.assertRaises(ValueError):periodicity_evidence(values)
		with self.assertRaises(ValueError):phase_lag_crosscheck(np.ones(10),np.ones(11))
		with self.assertRaises(ValueError):beat_path_agreement([], [12,25])

	def test_known_linear_tempo_change_in_rolling_windows(self):
		x=np.zeros(round(30/TICK))
		t=.17
		while t<29.75:
			x[round(t/TICK)]=1.
			t+=60/(154+14*t/30)
		early=periodicity_evidence(x[:round(15/TICK)])
		late=periodicity_evidence(x[round(15/TICK):])
		self.assertGreater(late['quarterAlternatives'][0]['candidateBpm'],
			early['quarterAlternatives'][0]['candidateBpm']+3)

	def test_source_report_provenance_and_no_production_downbeats(self):
		p=Path(__file__).resolve().parents[2]/'docs/music-review/one-more-run-rhythm-periodicity-crosscheck-UNVERIFIED-20261121.json'
		data=json.loads(p.read_text())
		self.assertEqual(data['format'],FORMAT)
		self.assertEqual(data['status'],STATUS)
		self.assertEqual(data['sourceFrameCount'],8380800)
		self.assertEqual(data['sourceManifestSha256'],
			'e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a')
		self.assertEqual(len(data['regions']),28)
		self.assertEqual(len(data['originalDrumBassStemSha256']),15)
		self.assertTrue(all(set(v)=={'drums','bass'} for v in data['originalDrumBassStemSha256'].values()))
		self.assertTrue(all(r['candidateOnly'] for r in data['regions']))
		self.assertTrue(all(r['crossStemOnsetLag']['lagIsBeatOneEvidence'] is False for r in data['regions']))
		self.assertNotIn('approvedDownbeats',data)
		self.assertNotIn('sourceTempoMapVerified',data)

	def test_no_real_source_meter_approved(self):
		self.assertIn('UNVERIFIED',FORMAT)
		self.assertIn('NO_VERIFIED',STATUS)


if __name__=='__main__': unittest.main()
