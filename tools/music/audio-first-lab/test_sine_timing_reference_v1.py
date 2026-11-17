#!/usr/bin/env python3
"""Private-only timing reference: numerical hard-gate/onset integrity tests."""
import unittest

import numpy as np

import render_sine_timing_reference_v1 as sine

class SineTimingTests(unittest.TestCase):
	def test_flat_note_has_no_pre_onset_or_acoustic_tail(self):
		b=np.zeros((sine.FRAMES,2),dtype=np.float32)
		e=[{'midi':69,'start':.125,'end':.325}]
		r=sine.flat_sine(b,e,.2,.5)
		i0=round(.125*sine.RATE)
		i1=round(.325*sine.RATE)
		self.assertEqual(r['count'],1)
		self.assertTrue(np.all(b[:i0]==0))
		self.assertTrue(np.all(b[i1:]==0))
		self.assertGreater(float(np.max(np.abs(b[i0+48:i0+300]))),.1)
		self.assertEqual(float(b[i0,0]),0.0)
		self.assertEqual(float(b[i1-1,0]),0.0)

	def test_recovered_same_pitch_strike_is_two_distinct_hard_gates(self):
		b=np.zeros((sine.FRAMES,2),dtype=np.float32)
		events=[{'midi':56,'start':.125,'end':.25},
			{'midi':56,'start':.275,'end':.4}]
		sine.flat_sine(b,events,.14,.5,mark_onsets=True)
		self.assertTrue(np.all(b[round(.251*sine.RATE):round(.273*sine.RATE)]==0))
		self.assertGreater(float(np.max(abs(b[round(.126*sine.RATE):round(.245*sine.RATE)]))),.05)
		self.assertGreater(float(np.max(abs(b[round(.276*sine.RATE):round(.395*sine.RATE)]))),.05)

	def test_trim_long_melody_to_absolute_excerpt(self):
		b=np.zeros((sine.FRAMES,2),dtype=np.float32)
		notes=[{'midi':65,'start':149.3,'end':150.10},
			{'midi':70,'start':150.4,'end':150.70},
			{'midi':70,'start':182.5,'end':182.6}]
		info=sine.flat_sine(b,notes,.16,.2,offset=150)
		self.assertEqual(info['count'],2)
		self.assertEqual(info['first'],[0,0.4])
		self.assertGreater(float(np.max(abs(b[1:round(.095*sine.RATE)]))),.01)
		self.assertTrue(np.all(b[round(.101*sine.RATE):round(.399*sine.RATE)]==0))

	def test_bass_octave_changes_pitch_but_not_start(self):
		b=np.zeros((sine.FRAMES,2),dtype=np.float32)
		n=[{'midi':28,'start':.5,'end':.8}]
		info=sine.flat_sine(b,n,.1,.5,bass_octave=True)
		self.assertEqual(info['first'],[.5])
		self.assertTrue(np.all(b[:round(.5*sine.RATE)]==0))

	def test_drum_timestamps_include_25ms_spacing(self):
		b=np.zeros((sine.FRAMES,2),dtype=np.float32)
		events=[{'t':.1,'type':'hat'},
			{'t':.125,'type':'snare'},
			{'t':.15,'type':'kick'}]
		info=sine.drum_clicks(b,events)
		self.assertEqual(info['count'],3)
		self.assertAlmostEqual(info['minInterhitMs'],25,places=2)
		self.assertTrue(np.all(b[:round(.1*sine.RATE)]==0))
		self.assertTrue(np.all(b[round(.161*sine.RATE):round(.18*sine.RATE)]==0))
		self.assertGreater(float(np.max(abs(b[round(.15*sine.RATE):round(.158*sine.RATE)]))),.05)

if __name__=='__main__':
	unittest.main()
