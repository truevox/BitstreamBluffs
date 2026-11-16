#!/usr/bin/env python3
"""Deterministic safety/structure checks for the additive research pipeline."""
import json
import math
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

from audit_stem_library import inspect
from pipeline_v2 import plan
from transcribe_drums_v2 import analyze

class ResearchTests(unittest.TestCase):
	def test_silence_has_no_drums(self):
		events,report=analyze(np.zeros(22050*2,dtype=np.float32),2)
		self.assertEqual(events,[])
		self.assertIn('no_onsets_detected',report['warnings'])

	def test_drum_transient_timing_is_bounded(self):
		audio=np.zeros(22050*2,dtype=np.float32)
		for t in (.35,.8,1.4):
			pos=int(t*22050)
			audio[pos:pos+250]+=(np.random.default_rng(int(t*1000)).
				normal(size=250)*.6).astype('float32')
		events,qa=analyze(audio,2)
		self.assertTrue(qa['candidateOnsetPeaks']>=2,qa)
		self.assertTrue(all(0<=e['t']<2 and 0<e['velocity']<=127
			and e['type'] in ('kick','snare','hat') for e in events))

	def test_archive_probe_and_metadata(self):
		with tempfile.TemporaryDirectory() as d:
			path=Path(d)/'tone.wav'
			samples=(np.sin(np.arange(22050)*2*math.pi*440/22050)*10000).astype('<i2')
			with wave.open(str(path),'wb') as wav:
				wav.setnchannels(1)
				wav.setsampwidth(2)
				wav.setframerate(22050)
				wav.writeframes(samples.tobytes())
			data=inspect(path,window=.2)
			self.assertTrue(data['exists'])
			self.assertEqual(data['rate'],22050)
			self.assertLess(abs(data['duration']-1),.002)
			self.assertIn('sampleRmsDb',data)

	def test_plan_all_roles_and_approval_gate(self):
		with tempfile.TemporaryDirectory() as d:
			root=Path(d)
			(root/'roster.json').write_text(json.dumps({'tracks':[
				{'slot':1,'id':'fake','title':'Synthetic Test'}]}))
			folder=root/'stems/htdemucs_6s/01_fake'
			folder.mkdir(parents=True)
			for role in ('vocals','drums','bass','guitar','piano','other'):
				(folder/(role+'.flac')).write_bytes(b'example private input')
			first=plan(root)
			second=plan(root)
			self.assertEqual(first,second)
			self.assertEqual(len(first['songs']),1)
			self.assertEqual(len(first['songs'][0]['tasks']),4)
			self.assertEqual([x['status'] for x in first['songs'][0]['tasks']],
				['ready','ready','blocked_owner_audio_approval',
				'blocked_owner_audio_approval'])
			(folder/'guitar.flac').unlink()
			with self.assertRaises(FileNotFoundError):
				plan(root)

if __name__=='__main__':
	unittest.main(verbosity=2)
