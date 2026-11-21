#!/usr/bin/env python3
"""Spectral flux rhythm QA with controlled synthetic audio and source hashes.

No synthetic fixture or passing assertion establishes the real song's beats.
"""
from __future__ import annotations
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from research_spectral_rhythm import (
	TICK,RATE,SOURCE_RATE,STATUS,FORMAT,ROLES,
	acf_periodicity,spectral_onset,expected_original_hashes,source_spectral_envelopes
)

ROOT=Path(__file__).resolve().parents[2]


def synthetic_music(bpm_at,seconds=22.,half_accent=False):
	n=int(round(seconds*RATE))
	pcm=np.zeros(n,dtype=np.float64)
	beat=.15;i=0
	while beat<seconds-.2:
		k=round(beat*RATE)
		note_t=np.arange(round(.024*RATE))/RATE
		burst=(np.sin(2*np.pi*660*note_t)+.6*np.sin(2*np.pi*1410*note_t))*np.hanning(len(note_t))
		if half_accent and i%2: burst*=.3
		end=min(len(pcm),k+len(burst));pcm[k:end]+=burst[:end-k]
		beat+=60/bpm_at(beat);i+=1
	return pcm


class TestSourceSpectralRhythm(unittest.TestCase):
	def test_real_pcm_synthetic_160_bpm_pulse(self):
		e=spectral_onset(synthetic_music(lambda _:160))
		p=acf_periodicity(e)
		self.assertEqual(p['status'],'CANDIDATES_UNVERIFIED')
		self.assertAlmostEqual(p['preferredBpm'],160,delta=3.)
		self.assertTrue(p['candidateOnly'])

	def test_known_tempo_variants_follow_sources(self):
		for bpm in (154.,166.):
			with self.subTest(bpm=bpm):
				r=acf_periodicity(spectral_onset(synthetic_music(lambda _:bpm)))
				self.assertAlmostEqual(r['preferredBpm'],bpm,delta=3)

	def test_tempo_ramp_is_not_forced_to_exact_160(self):
		e=spectral_onset(synthetic_music(lambda t:154+14*t/28.,seconds=28.))
		n=round(14/TICK)
		first=acf_periodicity(e[:n]);last=acf_periodicity(e[n:])
		self.assertGreater(last['preferredBpm'],first['preferredBpm']+4)

	def test_half_time_accent_does_not_approve_half_time_meter(self):
		e=spectral_onset(synthetic_music(lambda _:160.,half_accent=True))
		r=acf_periodicity(e)
		self.assertTrue(r['candidateOnly'])
		self.assertAlmostEqual(r['preferredBpm'],160.,delta=3)

	def test_silence_does_not_hallucinate_rhythmic_frequency(self):
		e=spectral_onset(np.zeros(6*RATE))
		self.assertEqual(acf_periodicity(e)['status'],'INSUFFICIENT_EVIDENCE')
		self.assertIsNone(acf_periodicity(e)['preferredBpm'])

	def test_invalid_input_fails_closed(self):
		for x in (np.array([]),np.array([-1.,.5]),np.array([np.nan,0.])):
			with self.subTest(input=str(x)):
				with self.assertRaises(ValueError):acf_periodicity(x)
		with self.assertRaises(ValueError):spectral_onset(np.r_[np.zeros(2*RATE),np.nan])

	def test_original_hashes_bound_to_previous_two_source_reports(self):
		prior=ROOT/'docs/music-review/one-more-run-source-downbeat-candidates-ALL-WINDOWS-UNVERIFIED-20261120.json'
		harmonic=ROOT/'docs/music-review/one-more-run-harmonic-bar-cues-UNVERIFIED-20261120.json'
		d=json.loads(prior.read_bytes())
		hashes,refs=expected_original_hashes(prior,harmonic,d['manifestSha256'])
		self.assertEqual(len(hashes),15)
		self.assertTrue(all(set(x)==set(ROLES) for x in hashes.values()))
		self.assertEqual(refs['priorReportSha256'],hashlib.sha256(prior.read_bytes()).hexdigest())
		with self.assertRaisesRegex(ValueError,'source-fingerprint report/status mismatch'):
			expected_original_hashes(prior,harmonic,'0'*64)

	def test_tampered_original_file_rejected_before_ffmpeg(self):
		with tempfile.TemporaryDirectory() as d:
			pack=Path(d)
			(pack/'0000-drums.ogg').write_bytes(b'not actual original OGG')
			manifest={'frameCount':48000,'segments':[{'startFrame':0,'frames':48000,
				'sources':{role:'0000-'+role+'.ogg' for role in ROLES}}]}
			with self.assertRaisesRegex(ValueError,'source tampering/mismatch'):
				source_spectral_envelopes(pack,manifest,{'0':{role:'0'*64 for role in ROLES}})

	def test_report_preserves_original_audio_provenance_and_no_approval(self):
		p=ROOT/'docs/music-review/one-more-run-spectral-onset-UNVERIFIED-20261121.json'
		data=json.loads(p.read_bytes())
		self.assertEqual(data['format'],FORMAT)
		self.assertEqual(data['status'],STATUS)
		self.assertEqual(data['sourceFrameCount'],8380800)
		self.assertEqual(len(data['sourceStemSha256']),15)
		self.assertEqual(len(data['regions']),28)
		self.assertTrue(all(set(hashes)==set(ROLES) for hashes in data['sourceStemSha256'].values()))
		self.assertTrue(all(w['status']=='UNVERIFIED_CANDIDATE_ONLY' for w in data['regions']))
		self.assertTrue(all(all(w['periodicities'][role]['candidateOnly'] for role in ROLES) for w in data['regions']))
		self.assertNotIn('verifiedBeatOneFrames',data)
		self.assertNotIn('approvedTempoMap',data)
		self.assertEqual(data['sourceManifestSha256'],
			'e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a')

if __name__=='__main__':unittest.main()
