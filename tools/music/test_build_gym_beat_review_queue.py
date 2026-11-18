"""Review priority logic must remain non-authoritative for gameplay."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from build_gym_beat_review_queue import fraction_near_lattice,section_metrics,spread_review_sections


class HumanReviewQueueTests(unittest.TestCase):
	def test_phase_near_lattice_and_offset(self):
		self.assertEqual(fraction_near_lattice([.25,.75,1.25],120,.25),1.0)
		self.assertEqual(fraction_near_lattice([.38,.88,1.38],120,.25),0.0)
		self.assertEqual(fraction_near_lattice([],120,.25),0.0)

	def test_report_sections_never_approve_grids(self):
		seg=dict(index=0,startFrame=0,frames=48000*12)
		cross=dict(sections=[dict(startSeconds=0,
			bassDrumHarmonicPhaseErrorMs=15,
			bothStemsHavePeriodicOnsetEnergy=True,
			candidateForHumanSpotCheck=True)])
		x=section_metrics(seg,[.5,1.0,1.5,2.0],[.5,1.5],cross,
			{120:.5},48000*12,48000)
		self.assertFalse(x['approval'])
		self.assertTrue(x['crossStemMachineAligned'])
		self.assertIn('PENDING',x['decision'])
		self.assertEqual(x['candidateSourceFrames'],[24000,48000,72000,96000])

	def test_review_selection_spreads_full_song_not_just_high_early_scores(self):
		sections=[dict(segmentIndex=i,crossStemMachineAligned=i in (0,1,3,6,12,14),
			machineReviewPriority=(10 if i<3 else 2)) for i in range(15)]
		pos=spread_review_sections(sections,count=4,expected_kind=True)
		neg=spread_review_sections(sections,count=4,expected_kind=False)
		self.assertIn(12,[s['segmentIndex'] for s in pos])
		self.assertIn(13,[s['segmentIndex'] for s in neg])
		self.assertEqual(len(pos),4)
		self.assertEqual(len(neg),4)

	def test_metric_flags_disagreement_without_promotion(self):
		seg=dict(index=0,startFrame=0,frames=48000*12)
		cross=dict(sections=[dict(startSeconds=0,
			bassDrumHarmonicPhaseErrorMs=131,
			bothStemsHavePeriodicOnsetEnergy=True,
			candidateForHumanSpotCheck=False)])
		x=section_metrics(seg,[.5,1,1.5,2],[.5,1.5],cross,
			{160:.1},48000*12,48000)
		self.assertFalse(x['approval'])
		self.assertIn('drum_bass_strong_but_phase_disagree',x['flags'])


if __name__=='__main__':
	unittest.main()
