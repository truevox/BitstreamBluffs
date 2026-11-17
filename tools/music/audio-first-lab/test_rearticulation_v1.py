#!/usr/bin/env python3
"""Regression checks: source-supported reattacks, no invented pitches,
preserved unrelated octave notes, and no speculative split without evidence."""
import unittest

import numpy as np

import rearticulate_featured_v1 as reperform

class ReattackAuditTest(unittest.TestCase):
	def event(self,midi,start,end,confidence=.60):
		return {'midi':midi,'start':start,'end':end,'confidence':confidence,
			'expression':{'estimatedVelocity':85}}

	def cqt(self,active=True):
		data=np.ones((84,300),dtype='float32')*.001
		if active:
			tone=56-24
			data[tone,52:90]=15.
		return data

	def test_source_retrigger_splits_original_same_pitch_no_octave_deletion(self):
		original={'events':[
			self.event(56,.40,1.10,.70),
			self.event(68,.40,1.10,.38),
		]}
		sensitive={'events':[self.event(56,.75,.97,.78)]}
		revised,per_note,splits,rejected=reperform.retriggers(
			original,sensitive,self.cqt(),np.array([.749]),
			np.array([3.]),np.array([0]))
		self.assertEqual(len(splits),1)
		self.assertEqual(len(revised),3)
		self.assertEqual([e['midi'] for e in revised].count(56),2)
		self.assertEqual([e['midi'] for e in revised].count(68),1)
		parts=sorted((e for e in revised if e['midi']==56),key=lambda e:e['start'])
		self.assertAlmostEqual(parts[0]['start'],.4)
		self.assertAlmostEqual(parts[0]['end'],.738,places=3)
		self.assertAlmostEqual(parts[1]['start'],.75)
		self.assertAlmostEqual(parts[1]['end'],1.1)
		self.assertEqual(len(per_note),2)
		self.assertFalse(rejected)

	def test_does_not_fabricate_retrigger_without_source_attack(self):
		original={'events':[self.event(56,.40,1.10,.70)]}
		sensitive={'events':[self.event(56,.75,.97,.78)]}
		revised,notes,splits,_=reperform.retriggers(
			original,sensitive,self.cqt(),np.array([.98]),
			np.array([3.]),np.array([0]))
		self.assertEqual(len(splits),0)
		self.assertEqual(revised,original['events'])

	def test_does_not_fabricate_retrigger_without_pitch_evidence(self):
		original={'events':[self.event(56,.40,1.10,.70)]}
		sensitive={'events':[self.event(56,.75,.97,.78)]}
		revised,notes,splits,_=reperform.retriggers(
			original,sensitive,self.cqt(False),np.array([.75]),
			np.array([3.]),np.array([0]))
		self.assertEqual(len(splits),0)
		self.assertEqual(revised,original['events'])

if __name__=='__main__':
	unittest.main()
