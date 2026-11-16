#!/usr/bin/env python3
"""Regression checks for independent, non-destructive V3 research tools."""
import hashlib
import tempfile
import unittest
import wave
from pathlib import Path
import numpy as np

from benchmark_notes_ground_truth import match,notes_for
from calibrate_drum_classifier import features
from extract_expression_v3 import annotate,RATE
from profile_stem_semantics import signature
from verify_audio_integrity import inspect as verify

class ResearchV3Tests(unittest.TestCase):
	def test_ground_truth_matching(self):
		truth=[{'midi':60,'start':.3,'end':.6},
			{'midi':64,'start':.3,'end':.6}]
		good=[{'midi':60,'start':.34,'end':.65},
			{'midi':64,'start':.33,'end':.61}]
		result=match(truth,good)
		self.assertEqual(result['tp'],2)
		self.assertEqual(result['f1'],1)
		bad=good+[{'midi':68,'start':.3,'end':.5}]
		self.assertLess(match(truth,bad)['precision'],1)
		shifted=[dict(item,start=item['start']+.3) for item in good]
		self.assertEqual(match(truth,shifted)['tp'],0)

	def test_known_patterns_are_deterministic(self):
		for role in ('guitar','piano','other'):
			for pattern in ('melody','chords'):
				events=notes_for(role,pattern)
				self.assertTrue(events)
				self.assertEqual(events,notes_for(role,pattern))
				self.assertTrue(all(0<=n['start']<n['end']<=16 for n in events))

	def test_expression_velocity_relative_to_source(self):
		y=np.zeros(RATE*3,dtype=np.float32)
		n=[{'midi':60,'start':.50,'end':.74},
			{'midi':60,'start':1.02,'end':1.25}]
		y[round(.5*RATE):round(.74*RATE)]=.04
		y[round(1.02*RATE):round(1.25*RATE)]=.36
		result=annotate(y,n)
		self.assertLess(result[0]['expression']['estimatedVelocity'],
			result[1]['expression']['estimatedVelocity'])
		self.assertEqual(result[0]['expression']['pitchBendStatus'],
			'not_estimated_polyphonic_source')
		self.assertEqual(len(result),2)

	def test_classifier_features_are_finite(self):
		y=np.zeros(18000,dtype=np.float32)
		self.assertTrue(np.all(np.isfinite(features(y))))
		y[:5000]=np.sin(np.linspace(0,20*np.pi,5000))
		self.assertTrue(np.all(np.isfinite(features(y))))

	def test_stem_spectral_signature(self):
		silence=np.zeros(RATE*3,dtype=np.float32)
		diag,spec=signature(silence[::2])
		self.assertEqual(diag['activeFraction'],0)
		self.assertEqual(len(spec),32)

	def test_audio_checksum_and_probe(self):
		with tempfile.TemporaryDirectory() as folder:
			path=Path(folder)/'test.wav'
			samples=(.25*np.sin(np.arange(RATE)*2*np.pi*440/RATE)
				*32767).astype('<i2')
			with wave.open(str(path),'wb') as writer:
				writer.setnchannels(1);writer.setframerate(RATE)
				writer.setsampwidth(2);writer.writeframes(samples.tobytes())
			row=verify(path,{},'source')
			self.assertEqual(row['flags'],[])
			self.assertEqual(row['sha256'],hashlib.sha256(path.read_bytes()).hexdigest())
			bad=verify(path,{str(path):'0'*64},'source')
			self.assertIn('grouped_11_to_6_checksum_mismatch',bad['flags'])

if __name__=='__main__':
	unittest.main(verbosity=2)
