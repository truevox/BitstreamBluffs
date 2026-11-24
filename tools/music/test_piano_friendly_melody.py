#!/usr/bin/env python3
"""Offline, no-OGG hermetic tests for optional melody reinterpretation."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
import numpy as np

module_path=Path(__file__).with_name('render_piano_friendly_melody.py')
spec=importlib.util.spec_from_file_location('piano_friendly',module_path)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class TestMelodySpec(unittest.TestCase):
	def test_steady_note_holds_exact_pitch(self):
		t=np.arange(60)*.01
		f0=64+.1*np.sin(2*np.pi*6*t)
		c=m.classify_contour(f0,t)
		self.assertEqual(c['stable'],64)
		self.assertFalse(c['transitions'])

	def test_meaningful_scream_glide_kept(self):
		t=np.arange(56)*.01
		f0=np.r_[np.linspace(60,67,16),np.full(40,67.)]
		c=m.classify_contour(f0,t)
		self.assertEqual(c['kind'],'structural-onset-glide')
		self.assertEqual(c['transitions'][0]['fromPitch'],60)
		self.assertEqual(c['transitions'][0]['toPitch'],67)
		notes=[{'start':0,'end':.56,'pitch':67,'kind':c['kind'],'transitions':c['transitions']}]
		flat=m.performance_events(notes,'piano')
		exp=m.performance_events(notes,'expressive')
		self.assertEqual(len(flat),1)
		self.assertGreater(len(exp),len(flat))
		self.assertEqual(exp[-1][2],67)

	def test_tail_scoop_removed(self):
		t=np.arange(65)*.01
		f0=np.r_[np.full(55,69.),np.linspace(69,70.6,10)]
		c=m.classify_contour(f0,t)
		self.assertEqual(c['stable'],69)
		self.assertEqual(c['kind'],'terminal-ornament-removed')
		self.assertFalse(c['transitions'])

	def test_vibrato_does_not_generate_extra_notes(self):
		t=np.arange(70)*.01
		f0=72+.32*np.sin(2*np.pi*6*t)
		c=m.classify_contour(f0,t)
		self.assertEqual(c['stable'],72)
		self.assertEqual(len(c['transitions']),0)

	def test_repeated_same_pitch_rearticulation_preserved(self):
		p=np.r_[np.full(38,60.),np.full(12,np.nan),np.full(34,60.)]
		mask=np.isfinite(p)
		notes=m.segment_notes(p,mask)
		self.assertEqual(len(notes),2)
		self.assertEqual([n['pitch'] for n in notes],[60,60])

	def test_unvoiced_is_not_invented(self):
		p=np.full(80,np.nan)
		notes=m.segment_notes(p,np.zeros(80,dtype=bool))
		self.assertEqual(notes,[])
		c=m.classify_contour(p,np.arange(len(p))*.01)
		self.assertIsNone(c['stable'])

	def test_octave_flip_short_detector_error_is_smoothed(self):
		p=np.full(100,65.)
		p[32:34]=77.
		notes=m.segment_notes(p,np.ones(100,dtype=bool))
		self.assertTrue(notes)
		self.assertTrue(all(n['pitch']==65 for n in notes))

	def test_microtiming_keeps_source_timestamps_without_verified_grid(self):
		notes=[{'start':1.027,'end':1.319,'pitch':68,'kind':'steady','transitions':[]}]
		e=m.performance_events(notes,'piano')
		self.assertEqual(e,[(1.027,1.319,68)])

	def test_midi_valid_and_bounded(self):
		with tempfile.TemporaryDirectory() as d:
			path=Path(d)/'performance.mid'
			m.write_midi([(0,.3,60),(.35,.8,65)],path)
			b=path.read_bytes()
			self.assertTrue(b.startswith(b'MThd'))
			self.assertEqual(b[14:18],b'MTrk')
			self.assertEqual(b.count(b'\x90'),2)
			self.assertTrue(b.endswith(b'\x00\xff\x2f\x00'))

	def test_source_variants_do_not_mutate_source_events(self):
		e=[{'start':1.,'end':1.5,'pitch':70,'kind':'structural-onset-glide',
			'transitions':[{'fromPitch':65,'toPitch':70,'slideSeconds':.17}]}]
		original=repr(e)
		_ = m.performance_events(e,'piano')
		_ = m.performance_events(e,'expressive')
		self.assertEqual(repr(e),original)

if __name__=='__main__':unittest.main()
