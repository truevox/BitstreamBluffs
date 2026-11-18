"""Verified visual builder safety and exact original source provenance checks."""
import hashlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_gym_beat_visual_review import (
	make_segment_svg,phased_ticks,svg_path,ticks_for_window,validate_sources,
)

ROOT=Path(__file__).resolve().parents[2]
PACK=ROOT/'public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json'


class BeatReviewVisualTests(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.pack=json.loads(PACK.read_text())
		cls.pack_sha=hashlib.sha256(PACK.read_bytes()).hexdigest()
		cls.queue=json.loads((ROOT/'docs/music-review/one-more-run-machine-review-queue-UNVERIFIED-v1.json').read_text())
		cls.original=json.loads((ROOT/'docs/music-review/one-more-run-original-mix-onsets-UNVERIFIED-v1.json').read_text())
		cls.multi=json.loads((ROOT/'docs/music-review/one-more-run-dp-beats-UNVERIFIED-v1.json').read_text())
		cls.source_hash=cls.queue['originalWavSha256']

	def test_real_original_and_pack_identity_strictly_bound(self):
		self.assertTrue(validate_sources(self.queue,self.pack,self.original,self.multi,
			self.source_hash,self.pack_sha))

	def test_modified_or_missing_original_sha_rejected(self):
		with self.assertRaisesRegex(ValueError,'Original WAV SHA'):
			validate_sources(self.queue,self.pack,self.original,self.multi,
				'a'*64,self.pack_sha)
		with self.assertRaisesRegex(ValueError,'Pack manifest SHA'):
			validate_sources(self.queue,self.pack,self.original,self.multi,
				self.source_hash,'b'*64)

	def test_review_queue_cannot_contain_approved_beats(self):
		d=json.loads(json.dumps(self.queue))
		d['allSections'][0]['approval']=True
		with self.assertRaisesRegex(ValueError,'no approved beats'):
			validate_sources(d,self.pack,self.original,self.multi,
				self.source_hash,self.pack_sha)

	def test_source_frame_positions_cannot_drift(self):
		d=json.loads(json.dumps(self.queue))
		d['allSections'][2]['originalSourceStartFrame']+=100
		with self.assertRaisesRegex(ValueError,'Wrong segment'):
			validate_sources(d,self.pack,self.original,self.multi,
				self.source_hash,self.pack_sha)

	def test_tick_window_boundaries_and_fft_phase(self):
		self.assertEqual(ticks_for_window([0,1,2,3],1,3),[1.0,2.0])
		self.assertEqual([round(x,3) for x in phased_ticks(120,.1,1,2)],
			[1.1,1.6])

	def test_one_synthetic_panel_has_three_distinct_beat_lanes(self):
		import numpy as np
		section=dict(startSeconds=0.0,endSeconds=12.0)
		wave=np.zeros(1200,dtype=float)
		wave[120]=1
		svg=make_segment_svg(section,
			{'mix':wave,'drums':wave,'bass':wave},
			{'bpm':163.84,'phase':.22},[.1,.5,1.0],[.2,.8])
		self.assertEqual(svg.count('<polyline'),3)
		self.assertEqual(svg.count('unverified ticks'),3)
		self.assertIn('accent-slow',svg)
		self.assertIn('accent-fast',svg)
		self.assertIn('accent-fft',svg)
		self.assertIn('Original drums stem',svg)
		self.assertIn('Full original WAV mix',svg)


if __name__=='__main__':
	unittest.main()
