#!/usr/bin/env python3
"""Controlled algorithm fixtures; these are NOT labels for Suno/Kie recordings."""
import unittest
import tempfile
import json
from pathlib import Path
import numpy as np
from research_variable_tempo import (
	TICK,observation,track_beats,fixed_tempo_candidate,period_summary,evaluate,
	FORMAT,STATUS,validate_source_manifest)


def synth_fixture(bpm_at,seconds=24.,offset=.15,half_time_accents=False):
	n=int(seconds/TICK);drums=np.zeros(n);bass=np.zeros(n)
	t=offset;true=[];i=0
	while t<seconds-.25:
		j=int(round(t/TICK))
		if j<n:
			true.append(t)
			# Suppress alternating accents in one stem to mimic half-time feel,
			# but retain quarter-note musical pulse (the ground-truth fixture).
			drums[j]=1. if not half_time_accents or i%2==0 else .24
			bass[j]=.75 if i%2==0 else .45
		i+=1
		t+=60./bpm_at(t)
	return observation(drums),observation(bass),np.array(true)


def match_fraction(result, truth,within=.031):
	beats=np.asarray(result['ticks'])*TICK
	return float(np.mean(np.min(abs(beats[:,None]-truth[None,:]),axis=0)<within))


class TestSourceTimeTracker(unittest.TestCase):
	def test_steady_pulse_has_no_strange_phase_jumps(self):
		d,b,truth=synth_fixture(lambda _:160.)
		candidate=track_beats(d)
		self.assertGreater(match_fraction(candidate,truth),.96)
		self.assertLess(abs(period_summary(candidate,2,22)['meanCandidateBpm']-160),2)
		self.assertGreater(evaluate(b,candidate['ticks']),.25)
		self.assertTrue(candidate['candidateOnly'])

	def test_known_ramp_tracks_tempo_without_restarting_source_time(self):
		d,b,truth=synth_fixture(lambda t:156+12*t/24.)
		candidate=track_beats(d)
		self.assertGreater(match_fraction(candidate,truth),.95)
		self.assertGreater(period_summary(candidate,16,23)['meanCandidateBpm'],
			period_summary(candidate,1,8)['meanCandidateBpm']+4)
		self.assertTrue(all(p>0 for p in candidate['interBeatTicks']))

	def test_half_time_accent_does_not_force_80_bpm_answer(self):
		d,b,truth=synth_fixture(lambda _:160.,half_time_accents=True)
		candidate=track_beats(d)
		self.assertGreater(match_fraction(candidate,truth),.95)
		self.assertGreater(period_summary(candidate,2,22)['meanCandidateBpm'],150)

	def test_source_grid_retains_rival_constant_tempo_control(self):
		d,_,_=synth_fixture(lambda _:160.)
		constant=fixed_tempo_candidate(d)
		self.assertAlmostEqual(constant['bpm'],160,delta=.6)
		self.assertTrue(constant['candidateOnly'])

	def test_no_rhythm_must_not_publish_synthetic_beat_map(self):
		for signal in (np.zeros(1800),np.ones(1800)*.2):
			with self.subTest(kind=signal[0]):
				with self.assertRaisesRegex(ValueError,'Insufficient distinct'):
					track_beats(signal)

	def test_invalid_source_rhythm_rejected(self):
		for signal in (np.array([]),np.array([float('nan'),0]),np.array([-1.,0.])):
			with self.assertRaises(ValueError):track_beats(signal)

	def test_invalid_tempo_states_rejected(self):
		d,_,_=synth_fixture(lambda _:160.)
		for periods in ([0,1],[37,37],[39,37],[]):
			with self.subTest(periods=periods):
				with self.assertRaises(ValueError):track_beats(d,periods=periods)

	def test_prior_source_hash_mismatch_fails_closed(self):
		with tempfile.TemporaryDirectory() as d:
			p=Path(d)
			(p/'pack.json').write_text('{"id":"fake"}')
			(p/'prior.json').write_text(json.dumps({"manifestSha256":"not-a-real-hash"}))
			with self.assertRaisesRegex(ValueError,'manifest does not match'):
				validate_source_manifest(p,p/'prior.json')

	def test_source_report_preserves_unverified_status(self):
		data=json.loads((Path(__file__).resolve().parents[2]/'docs/music-review/one-more-run-variable-tempo-first-pass-UNVERIFIED-20261121.json').read_text())
		self.assertEqual(data['format'],FORMAT)
		self.assertEqual(data['status'],STATUS)
		self.assertEqual(data['sourceFrameCount'],8380800)
		self.assertEqual(len(data['originalStemSha256']),15)
		self.assertEqual(len(data['regions']),15)
		self.assertEqual(len(data['modelSensitivity']),6)
		self.assertEqual(data['candidateGrid']['actualMeter'],'UNKNOWN_NOT_APPROVED')
		self.assertEqual(data['candidateGrid']['beatOneOffsets'],'UNKNOWN_NOT_APPROVED')
		self.assertTrue(data['candidateGrid']['candidateOnly'])
		self.assertTrue(data['crossSourceBeatAgreement']['noAssumedPhaseOrMeterTruth'])

	def test_output_stores_no_approved_real_bar_one_or_meter(self):
		self.assertIn('UNVERIFIED', STATUS)
		self.assertIn('variable-tempo',FORMAT)

if __name__=='__main__':unittest.main()
