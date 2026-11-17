#!/usr/bin/env python3
"""Release score capture contract, no large audio/models/network needed."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from performance_v1 import (
	RATE,ROLES,STEMS,FORMAT,from_legacy,read,write_new,validate,
	to_legacy,apply_patch_layer,content_hash,
)

def sample():
	return {
		'melody':[{'start':.1,'end':.25,'midi':68},
			{'start':.3,'end':.5,'midi':68}],
		'bass':[{'start':.15,'end':.25,'midi':40}],
		'drums':[{'t':.18,'type':'kick'},{'t':.18,'type':'snare'},
			{'t':.24,'type':'hat'}],
		'guitar':[{'midi':55,'start':.11,'end':.56,'confidence':.72,
			'expression':{'estimatedVelocity':83}},
			{'midi':55,'start':.11,'end':.56,'confidence':.72,
			'expression':{'estimatedVelocity':83}},
			{'midi':67,'start':.11,'end':.56,'confidence':.72}],
		'piano':[{'midi':59,'start':.12,'end':.35}],
		'other':[{'midi':73,'start':.28,'end':.9}],
	}

class TestPerformanceV1(unittest.TestCase):
	def setUp(self):
		self.original=sample()
		self.hashes={role:hashlib.sha256(role.encode()).hexdigest()
			for role in STEMS}
		self.doc=from_legacy('song-001',RATE*2,'guitar',
			self.original,self.hashes)

	def test_round_trip_is_identity_for_all_event_times_and_note_order(self):
		self.assertEqual(self.doc['format'],FORMAT)
		for role in ROLES:
			self.assertEqual(to_legacy(self.doc,role),self.original[role])
		self.assertEqual(self.doc['sampleRate'],RATE)
		self.assertIs(self.doc['calibratedConfidence'],False)
		self.assertTrue(all(e['confidence'] is None for role in ROLES
			for e in self.doc['events'][role]))

	def test_stable_ids_are_unique_across_simultaneous_drum_classes_and_duplicates(self):
		all_ids=[e['id'] for role in ROLES for e in self.doc['events'][role]]
		self.assertEqual(len(all_ids),len(set(all_ids)))
		a,b=self.doc['events']['guitar'][:2]
		self.assertNotEqual(a['id'],b['id'])
		kick,snare=self.doc['events']['drums'][:2]
		self.assertEqual(kick['startFrame'],snare['startFrame'])
		self.assertNotEqual(kick['id'],snare['id'])
		self.assertEqual(kick['startFrame'],round(.18*RATE))
		self.assertEqual(a['startFrame'],round(.11*RATE))

	def test_hash_deterministic_and_private_path_free(self):
		a=from_legacy('song-001',RATE*2,'guitar',sample(),self.hashes)
		self.assertEqual(self.doc['scoreHash'],a['scoreHash'])
		self.assertNotIn('/root/',json.dumps(self.doc))
		self.assertNotIn('flac',json.dumps(self.doc).lower())

	def test_immutable_writer_and_loader_reject_tampering(self):
		with tempfile.TemporaryDirectory() as home:
			path=Path(home)/'a'/'performance.json'
			write_new(path,self.doc)
			self.assertEqual(read(path),self.doc)
			with self.assertRaises(FileExistsError):
				write_new(path,self.doc)
			malformed=copy.deepcopy(self.doc)
			malformed['events']['bass'][0]['startFrame']=-3
			with self.assertRaisesRegex(ValueError,'invalid event start'):
				validate(malformed)
			malformed=copy.deepcopy(self.doc)
			malformed['events']['drums'][1]['id']=malformed['events']['drums'][0]['id']
			with self.assertRaisesRegex(ValueError,'duplicate event'):
				validate(malformed)
			malformed=copy.deepcopy(self.doc)
			malformed['provenance']['sourceStemSha256']['bass']='nothash'
			with self.assertRaisesRegex(ValueError,'fingerprint'):
				validate(malformed)
			malformed=copy.deepcopy(self.doc)
			malformed['events']['melody'][0]['pitch']=1
			with self.assertRaisesRegex(ValueError,'score fingerprint mismatch'):
				validate(malformed)

	def test_repeated_same_pitch_attacks_are_not_merged(self):
		a,b=self.doc['events']['melody']
		self.assertEqual(a['pitch'],b['pitch'])
		self.assertLess(a['startFrame'],b['startFrame'])
		self.assertNotEqual(a['id'],b['id'])

	def test_patch_requires_matching_original_hash_and_report_conflicts(self):
		event=self.doc['events']['guitar'][0]
		patch={'format':'bitstream-performance-patches-v1',
			'songId':'song-001','baseScoreHash':'bad',
			'operations':[{'action':'reject','id':event['id']}]}
		applied,conflicts=apply_patch_layer(self.doc,patch)
		self.assertIsNone(applied)
		self.assertEqual(conflicts[0]['reason'],'base-score-changed')
		patch['baseScoreHash']=self.doc['scoreHash']
		patch['operations']=[{'action':'retime','id':'unknown',
			'startFrame':240,'endFrame':920}]
		applied,conflicts=apply_patch_layer(self.doc,patch)
		self.assertIsNone(applied)
		self.assertEqual(conflicts[0]['reason'],'missing-event')

	def test_corrected_score_is_separate_version_and_renders_its_edit(self):
		event=self.doc['events']['guitar'][0]
		patch={'format':'bitstream-performance-patches-v1',
			'songId':self.doc['songId'],'baseScoreHash':self.doc['scoreHash'],
			'operations':[{'action':'retime','id':event['id'],
				'startFrame':round(.13*RATE),'endFrame':round(.58*RATE)}]}
		applied,conflicts=apply_patch_layer(self.doc,patch)
		self.assertEqual(conflicts,[])
		self.assertEqual(self.doc['events']['guitar'][0]['startFrame'],round(.11*RATE))
		self.assertEqual(applied['events']['guitar'][0]['startFrame'],round(.13*RATE))
		self.assertEqual(applied['quality'],'human-correction-layer-applied')
		self.assertEqual(applied['derivedFromScoreHash'],self.doc['scoreHash'])
		validate(applied)
		self.assertEqual(to_legacy(applied,'guitar')[0]['start'],.13)

	def test_experimental_candidate_quality_must_never_claim_approval(self):
		from performance_v1 import DETECTORS
		raw=from_legacy('song-001',RATE*2,'guitar',
			sample(),self.hashes,quality='experimental-candidate-unreviewed',
			detectors=DETECTORS)
		validate(raw)
		self.assertEqual(raw['quality'],'experimental-candidate-unreviewed')
		self.assertFalse(raw['calibratedConfidence'])
		self.assertNotEqual(raw['scoreHash'],self.doc['scoreHash'])
		with self.assertRaisesRegex(ValueError,'unapproved score creation quality'):
			from_legacy('song-001',RATE*2,'guitar',
				sample(),self.hashes,quality='artist-approved')

	def test_never_silently_reinterpret_old_patches_on_new_score(self):
		patch={'format':'bitstream-performance-patches-v1',
			'songId':self.doc['songId'],'baseScoreHash':self.doc['scoreHash'],
			'operations':[{'action':'reject',
				'id':self.doc['events']['bass'][0]['id']}]}
		changed=copy.deepcopy(self.doc)
		changed['events']['bass'][0]['startFrame']+=48
		changed['scoreHash']=content_hash({k:v for k,v in changed.items()
			if k!='scoreHash'})
		other,conflicts=apply_patch_layer(changed,patch)
		self.assertIsNone(other)
		self.assertEqual(conflicts[0]['reason'],'base-score-changed')

	def test_atomic_combined_note_patch_retains_nudge_and_octave(self):
		e=self.doc['events']['guitar'][0]
		patch={'format':'bitstream-performance-patches-v1',
			'status':'draft-unreviewed-not-applied-to-audio',
			'songId':self.doc['songId'],'baseScoreHash':self.doc['scoreHash'],
			'operations':[{'action':'correct','id':e['id'],
				'startFrame':round(.10*RATE),'endFrame':round(.55*RATE),
				'pitch':e['pitch']+12}]}
		applied,conflicts=apply_patch_layer(self.doc,patch)
		self.assertEqual(conflicts,[])
		validate(applied)
		self.assertEqual(applied['events']['guitar'][0]['startFrame'],round(.10*RATE))
		self.assertEqual(applied['events']['guitar'][0]['pitch'],e['pitch']+12)
		self.assertEqual(self.doc['events']['guitar'][0]['pitch'],e['pitch'])
		self.assertEqual(to_legacy(applied,'guitar')[0]['start'],.10)

	def test_patch_cannot_cross_adjacent_attack_or_corrupt_note(self):
		e=self.doc['events']['melody'][0]
		patch={'format':'bitstream-performance-patches-v1',
			'songId':self.doc['songId'],'baseScoreHash':self.doc['scoreHash'],
			'operations':[{'action':'correct','id':e['id'],
				'startFrame':round(.4*RATE),'endFrame':round(.42*RATE),
				'pitch':e['pitch']}]}
		applied,conflicts=apply_patch_layer(self.doc,patch)
		self.assertIsNone(applied)
		self.assertEqual(conflicts[0]['reason'],'would-cross-neighbor-onset')
		patch['operations'][0]['startFrame']=round(.10*RATE)
		patch['operations'][0]['pitch']=200
		applied,conflicts=apply_patch_layer(self.doc,patch)
		self.assertIsNone(applied)
		self.assertEqual(conflicts[0]['reason'],'invalid-combined-correction')

	def test_drum_atomic_correct_keeps_class_and_source(self):
		e=self.doc['events']['drums'][0]
		patch={'format':'bitstream-performance-patches-v1',
			'songId':self.doc['songId'],'baseScoreHash':self.doc['scoreHash'],
			'operations':[{'action':'correct','id':e['id'],
				'startFrame':e['startFrame']}]}
		applied,conflicts=apply_patch_layer(self.doc,patch)
		self.assertEqual(conflicts,[])
		self.assertEqual(applied['events']['drums'][0]['class'],'kick')
		self.assertEqual(applied['events']['drums'][1]['class'],'snare')

if __name__=='__main__':
	unittest.main()
