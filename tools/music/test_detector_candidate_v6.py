#!/usr/bin/env python3
"""Synthetic-only V6 cross-band veto invariants, no music-release claims."""
import unittest
import numpy as np
from benchmark_drums_v4 import fixtures
from audit_cross_band_v6 import attack_features, classify_predictions
from detector_candidate_v6 import cross_band_veto,MIN_FAMILY_SHARE


class CrossBandV6Tests(unittest.TestCase):
	def test_silence_short_and_invalid_thresholds(self):
		for count in (0,32,800,4096):
			with self.subTest(count=count):
				out,detail=cross_band_veto(np.zeros(count,dtype='float32'))
				self.assertEqual(out,[])
				self.assertEqual(detail['status'],'synthetic-only')
		for thresholds in ({'hat':.1},
			{'kick':.1,'snare':.1,'hat':-1},
			{'kick':.1,'snare':.1,'hat':float('nan')}):
			with self.assertRaises(ValueError):
				cross_band_veto(np.zeros(800,dtype='float32'),thresholds=thresholds)

	def test_attack_without_future_samples_is_finite(self):
		bands={name:np.zeros(1024,dtype='float32') for name in MIN_FAMILY_SHARE}
		for instant in (0.,.005,.063,.1):
			result=attack_features(bands,instant)
			self.assertTrue(all(value>=0 and np.isfinite(value) for value in result.values()))

	def test_cohits_retain_same_time_distinct_classes(self):
		fixtures.SEED=559103
		gold=fixtures.hits('cohits')
		wave=fixtures.synth(gold,echo=False)
		before=wave.copy()
		out,meta=cross_band_veto(wave)
		matched=classify_predictions(out,gold)
		self.assertGreater(len(matched),75)
		self.assertFalse(meta['confidenceCalibrated'])
		self.assertEqual(meta['input']-meta['retained'],sum(meta['removed'].values()))
		np.testing.assert_array_equal(wave,before)

	def test_echo_ghost_tradeoff_is_not_automatically_promoted(self):
		fixtures.SEED=559103
		gold=fixtures.hits('echoed-cohits')
		wave=fixtures.synth(gold,echo=True)
		pred,meta=cross_band_veto(wave)
		self.assertEqual(meta['status'],'synthetic-only')
		self.assertGreater(len(pred),0)
		self.assertLess(len(pred),meta['input'])
		self.assertEqual(meta['thresholds'],MIN_FAMILY_SHARE)


if __name__=='__main__':
	unittest.main()
