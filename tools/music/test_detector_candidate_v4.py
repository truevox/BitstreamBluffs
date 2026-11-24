#!/usr/bin/env python3
"""Research-only V4 detector safety/regression probes (synthetic, NOT gold)."""
import unittest
import numpy as np

from benchmark_drums_v4 import fixtures, drum_fixture
from detector_candidate_v2 import drum_simultaneous
from detector_candidate_v4 import (drum_echo_similarity_probe,
	aligned_attack_similarity)


class DrumV4ResearchTests(unittest.TestCase):
	def test_silence_and_too_short_do_not_raise(self):
		for length in (0,10,800,8000,16000):
			with self.subTest(length=length):
				out,diagnostics=drum_echo_similarity_probe(
					np.zeros(length,dtype='float32'))
				self.assertEqual(out,[])
				self.assertFalse(diagnostics['confidenceCalibrated'])
				self.assertEqual(diagnostics['status'],
						'synthetic-research-only-not-calibrated')

	def test_attack_similarity_only_reads_band(self):
		wave=np.zeros(15000,dtype='float32')
		wave[1600:1808]=np.sin(np.arange(208))
		wave[3200:3408]=wave[1600:1808]*.4
		before=wave.copy()
		similarity,ratio=aligned_attack_similarity(wave,.097,.197)
		self.assertGreater(similarity,.8)
		self.assertGreater(ratio,0)
		np.testing.assert_array_equal(wave,before)
	def test_preserves_true_ghost_strikes_but_not_declared_gold(self):
		fixtures.SEED=559103
		gold,_=drum_fixture('quiet-ghost-snare-120ms')
		gold.sort(key=lambda x:x['t'])
		wave=fixtures.synth(gold,echo=False)
		baseline=drum_simultaneous(wave,echo_guard='ratio-only')[0]
		candidate,meta=drum_echo_similarity_probe(wave)
		base_score=fixtures.compare(baseline,gold,20)
		probe_score=fixtures.compare(candidate,gold,20)
		self.assertGreater(probe_score['recall'],base_score['recall'])
		self.assertGreater(probe_score['falsePositive'],0)
		self.assertFalse(meta['confidenceCalibrated'])

	def test_deterministic_and_preserves_source(self):
		fixtures.SEED=559103
		gold=fixtures.hits('cohits')
		wave=fixtures.synth(gold,echo=True)
		before=wave.copy()
		first,diag=drum_echo_similarity_probe(wave)
		second,diag2=drum_echo_similarity_probe(wave)
		self.assertEqual(first,second)
		self.assertEqual(diag,diag2)
		np.testing.assert_array_equal(wave,before)
		self.assertGreater(len(first),0)
		self.assertLess(len(first),diag['proposals'])


if __name__=='__main__':
	unittest.main()
