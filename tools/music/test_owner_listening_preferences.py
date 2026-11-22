#!/usr/bin/env python3
"""Source-authenticated HUMAN PREFERENCES, not verified musical source beats."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

class TestOwnerListeningPreferences(unittest.TestCase):
	def test_explicit_owner_preferences_are_not_default_assumptions(self):
		data=json.loads((ROOT/'docs/music-review/one-more-run-owner-preferences-UNVERIFIED-20261121.json').read_text())
		self.assertEqual(data['status'],'HUMAN_PREFERRED_CANDIDATES_CORRECTED_AUDIO_WINDOW_NOT_VERIFIED_MUSICAL_BEAT_LABELS')
		self.assertFalse(data['releaseEligible'])
		self.assertEqual(len(data['humanPreferences']),4)
		self.assertTrue(all(x['userConfirmedThisWasAPreferredSelection'] for x in data['humanPreferences']))
		self.assertTrue(all(x['candidateOnly'] and not x['musicalBeatOneVerified'] and not x['originalRecordingTempoVerified'] for x in data['humanPreferences']))
		self.assertEqual([x['algorithmRankWithinFour'] for x in data['humanPreferences']],[3,1,1,1])

	def test_preferred_controls_match_sha_bound_original_source_packet(self):
		data=json.loads((ROOT/'docs/music-review/one-more-run-owner-preferences-UNVERIFIED-20261121.json').read_text())
		path=ROOT/'public/music-review/downbeat-review/candidates.json'
		packet=json.loads(path.read_text())
		self.assertEqual(data['listeningPacketSha256'],hashlib.sha256(path.read_bytes()).hexdigest())
		self.assertEqual(data['originalWavMasterSha256'],packet['source']['originalMasterWavSha256'])
		self.assertEqual(data['sourceOggManifestSha256'],packet['source']['manifestSha256'])
		for x in data['humanPreferences']:
			w=packet['windows'][x['displayedSourceSegmentIndex']]
			self.assertEqual(x['displayedSourceWindowSeconds'],[w['startSeconds'],w['endSeconds']])
			h=next(h for h in w['hypotheses'] if abs(h['bpmHypothesis']-x['bpmHypothesis'])<1e-4)
			phase=h['phases'][x['pulsePhaseOneBased']-1]
			self.assertAlmostEqual(phase['phaseSeconds'],x['phaseOffsetSeconds'])
			o=next(o for o in phase['offsets'] if o['beatOneOffset']==x['beatOneShiftBeats'])
			self.assertEqual(o['rank'],x['algorithmRankWithinFour'])

	def test_corrected_fourth_preference_has_actual_segment_one_source(self):
		data=json.loads((ROOT/'docs/music-review/one-more-run-owner-preferences-UNVERIFIED-20261121.json').read_text())
		fourth=data['humanPreferences'][3]
		self.assertEqual(fourth['displayedSuggestedPassageCenterSeconds'],16.44)
		self.assertEqual(fourth['displayedSourceSegmentIndex'],1)
		self.assertEqual(fourth['displayedSourceWindowSeconds'],[12,24])
		self.assertEqual(fourth['loadedPassageCenterSecondsFromPreviousSelector'],16.44)
		self.assertEqual(fourth['bpmHypothesis'],163.84)
		self.assertEqual(fourth['pulsePhaseOneBased'],4)
		self.assertEqual(fourth['beatOneShiftBeats'],3)
		self.assertEqual(fourth['algorithmRankWithinFour'],1)
		self.assertAlmostEqual(fourth['phaseOffsetSeconds'],.3617)
		self.assertTrue(fourth['actualDisplayedSuggestedPassageHeardConfirmed'])
		self.assertTrue(all(x['actualDisplayedSuggestedPassageHeardConfirmed'] for x in data['humanPreferences']))


if __name__=='__main__':unittest.main()
