#!/usr/bin/env python3
"""V7 real-source review triage invariants; never turns model agreement to gold."""
import hashlib
import unittest
from collections import Counter
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch
import json
import numpy as np

from triage_real_drum_disagreements_v7 import (
	REVIEW_STATUS, attach_release_matches, describe_candidate,
	shortlist, triage_window, load_source_windows
)


class RealDrumTriageTests(unittest.TestCase):
	def test_duplicate_matches_are_one_to_one_not_human_gold(self):
		proposed=[{'index':0,'type':'snare','startFrame':48000},
			{'index':1,'type':'snare','startFrame':48010},
			{'index':2,'type':'hat','startFrame':48000}]
		released=[{'type':'snare','startFrame':48004}]
		matched=attach_release_matches(proposed,released,20)
		self.assertEqual(len(matched),1)
		self.assertIn(next(iter(matched)),(0,1))
		self.assertNotIn(2,matched)
	def test_candidate_veto_and_relative_band_provenance(self):
		candidate={'index':0,'type':'snare','startFrame':48000,
			'relativeSec':0.5}
		siblings=[candidate,{'index':1,'type':'kick',
			'startFrame':48040,'relativeSec':0.50083}]
		with patch('triage_real_drum_disagreements_v7.attack_features',
			return_value={'kick':2.,'snare':1.,'hat':7.}):
			row=describe_candidate(candidate,siblings,Counter(),{0:48010},
				{0:48010},{},24000,96000)
		self.assertFalse(row['v6Retained'])
		self.assertAlmostEqual(row['v6OwnBandShare'],.1)
		self.assertTrue(row['within20msOfProvisionalRelease'])
		self.assertIn('vetoed-but-release-agrees',row['machineReasons'])
		self.assertIn('cross-family-coincidence',row['machineReasons'])
		self.assertEqual(row['matchedProvisionalReleaseFrame20ms'],48010)
		self.assertEqual(row['status'],REVIEW_STATUS)

	def test_shortlist_diverse_and_avoids_excerpt_boundaries(self):
		def entry(i):
			return {'class':'snare','startFrame':48000+i*25000,
				'startSeconds':1+i*25000/48000,
				'v6Retained':True,'v6OwnBandShare':.3,
				'withinWindowBoundary200ms':False,
				'machineReasons':['retained-but-release-disagrees']}
		windows=[{'songId':song,'windowId':'fixed-14s',
			'sourceStemSha256':'f'*64,'baselineScoreHash':'b'*64,
			'events':[entry(i) for i in range(12)]}
			for song in ('first','second')]
		windows[0]['events'][0]['withinWindowBoundary200ms']=True
		rows=shortlist(windows,per_song=4)
		self.assertEqual(len(rows),8)
		self.assertTrue(all(r['status']==REVIEW_STATUS for r in rows))
		self.assertTrue(all(r['startSeconds']!=1. for r in rows if r['songId']=='first'))
		self.assertEqual(len(set((r['songId'],r['startFrame'])
			for r in rows)),len(rows))
		self.assertEqual(rows,shortlist(list(reversed(windows)),per_song=4))
	def test_pinned_window_is_readonly_and_non_gold(self):
		song='FEsxYVStla4'
		wave=np.zeros(16000,dtype='float32')
		sha=hashlib.sha256(wave.tobytes()).hexdigest()
		score={'scoreHash':'b'*64,'frameCount':48000*20,
			'events':{'drums':[{'startFrame':48000,'class':'snare'}]}}
		row={'id':'mock','startFrame':24000,'endFrame':72000}
		v5=[{'t':.5,'type':'snare'},{'t':.7,'type':'hat'}]
		v6=[v5[0]]
		with patch('triage_real_drum_disagreements_v7.read_pcm',
			return_value=wave),patch(
			'triage_real_drum_disagreements_v7.source_predictions',
			return_value=v5),patch(
			'triage_real_drum_disagreements_v7.cross_band_veto',
			return_value=(v6,{'input':2})),patch(
			'triage_real_drum_disagreements_v7.attack_bands',
			return_value={}),patch(
			'triage_real_drum_disagreements_v7.attack_features',
			return_value={'kick':0.,'snare':2.,'hat':0.}):
			report=triage_window(song,score,row,'f'*64)
		self.assertEqual(report['decodedPcmSha256'],sha)
		self.assertEqual(report['v5Count'],2)
		self.assertEqual(report['v6Count'],1)
		self.assertEqual(report['v6SuppressedCount'],1)
		self.assertEqual(report['status'],REVIEW_STATUS)
		self.assertEqual(report['events'][0]['matchedProvisionalReleaseFrame20ms'],48000)
		self.assertNotIn('precision',str(report).lower())
		self.assertTrue(np.all(wave==0))
	def test_fail_closed_queue_hash_and_status(self):
		with TemporaryDirectory() as root:
			p=Path(root)/'01_FEsxYVStla4'
			p.mkdir()
			score={'songId':'FEsxYVStla4','scoreHash':'f'*64,
				'quality':'provisional-unreviewed',
				'provenance':{'sourceStemSha256':{'drums':'e'*64}}}
			(p/'performance.json').write_text(json.dumps(score))
			(p/'review-queue-v1.json').write_text(json.dumps({
				'songId':'FEsxYVStla4','baselineScoreHash':'other',
				'status':'machine-ranked-disagreement-not-human-verified',
				'excerpts':[]}))
			with patch('triage_real_drum_disagreements_v7.verify_master') as verify:
				with self.assertRaisesRegex(ValueError,'mismatch'):
					load_source_windows(Path(root))
				verify.assert_not_called()
			(p/'review-queue-v1.json').write_text(json.dumps({
				'songId':'FEsxYVStla4','baselineScoreHash':'f'*64,
				'status':'human-verified','excerpts':[]}))
			with patch('triage_real_drum_disagreements_v7.verify_master') as verify:
				with self.assertRaisesRegex(ValueError,'unverified'):
					load_source_windows(Path(root))
				verify.assert_not_called()

if __name__=='__main__':
	unittest.main()
