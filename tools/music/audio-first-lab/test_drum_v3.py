#!/usr/bin/env python3
"""Independent regression gates for faster sampled music percussion.
Uses synthetic drum rolls and a fake Synth to assert that the scheduler
does not introduce a hidden 10ms snapping grid.
"""
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import numpy as np

import transcribe_drums_v3 as detect
import render_sampled_air_drums_v3 as sampled
import render_biome_orchestras_v3 as mixed

class DrumV3Regression(unittest.TestCase):
	def test_fast_rolls_not_suppressed_by_40_or_65_ms_global_gate(self):
		# Source-backed synthesis test: a crisp .027 sec / 37 Hz roll
		# that V1 (65ms) and V2 (40ms) cannot resolve fully.
		times=[.50+.027*i for i in range(9)]
		n=round(2*detect.RATE)
		audio=np.zeros(n,dtype='float32')
		rng=np.random.default_rng(20)
		for t in times:
			pos=round(t*detect.RATE)
			size=round(.009*detect.RATE)
			tt=np.arange(size,dtype='float32')/detect.RATE
			audio[pos:pos+size]+=.72*np.exp(-tt/.002)*rng.standard_normal(size)
		events,qa=detect.analyze(audio,2)
		attacks=sorted(set(e['t'] for e in events))
		for t in times:
			self.assertTrue(any(abs(a-t)<.017 for a in attacks),
				f'Short roll hit at {t:.3f}s was discarded')
		self.assertLess(qa['analysisHopMs'],6)
		self.assertLess(qa['globalMinPeakSeparationMs'],20)

	def test_scheduler_uses_exact_48k_sample_not_ten_ms_block(self):
		class ProgramSelect:
			def __call__(self,*_):
				return 0
		class MockSynth:
			def __init__(self,_):
				self.ptr=None
				self.lib=SimpleNamespace(fluid_synth_program_select=ProgramSelect())
				self.active=0
			def note_on(self,*_):
				self.active+=1
			def note_off(self,*_):
				self.active=max(0,self.active-1)
			def render(self,count):
				return np.full(count,float(self.active),dtype='float32')
			def close(self):
				pass
		events=[
			{'t':.0227,'type':'hat','velocity':80},
			{'t':.0227,'type':'kick','velocity':90},  # Co-hit preserved
			{'t':.0491,'type':'snare','velocity':100},
		]
		with patch.object(sampled,'Synth',MockSynth):
			result,changes=sampled.render_percussion_precise(
				events,0,{'kick':36,'snare':38,'hat':42})
		earliest=np.flatnonzero(result[:,0])[0]
		self.assertEqual(earliest,round(.0227*sampled.RATE))
		self.assertEqual(changes,6)
		self.assertEqual(float(result[earliest,0]),2.)
		self.assertEqual(float(result[round(.0491*sampled.RATE),0]),3.)
		self.assertNotEqual(earliest%480,0)
		self.assertEqual(result.shape,(sampled.FRAMES,2))

	def test_source_onset_foley_has_no_160ms_suppression(self):
		events=[
			{'t':.50,'type':'hat','velocity':85},
			{'t':.50,'type':'snare','velocity':95},  # one physical onset
			{'t':.53,'type':'hat','velocity':85}, # fast repeat
			{'t':.57,'type':'hat','velocity':90},
		]
		signal,count=mixed.render_foley(
			np.zeros((mixed.FRAMES,2),dtype='float32'),
			'garbage-dump-glacier',events)
		self.assertEqual(count,3)
		self.assertEqual(signal.shape,(mixed.FRAMES,2))
		self.assertTrue(np.all(np.isfinite(signal)))

if __name__=='__main__':
	unittest.main()
