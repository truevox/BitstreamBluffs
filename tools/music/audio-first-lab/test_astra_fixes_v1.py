#!/usr/bin/env python3
"""Astra remediation regression: overlapping-note retriggers, silent source,
stable source-identity synth/pan and common-gain true additive A/B.
"""
import unittest

import numpy as np

import rearticulate_featured_v2 as retrigger
import render_controlled_accompaniment_v1 as controlled

class ControlledReperformTests(unittest.TestCase):
	def note(self,midi,start,end,idx,confidence=.71):
		return {'midi':midi,'start':start,'end':end,'sourceIndex':idx,
			'confidence':confidence,'expression':{'estimatedVelocity':86}}

	def test_same_note_identical_rng_and_pan_when_unrelated_note_inserted(self):
		a=self.note(56,.5,.85,8)
		b=self.note(63,1.5,1.91,15)
		extra=self.note(68,.9,1.24,100)
		tone_a,_=controlled.stable_render_featured([a,b],'debumont')
		tone_b,_=controlled.stable_render_featured([a,extra,b],'debumont')
		tone_extra,_=controlled.stable_render_featured([extra],'debumont')
		self.assertLess(float(np.max(np.abs((tone_b-tone_a)-tone_extra))),2e-5)
		# Reordered events do not alter any waveform characteristic.
		tone_reordered,_=controlled.stable_render_featured([b,a],'debumont')
		np.testing.assert_array_equal(tone_a,tone_reordered)

	def test_changed_duration_does_not_change_other_note(self):
		unchanged=self.note(54,2.0,2.55,99)
		edited=self.note(65,1.1,1.7,4)
		split=self.note(65,1.1,1.26,4)
		new=self.note(65,1.272,1.7,4)
		new['expression']['recoveredAttackSource']='sensitive_unverified'
		old_mix,_=controlled.stable_render_featured([unchanged,edited],'pyramid-peak')
		new_mix,_=controlled.stable_render_featured([unchanged,split,new],'pyramid-peak')
		unchanged_mix,_=controlled.stable_render_featured([unchanged],'pyramid-peak')
		expected_old,_=controlled.stable_render_featured([edited],'pyramid-peak')
		expected_new,_=controlled.stable_render_featured([split,new],'pyramid-peak')
		self.assertLess(float(np.max(np.abs(
			(old_mix-unchanged_mix)-expected_old))),2e-5)
		self.assertLess(float(np.max(np.abs(
			(new_mix-unchanged_mix)-expected_new))),2e-5)

	def test_same_master_gain_all_versions_and_no_backing_drift(self):
		backing=np.array([[.031,-.073],[-.009,.13],[.05,.062]],dtype='float32')
		features={
			'stock':np.array([[.12,.1],[.01,.01],[.03,-.01]],dtype='float32'),
			'new':np.array([[.11,.15],[.02,.01],[.03,-.01]],dtype='float32'),
			'reattacks':np.array([[.11,.15],[.08,.04],[.03,-.01]],dtype='float32'),
		}
		raw={k:backing+v for k,v in features.items()}
		gain=controlled.master_gain(raw['new'],raw)
		for key,record in raw.items():
			mix=record*gain
			np.testing.assert_allclose(mix-raw['new']*gain,
				(features[key]-features['new'])*gain,atol=2e-8)
			self.assertLessEqual(float(np.max(np.abs(mix))),.74+1e-6)
		self.assertGreater(gain,0)

	def test_overlapping_source_parents_do_not_duplicate_one_added_attack(self):
		def orig(start,end):
			return {'midi':56,'start':start,'end':end,
				'confidence':.70,'expression':{'estimatedVelocity':80}}
		events={'events':[orig(.4,1.1),orig(.5,1.2)]}
		sensitive={'events':[orig(.75,.96)]}
		cqt=np.full((84,400),.001,dtype='float32')
		cqt[56-24,70:130]=15.0
		result,per_note,splits,rejected=retrigger.retriggers(
			events,sensitive,cqt,np.array([.75]),np.array([3.]),np.array([0]))
		self.assertEqual(len(splits),1)
		self.assertEqual(len(result),3)
		self.assertEqual(sum(e['start']==.75 for e in result),1)
		self.assertEqual(len({(s['sourceMidi'],s['recoveredStart']) for s in splits}),1)
		self.assertTrue(any(e['reason']=='already_assigned_to_overlapping_original'
			for e in rejected))
		self.assertEqual(per_note[1]['flag'],'needs_human_check')

	def test_empty_source_onset_array_leaves_notes_intact_and_flags_uncertainty(self):
		events={'events':[{
			'midi':56,'start':.4,'end':1.1,'confidence':.70,
			'expression':{'estimatedVelocity':80}}]}
		sensitive={'events':[{
			'midi':56,'start':.75,'end':.96,'confidence':.80,
			'expression':{'estimatedVelocity':80}}]}
		cqt=np.full((84,350),.001,dtype='float32')
		cqt[56-24,70:130]=15.
		result,per_note,splits,rejected=retrigger.retriggers(
			events,sensitive,cqt,np.array([]),
			np.zeros(350),np.array([],dtype=int))
		self.assertEqual([{k:v for k,v in e.items() if k!='sourceIndex'} for e in result],
			events['events'])
		self.assertEqual(result[0]['sourceIndex'],0)
		self.assertEqual(splits,[])
		self.assertEqual(per_note[0]['flag'],'needs_human_check')
		self.assertTrue(any(e['reason']=='no_detected_source_transients'
			for e in rejected))

if __name__=='__main__':
	unittest.main()
