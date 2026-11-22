#!/usr/bin/env python3
"""Synthetic harmony fidelity and source-bound original OGG sidecar QA."""
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from research_source_harmony_timeline import (
	RATE,SOURCE_RATE,BIN_FRAMES,FORMAT,STATUS,PITCH_NAMES,
	chroma_features,summarize_bins,read_stitched_harmonics
)
ROOT=Path(__file__).resolve().parents[2]


def wave(midi_notes,seconds=4):
	t=np.arange(round(seconds*RATE))/RATE
	return sum(.10*np.sin(2*np.pi*440*2**((m-69)/12)*t) for m in midi_notes).astype(np.float32)

class TestChromaTimeline(unittest.TestCase):
	def test_three_different_known_synthetic_triads(self):
		for midi in ((60,64,67),(62,65,69),(65,69,72)):
			with self.subTest(midi=midi):
				x=wave(midi)
				_,chroma,energy,_=chroma_features(x,np.ones(len(x),dtype=bool))
				row=chroma[:,10:100].mean(axis=1)
				self.assertEqual(set(np.argsort(-row)[:3]),set(m%12 for m in midi))

	def test_absolute_250ms_bins_not_fractional_beats(self):
		w=wave((60,64,67),seconds=2)
		t,p,e,_=chroma_features(w,np.ones(len(w),dtype=bool))
		c={role:(t,p,e) for role in ('guitar','piano','other')}
		coverage={role:np.ones(len(w),dtype=bool) for role in c}
		rows=summarize_bins(c,coverage,2*SOURCE_RATE)
		self.assertEqual(len(rows),8)
		self.assertEqual([r['startFrame'] for r in rows],list(range(0,2*SOURCE_RATE,BIN_FRAMES)))
		self.assertTrue(all(r['candidateOnly'] for r in rows))
		self.assertEqual(rows[3]['topPitchClasses'][0], 'C')

	def test_segment_cut_cannot_reset_absolute_harmony_timeline(self):
		# At an arbitrary source split, full-song spectral frames are unaffected.
		w=wave((60,64,67),seconds=5)
		t,p,e,_=chroma_features(w,np.ones(len(w),dtype=bool))
		segmented=np.concatenate((w[:round(2.73*RATE)],w[round(2.73*RATE):]))
		t2,p2,e2,_=chroma_features(segmented,np.ones(len(w),dtype=bool))
		self.assertTrue(np.array_equal(t,t2))
		self.assertTrue(np.array_equal(p,p2))

	def test_missing_source_roles_fail_closed(self):
		w=wave((60,64,67),seconds=2)
		t,p,e,_=chroma_features(w,np.ones(len(w),dtype=bool))
		data={'guitar':(t,p,e),'piano':(t,p,e),'other':(t,p,e)}
		coverage={r:np.zeros(len(w),dtype=bool) for r in data}
		rows=summarize_bins(data,coverage,2*SOURCE_RATE)
		self.assertTrue(all(x['status']=='INSUFFICIENT_SOURCE_HARMONY' for x in rows))
		self.assertTrue(all(not x['topPitchClasses'] for x in rows))

	def test_nan_source_rejected(self):
		w=wave((60,64,67),seconds=2)
		w[100]=np.nan
		with self.assertRaises(ValueError):chroma_features(w,np.ones(len(w),dtype=bool))

	def test_absent_or_unexpected_source_hash_refused(self):
		with tempfile.TemporaryDirectory() as tmp:
			seg={'startFrame':0,'frames':SOURCE_RATE,
				'sources':{'guitar':'0000-guitar.ogg','piano':'0000-piano.ogg','other':'0000-other.ogg'}}
			with self.assertRaises(FileNotFoundError):
				read_stitched_harmonics(Path(tmp),{'frameCount':SOURCE_RATE,'segments':[seg]},
					{'0':{'guitar':'0'*64,'piano':'0'*64,'other':'0'*64}})

	def test_actual_report_exact_manifest_and_699_contiguous_bins(self):
		j=json.loads((ROOT/'docs/music-review/one-more-run-source-time-harmony-UNVERIFIED-20261121.json').read_text())
		self.assertEqual(j['format'],FORMAT)
		self.assertEqual(j['status'],STATUS)
		self.assertEqual(j['originalManifestSha256'],'e7d5b95ecb258c86551fd242ceb9696427c1655dc91d11b95b60dd6ef0647d6a')
		self.assertEqual(j['originalFrameCount'],8380800)
		self.assertEqual(j['originalSourceSampleRate'],48000)
		self.assertEqual(j['binFrames'],12000)
		self.assertEqual(j['pitchClassNames'],list(PITCH_NAMES))
		self.assertEqual(len(j['timeline']),699)
		self.assertEqual(len(j['sourceStemSha256']),15)
		self.assertTrue(all(set(v)=={'guitar','piano','other'} for v in j['sourceStemSha256'].values()))
		self.assertEqual(len(j['decodeCoverage']),45)
		self.assertEqual(j['timeline'][0]['startFrame'],0)
		self.assertEqual(j['timeline'][-1]['endFrame'],8380800)
		self.assertTrue(all(j['timeline'][i]['endFrame']==j['timeline'][i+1]['startFrame'] for i in range(698)))
		self.assertTrue(all(row['candidateOnly'] for row in j['timeline']))
		self.assertTrue(all(len(row['pitchClassWeights'])==12 for row in j['timeline']))
		for row in j['timeline']:
			if row['topPitchClasses']:
				self.assertAlmostEqual(sum(row['pitchClassWeights']),1,places=4)
			else:
				self.assertEqual(row['status'],'INSUFFICIENT_SOURCE_HARMONY')
		self.assertNotIn('verifiedChord',j)
		self.assertNotIn('beatOnes',j)
		self.assertNotIn('verifiedBpm',j)

if __name__=='__main__':unittest.main()
