#!/usr/bin/env python3
"""Hermetic synthetic-fixture tests for unverified 4-way meter ranking."""
import importlib.util
import unittest
from pathlib import Path
import numpy as np

p=Path(__file__).with_name('research_original_downbeat_candidates.py')
spec=importlib.util.spec_from_file_location('downbeat_research',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class TestDownbeatResearch(unittest.TestCase):
	def test_flat_pulse_is_ambiguous_not_trusted(self):
		length=int(13/m.TICK)
		d=np.zeros(length);b=np.zeros(length)
		for at in np.arange(.15,12,.5):
			j=int(round(at/m.TICK));d[j]=1;b[j]=.5
		c=m.phase_candidates(d,b,120.,sourceStartSeconds=42.,topN=2)
		self.assertEqual(len(c),8)
		self.assertEqual({r['meterOffsetRankWithinPhase'] for r in c[:4]},{1,2,3,4})
		self.assertEqual({r['barOffsetBeats'] for r in c[:4]},{0,1,2,3})
		self.assertTrue(c[0]['meterOffsetAmbiguous'])
		self.assertTrue(all(r['candidateOnly'] for r in c))
		self.assertTrue(all(r['localBarStartSourceSeconds'][0]>=42 for r in c))

	def test_explicit_kick_and_bass_change_favor_a_offset_without_proof(self):
		length=int(13/m.TICK)
		d=np.zeros(length);b=np.zeros(length)
		for beat,at in enumerate(np.arange(.15,12,.5)):
			j=int(round(at/m.TICK))
			d[j]=1 if beat%4==0 else .2
			b[j]=1 if beat%4==0 else .05
		c=m.phase_candidates(d,b,120.,sourceStartSeconds=0.,topN=1)
		self.assertEqual(len(c),4)
		self.assertEqual(c[0]['barOffsetBeats'],0)
		self.assertEqual(set(x['barOffsetBeats'] for x in c),set(range(4)))
		self.assertNotIn('trusted',c[0])

	def test_source_offset_remains_absolute(self):
		n=1300;d=np.zeros(n);b=np.zeros(n)
		for t in np.arange(.12,12,.5):
			j=int(round(t/m.TICK));d[j]=1;b[j]=.4
		r=m.phase_candidates(d,b,120.,sourceStartSeconds=144.,topN=1)
		self.assertTrue(all(x['localBarStartSourceSeconds'][0]>=144 for x in r))

	def test_insufficient_measure_length_rejected(self):
		with self.assertRaises(ValueError):m.phase_candidates(np.ones(150),np.ones(150),160.)

	def test_tempo_stays_hypothesis_and_no_release_status(self):
		self.assertIn('UNVERIFIED',m.STATUS)
		self.assertIn('research',m.FORMAT)
		self.assertEqual(m.DEFAULT_BPM_HYPOTHESES,(160.,161.5,163.84))
		self.assertEqual(m.RATE,11025)

if __name__=='__main__':unittest.main()
