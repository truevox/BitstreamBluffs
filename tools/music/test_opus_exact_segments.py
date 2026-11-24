#!/usr/bin/env python3
"""Real FFmpeg/Opus regression for Fable's 312-frame/6.5ms segment bug."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from opus_exact_segments import decoded_frame_count,encode_exact_segments

class OpusExactTests(unittest.TestCase):
	def test_full_duration_and_partial_tail_at_all_segment_boundaries(self):
		rate=48000
		lengths=[576000,576000,37001]
		total=sum(lengths)
		t=np.arange(total,dtype=np.float32)/rate
		audio=np.column_stack([
			.18*np.sin(2*np.pi*440*t),
			.18*np.sin(2*np.pi*660*t)]).astype('float32')
		cursor=0
		segs=[]
		for n in lengths:
			segs.append({'startFrame':cursor,'frames':n})
			cursor+=n
		with tempfile.TemporaryDirectory() as scratch:
			files=encode_exact_segments(audio,scratch,'part',segs)
			self.assertEqual(len(files),3)
			for index,name in enumerate(files):
				self.assertEqual(decoded_frame_count(Path(scratch)/name),lengths[index])
				print('SAMPLE_EXACT_PROBE',name,'frames',lengths[index])
	def test_refuses_bad_manifest_and_nan_signal(self):
		audio=np.ones((100,2),dtype='float32')
		with tempfile.TemporaryDirectory() as tmp:
			with self.assertRaisesRegex(ValueError,'manifest'):
				encode_exact_segments(audio,tmp,'bad',[{'startFrame':0,'frames':90}])
			audio[2,0]=np.nan
			with self.assertRaisesRegex(ValueError,'finite'):
				encode_exact_segments(audio,tmp,'bad',[{'startFrame':0,'frames':100}])

if __name__=='__main__':
	unittest.main()
