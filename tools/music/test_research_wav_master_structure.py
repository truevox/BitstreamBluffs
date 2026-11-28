#!/usr/bin/env python3
"""Synthetic and exact-provenance lossless-master source research QA."""
from __future__ import annotations
import json
import unittest
from pathlib import Path
import numpy as np
from research_wav_master_structure import (
	FORMAT,STATUS,MASTER_SHA256,SOURCE_FRAMES,DURATION,RATE,
	validated_probe,neighborhood_energy_change,harmonic_section_cues,candidate_review_sections
)

ROOT=Path(__file__).resolve().parents[2]


class TestOriginalMasterQA(unittest.TestCase):
	def test_known_wav_format_and_exact_clock_accepted(self):
		validated_probe({'format':{'format_name':'wav','duration':str(DURATION)},
			'streams':[{'codec_name':'pcm_s16le','sample_rate':'48000','channels':2}]})

	def test_wrong_master_format_or_clock_fails_closed(self):
		for key,value in [('codec_name','flac'),('channels',1),('sample_rate','44100')]:
			with self.subTest(key=key):
				stream={'codec_name':'pcm_s16le','sample_rate':'48000','channels':2}
				stream[key]=value
				with self.assertRaises(ValueError):
					validated_probe({'format':{'format_name':'wav','duration':str(DURATION)},'streams':[stream]})
		with self.assertRaises(ValueError):
			validated_probe({'format':{'format_name':'wav','duration':'165.0'},
				'streams':[{'codec_name':'pcm_s16le','sample_rate':'48000','channels':2}]})

	def test_energy_step_localizes_a_deliberate_level_change(self):
		x=np.r_[np.ones(RATE*5)*.1,np.ones(RATE*5)*.6]
		self.assertGreater(neighborhood_energy_change(x,5),1.)
		self.assertLess(neighborhood_energy_change(x,2.5),.01)

	def test_synthetic_chord_boundary_is_only_candidate(self):
		# Source-like 40s with sustained different harmonies and a clear chord
		# transition, but no tempo/meter. This is NOT a validated chorus start.
		rate=RATE;t=np.arange(rate*40)/rate
		a=(np.sin(2*np.pi*440*t)+.7*np.sin(2*np.pi*554.37*t))*.15
		b=(np.sin(2*np.pi*392*t)+.7*np.sin(2*np.pi*493.88*t))*.15
		signal=np.where(t<20,a,b)
		candidates=harmonic_section_cues(signal,max_peaks=8)
		self.assertTrue(all(c['candidateOnly'] and not c['sectionStartVerified'] for c in candidates))
		self.assertTrue(any(abs(c['originalSourceSeconds']-20)<1 for c in candidates),
			'Known harmony change should get a source-review candidate')

	def test_review_queue_retains_explicit_old_uncertainty(self):
		p=[{'originalSourceSeconds':40,'heuristicReviewPriority':.9,'candidateOnly':True}]
		queue=candidate_review_sections(p,{})
		self.assertTrue(all(x['candidateOnly'] and not x['humanVerified'] for x in queue))
		self.assertEqual([x['centerSeconds'] for x in queue[:2]],[90.,126.])
		self.assertTrue(all(b>a for a,b in (x['suggestedListenRangeSeconds'] for x in queue)))

	def test_report_sha_and_master_only_unverified(self):
		p=ROOT/'docs/music-review/one-more-run-verified-wav-master-structure-UNVERIFIED-20261121.json'
		j=json.loads(p.read_bytes())
		self.assertEqual(j['format'],FORMAT)
		self.assertEqual(j['status'],STATUS)
		self.assertEqual(j['master']['masterSha256'],MASTER_SHA256)
		self.assertEqual(j['master']['sourceFrameCount'],SOURCE_FRAMES)
		self.assertTrue(j['master']['noPersistentAudioCopy'])
		self.assertEqual(len(j['originalWavVsMp3SourcePeriodComparisons']),28)
		self.assertEqual(len(j['originalMasterVsMp3SourceAlignment']),3)
		self.assertTrue(all(x['sourceLagSamplesAtAnalysisRate']==0 for x in j['originalMasterVsMp3SourceAlignment']))
		self.assertTrue(all(x['peakNormalizedPcmCorrelation']>.98 for x in j['originalMasterVsMp3SourceAlignment']))
		self.assertTrue(all(x['candidateOnly'] and not x['sectionStartVerified'] for x in j['originalWavChromaAndLoudnessChangeCandidates']))
		self.assertNotIn('approvedDownbeats',j)
		self.assertNotIn('verifiedMeter',j)

if __name__=='__main__':unittest.main()
