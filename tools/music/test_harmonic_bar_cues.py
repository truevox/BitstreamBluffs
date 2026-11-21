#!/usr/bin/env python3
"""Hermetic fixture checks, not proof of musical downbeat correctness."""
import importlib.util
import unittest
from pathlib import Path
import numpy as np

spec=importlib.util.spec_from_file_location('cues',Path(__file__).with_name('research_harmonic_bar_cues.py'))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class TestHarmonicEvidence(unittest.TestCase):
	def test_silence_does_not_create_fake_harmonic_change(self):
		self.assertTrue(np.array_equal(m.harmonic_novelty(np.zeros(m.RATE*3)),
			np.zeros(len(m.harmonic_novelty(np.zeros(m.RATE*3))))))

	def test_known_synthesized_chord_change_creates_novelty_near_boundary(self):
		t=np.arange(4*m.RATE)/m.RATE
		first=sum(np.sin(2*np.pi*p*t) for p in (261.63, 329.63, 392.0))
		second=sum(np.sin(2*np.pi*p*t) for p in (349.23, 440.0, 523.25))
		wave=np.where(t<2,first,second)*.12
		n=m.harmonic_novelty(wave)
		self.assertGreater(n[int(1.9/m.STEP):int(2.1/m.STEP)].max(),
			n[int(.7/m.STEP):int(1.3/m.STEP)].mean()+.25)

	def test_four_way_hypotheses_retained_for_harmonic_markers(self):
		length=int(12/m.STEP)
		t=np.zeros(length)
		for i,sec in enumerate(np.arange(.1,11.7,.375)):
			if i%4==2:t[int(sec/m.STEP)]=1
		result=m.offset_comparisons({role:t for role in m.ROLES},160,.1,11.7)
		self.assertEqual(len(result),4)
		self.assertEqual(result[0]['beatOneOffset'],2)
		self.assertEqual(result[0]['stemsSupportingThisOffset'],3)
		self.assertTrue(all(r['candidateOnly'] for r in result))

	def test_invalid_short_window_returns_no_phase_options(self):
		flat=np.zeros(120)
		self.assertEqual(m.offset_comparisons({role:flat for role in m.ROLES},160,.1,.5),[])

if __name__ == '__main__': unittest.main()
