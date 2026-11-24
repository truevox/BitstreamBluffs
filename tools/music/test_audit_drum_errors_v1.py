#!/usr/bin/env python3
"""Unit probes for V4 synthetic error attribution; never human gold."""
import unittest
import numpy as np
from audit_drum_errors_v1 import (aligned_error_details,
	categorize_suppression,audit_case,summarize)
from benchmark_drums_v4 import fixtures


class DrumErrorAuditTests(unittest.TestCase):
	def test_one_to_one_duplicate_predictions(self):
		pred=[{'t':.4,'type':'kick'},{'t':.4,'type':'kick'}]
		gold=[{'t':.4,'type':'kick'}]
		result=aligned_error_details(pred,gold,'kick',20)
		self.assertEqual(result['metrics']['truePositive'],1)
		self.assertEqual(result['metrics']['falsePositive'],1)
		self.assertEqual(result['metrics']['falseNegative'],0)
		self.assertEqual(len(result['falsePositiveFrames']),1)

	def test_exact_class_and_20ms_boundary(self):
		pred=[{'t':.420,'type':'snare'},{'t':.432,'type':'hat'}]
		gold=[{'t':.400,'type':'snare'},{'t':.400,'type':'hat'}]
		self.assertEqual(aligned_error_details(pred,gold,'snare',20)
			['metrics']['truePositive'],1)
		self.assertEqual(aligned_error_details(pred,gold,'hat',20)
			['metrics']['falseNegative'],1)
		self.assertEqual(aligned_error_details(pred,gold,'hat',50)
			['metrics']['truePositive'],1)
	def test_rejected_proposal_proximity_not_claimed_as_gold(self):
		gold=[{'t':.500,'type':'snare'}]
		proposals=[{'t':.512,'type':'snare','rejected':True},
			{'t':.515,'type':'kick','rejected':True},
			{'t':.800,'type':'hat','rejected':True},
			{'t':.500,'type':'snare','rejected':False}]
		value=categorize_suppression(proposals,gold)
		self.assertEqual(value['nearKnownSyntheticHit'],1)
		self.assertEqual(value['awayFromKnownSyntheticHits'],2)
		self.assertIn('not a verified causal',value['interpretation'])

	def test_score_uses_unmatched_events_and_no_mutation(self):
		fixtures.SEED=559103
		gold=fixtures.hits('cohits')
		wave=fixtures.synth(gold,echo=True)
		copy=wave.copy()
		result=audit_case('cohits',gold,wave,559103,'test')
		notes=result['methods']['v4Texture']['20ms']
		self.assertIn('snare',notes)
		self.assertGreaterEqual(notes['snare']['metrics']['falsePositive'],0)
		self.assertIn('v4Suppression',result)
		np.testing.assert_array_equal(wave,copy)
		summary=summarize([result])
		self.assertIn('20ms',summary['test'])
		self.assertIn('50ms',summary['test'])


if __name__=='__main__':
	unittest.main()
