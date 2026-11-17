#!/usr/bin/env python3
"""Regression tests for safe stock/new/source-aligned guitar/piano/other A/B."""
import unittest
import numpy as np
import align_featured_source_onsets_v1 as align

class SourceNoteTimingTests(unittest.TestCase):
	def test_same_pitch_duration_and_chord_time(self):
		events=[
			{'start':.500,'end':.720,'midi':60,'confidence':.9},
			{'start':.504,'end':.710,'midi':64,'confidence':.8},
			{'start':.850,'end':1.00,'midi':67,'confidence':.7},
		]
		times=np.array([.472,.825],dtype='float64')
		powers=np.array([1.,.85],dtype='float64')
		out,changes,groups=align.align_events(events,times,powers,np.array([0,1]),times)
		self.assertEqual(len(groups),2)
		self.assertEqual(len(changes),2)
		self.assertEqual([n['midi'] for n in events],[n['midi'] for n in out])
		for old,new in zip(events,out):
			self.assertAlmostEqual(new['end']-new['start'],old['end']-old['start'],places=3)
			self.assertLessEqual(abs(new['start']-old['start']),.047)
		self.assertAlmostEqual(out[0]['start']-events[0]['start'],
			out[1]['start']-events[1]['start'],places=4)

	def test_cannot_merge_two_distinct_onsets_to_one_transient(self):
		events=[
			{'start':.510,'end':.62,'midi':65},
			{'start':.585,'end':.70,'midi':68},
		]
		attacks=np.array([.548],dtype='float64')
		out,changes,groups=align.align_events(events,attacks,np.array([1.]),
			np.array([0]),attacks)
		self.assertLessEqual(len(changes),1)
		self.assertGreater(out[1]['start']-out[0]['start'],.012)

	def test_no_source_attack_keeps_event_unchanged(self):
		events=[{'start':2.11,'end':2.28,'midi':65}]
		out,corrections,_=align.align_events(events,np.array([5.]),
			np.array([1.]),np.array([0]),np.array([5.]))
		self.assertEqual(out,events)
		self.assertEqual(corrections,[])

if __name__=='__main__':
	unittest.main()
