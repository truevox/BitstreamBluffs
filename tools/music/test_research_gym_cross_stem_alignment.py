"""Fast non-ML synthetic checks for research-only beat-phase annotations."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from research_gym_cross_stem_alignment import (
	align_harmonic_sections, preview_frames, related_frequency_pairs,
	wrapped_residual,
)


class CrossStemResearchTests(unittest.TestCase):
	def test_double_time_can_align_without_metrical_approval(self):
		drum = dict(absoluteOnsetPhaseSeconds=.31, sections=[
			dict(absoluteStartSeconds=0, phaseResidualMs=0, periodicConcentration=.4),
			dict(absoluteStartSeconds=12, phaseResidualMs=120, periodicConcentration=.2),
			dict(absoluteStartSeconds=24, phaseResidualMs=0, periodicConcentration=.01),
		])
		bass = dict(absoluteOnsetPhaseSeconds=.273, sections=[
			dict(absoluteStartSeconds=0, phaseResidualMs=0, periodicConcentration=.5),
			dict(absoluteStartSeconds=12, phaseResidualMs=0, periodicConcentration=.2),
			dict(absoluteStartSeconds=24, phaseResidualMs=0, periodicConcentration=.5),
		])
		out = align_harmonic_sections(drum, bass, 163.84, 81.92)
		self.assertEqual(out['machineAlignedSections'], 1)
		self.assertEqual(out['totalSections'], 3)
		self.assertEqual([x['candidateForHumanSpotCheck'] for x in out['sections']],
			[True, False, False])
		self.assertIn('RESEARCH_ONLY', out['status'])
		self.assertEqual(out['bothStemsStrongSections'],2)
		self.assertAlmostEqual(out['uniformRandomPhaseNullProbability'],.355,places=3)
		self.assertIn('DESCRIPTIVE ONLY',out['nullModelWarning'])

	def test_equal_frequency_tracks_onsets_but_never_certifies_pulse(self):
		drum=dict(absoluteOnsetPhaseSeconds=.144,sections=[
			dict(absoluteStartSeconds=0,phaseResidualMs=5,periodicConcentration=.25),
			dict(absoluteStartSeconds=12,phaseResidualMs=3,periodicConcentration=.20)])
		bass=dict(absoluteOnsetPhaseSeconds=.155,sections=[
			dict(absoluteStartSeconds=0,phaseResidualMs=0,periodicConcentration=.19),
			dict(absoluteStartSeconds=12,phaseResidualMs=170,periodicConcentration=.2)])
		x=align_harmonic_sections(drum,bass,140.13,140.13,ratio=1)
		self.assertEqual(x['ratio'],'1:1')
		self.assertEqual(x['machineAlignedSections'],1)
		self.assertTrue(x['sections'][0]['candidateForHumanSpotCheck'])
		self.assertFalse(x['sections'][1]['candidateForHumanSpotCheck'])
		self.assertIn('RESEARCH_ONLY',x['status'])

	def test_mismatched_ratio_and_bad_numbers_never_become_alignment(self):
		x = dict(absoluteOnsetPhaseSeconds=0, sections=[])
		self.assertIsNone(align_harmonic_sections(x,x,180,80))
		self.assertIsNone(align_harmonic_sections(x,x,float('nan'),80))
		self.assertIsNone(align_harmonic_sections(x,x,160,0))
		self.assertIsNone(align_harmonic_sections(x,x,160,80,ratio=1))

	def test_wrapped_offsets_with_half_beats(self):
		self.assertAlmostEqual(wrapped_residual(.31,.273,60/163.84),.037)
		self.assertAlmostEqual(wrapped_residual(.31+60/163.84,.273,60/163.84),.037)
		self.assertAlmostEqual(wrapped_residual(.31-.1,.273,60/163.84),-.063)

	def test_dominant_harmonic_ratios_are_not_quarter_note_identity(self):
		p=related_frequency_pairs([(163.84/60,200),(122.88/60,110)],
			[(81.92/60,160),(41.0/60,90)])
		self.assertEqual(p[0]['ratio'],'2:1')
		self.assertEqual(p[0]['drumsBpm'],163.84)
		self.assertEqual(p[0]['bassBpm'],81.92)

	def test_preview_frames_never_pretend_to_be_verified(self):
		self.assertEqual(preview_frames(.25,2,300000,48000,4),
			[12000,36000,60000,84000])
		self.assertEqual(preview_frames(.25,2,48000,48000,5),[12000,36000])


if __name__ == '__main__':
	unittest.main()
