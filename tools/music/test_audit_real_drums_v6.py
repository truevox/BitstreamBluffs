#!/usr/bin/env python3
"""Offline tests: source hashes, PCM integrity, and unlabeled comparisons."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np

from audit_real_drums_v6 import (
	SOURCE_PATHS,verify_master,read_pcm,compare_to_release,event_rows,clip_audit
)
SONG='FEsxYVStla4'
HASH='f'*64
SCORE={'songId':SONG,'quality':'provisional-unreviewed',
	'provenance':{'sourceStemSha256':{'drums':HASH}},
	'events':{'drums':[]},'scoreHash':'score-test'}


class RealFlacV6Tests(unittest.TestCase):
	def test_source_full_hash_must_match(self):
		path=SOURCE_PATHS[SONG]
		with patch('audit_real_drums_v6.proxmox',
			return_value=SimpleNamespace(stdout=f'{HASH}  {path}\n'.encode())):
			self.assertEqual(verify_master(SONG,SCORE),HASH)
		with patch('audit_real_drums_v6.proxmox',
			return_value=SimpleNamespace(stdout=f'{"0"*64}  {path}\n'.encode())):
			with self.assertRaisesRegex(ValueError,'hash/path mismatch'):
				verify_master(SONG,SCORE)
		with self.assertRaises(ValueError):
			verify_master(SONG,{**SCORE,'quality':'human-verified'})

	def test_pcm_fails_closed_for_short_invalid_or_large_inputs(self):
		with self.assertRaises(ValueError):
			read_pcm(SONG,0,21*48000)
		with patch('audit_real_drums_v6.proxmox',
			return_value=SimpleNamespace(stdout=b'broken')):
			with self.assertRaisesRegex(ValueError,'PCM alignment'):
				read_pcm(SONG,0,48000)
		with patch('audit_real_drums_v6.proxmox',
			return_value=SimpleNamespace(stdout=np.zeros(2,dtype='<f4').tobytes())):
			with self.assertRaisesRegex(ValueError,'Short'):
				read_pcm(SONG,0,48000)
		data=np.zeros(16000,dtype='<f4')
		with patch('audit_real_drums_v6.proxmox',
			return_value=SimpleNamespace(stdout=data.tobytes())):
			decoded=read_pcm(SONG,0,48000)
			self.assertEqual(len(decoded),16000)
			self.assertFalse(np.shares_memory(decoded,data))

	def test_release_reference_is_not_treated_as_verified_gold(self):
		release=[{'type':'kick','startFrame':48000}]
		predicted=[{'type':'kick','startFrame':48000},
			{'type':'kick','startFrame':48240},
			{'type':'hat','startFrame':48000}]
		out=compare_to_release(predicted,release,20)
		self.assertEqual(out['kick'],{'releaseCount':1,'candidateCount':2,
			'pairedWithRelease':1,'candidateUnpairedWithRelease':1,
			'releaseUnpairedWithCandidate':0})
		self.assertEqual(out['hat']['pairedWithRelease'],0)
		self.assertNotIn('precision',str(out).lower())

	def test_v6_must_be_subset_of_v5_for_same_window(self):
		wave=np.zeros(16000,dtype='float32')
		mock_v5=[{'t':0.3,'type':'kick'}]
		row={'startFrame':0,'endFrame':48000}
		with patch('audit_real_drums_v6.read_pcm',return_value=wave), \
			patch('audit_real_drums_v6.source_predictions',return_value=mock_v5), \
			patch('audit_real_drums_v6.cross_band_veto',return_value=(
				[{'t':0.3,'type':'snare'}],{'removed':{}})):
			with self.assertRaisesRegex(ValueError,'added events'):
				clip_audit(SONG,SCORE,row,'test',HASH)
		with patch('audit_real_drums_v6.read_pcm',return_value=wave), \
			patch('audit_real_drums_v6.source_predictions',return_value=mock_v5), \
			patch('audit_real_drums_v6.cross_band_veto',return_value=(
				[],{'removed':{'kick':1,'hat':0,'snare':0}})):
			audit=clip_audit(SONG,SCORE,row,'test',HASH)
			self.assertEqual(audit['v6Counts']['kick'],0)
			self.assertEqual(audit['v5Counts']['kick'],1)
			self.assertFalse('truePositive' in str(audit))
			self.assertIn('NO human gold',audit['status'])


if __name__=='__main__':
	unittest.main()
