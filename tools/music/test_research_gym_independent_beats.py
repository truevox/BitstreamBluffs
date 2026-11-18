"""Small exact beat-coincidence checks, not musical approval."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from research_gym_independent_beats import score_agreement


class MultiplePriorBeatHypothesisTests(unittest.TestCase):
	def test_identical_candidate_grids_agree_both_directions(self):
		x=score_agreement([.5,1,1.5],[.5,1,1.5])
		self.assertEqual((x['matchedLeft'],x['matchedRight']),(3,3))
		self.assertEqual((x['matchedLeftFraction'],x['matchedRightFraction']),(1,1))

	def test_half_time_does_not_falsely_look_like_same_grid(self):
		x=score_agreement([0,.5,1,1.5,2],[0,1,2])
		self.assertEqual(x['matchedLeft'],3)
		self.assertEqual(x['matchedRight'],3)
		self.assertEqual(x['matchedLeftFraction'],.6)
		self.assertEqual(x['matchedRightFraction'],1.0)

	def test_shifted_or_empty_beats_are_rejected(self):
		x=score_agreement([.3,.8,1.3],[.4,.9,1.4])
		self.assertEqual((x['matchedLeft'],x['matchedRight']),(0,0))
		self.assertEqual(score_agreement([],[1,2])['matchedLeftFraction'],0)
		self.assertEqual(score_agreement([1,2],[])['matchedRightFraction'],0)


if __name__=='__main__':
	unittest.main()
