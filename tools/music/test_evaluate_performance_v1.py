import hashlib
import unittest
from evaluate_performance_v1 import evaluate,match_events,validate_gold
from performance_v1 import from_legacy,STEMS
from test_performance_v1 import sample

class TestHumanGoldEvaluation(unittest.TestCase):
	def setUp(self):
		hashes={role:hashlib.sha256(role.encode()).hexdigest() for role in STEMS}
		self.score=from_legacy("song-001",48000*2,"guitar",sample(),hashes)
		self.base={'format':'bitstream-performance-gold-v1',
			'status':'human-verified',
			'songId':self.score['songId'],
			'baseScoreHash':self.score['scoreHash'],
			'sampleRate':48000,
			'excerpts':[{'id':'fixture-one','startFrame':0,
				'endFrame':96000,'annotations':{
					'guitar':[{'startFrame':5280,'pitch':55},
						{'startFrame':5280,'pitch':67},
						{'startFrame':6240,'pitch':70}],
					'drums':[{'startFrame':8640,'class':'kick'},
						{'startFrame':8640,'class':'snare'},
						{'startFrame':11520,'class':'hat'}],
				}}]}

	def test_rejects_unreviewed_marks_as_ground_truth(self):
		self.base['status']='subjective-suspected-issue-not-gold-truth'
		with self.assertRaisesRegex(ValueError,'NOT verified'):
			evaluate(self.score,self.base)

	def test_one_to_one_repeated_pitch_and_simultaneous_cohits(self):
		report=evaluate(self.score,self.base)
		# Two identical guitar-note guesses cannot both claim the same
		# real human note: two same-pitch gold notes are separately needed.
		# Third note and three drum cohits match too.
		a=report['aggregate']['20ms']
		self.assertEqual(a['truePositive'],5)
		self.assertEqual(a['falsePositive'],1)
		self.assertEqual(a['falseNegative'],1)
		self.assertEqual(a['precision'],round(5/6,6))
		self.assertEqual(a['recall'],round(5/6,6))
		self.assertLess(a['f1'],1)

	def test_20_vs_50ms_tolerance_shows_real_timing_delta(self):
		self.base['excerpts'][0]['annotations']['drums'][0]['startFrame']=8640+round(.038*48000)
		a=evaluate(self.score,self.base)['aggregate']
		self.assertEqual(a['20ms']['truePositive'],4)
		self.assertEqual(a['50ms']['truePositive'],5)
		self.assertLess(a['20ms']['f1'],a['50ms']['f1'])

	def test_one_source_prediction_never_matches_two_gold_notes(self):
		p=[{'startFrame':9600}]
		g=[{'startFrame':9600},{'startFrame':9630}]
		self.assertEqual(len(match_events(p,g,2400)),1)

	def test_invalid_pitch_and_wrong_revision_fail_closed(self):
		self.base['baseScoreHash']='different'
		with self.assertRaisesRegex(ValueError,'exact candidate score'):
			evaluate(self.score,self.base)
		self.base['baseScoreHash']=self.score['scoreHash']
		self.base['excerpts'][0]['annotations']['guitar'][0]['pitch']=128
		with self.assertRaisesRegex(ValueError,'bad gold pitch'):
			evaluate(self.score,self.base)

	def test_sign_and_empty_pairs_are_unambiguous(self):
		self.base['excerpts'][0]['annotations']={
			'bass':[{'startFrame':round(.18*48000),'pitch':40}]}
		a=evaluate(self.score,self.base)['aggregate']['50ms']
		self.assertEqual(a['truePositive'],1)
		self.assertLess(a['signedBiasMs'],0)
		self.assertGreaterEqual(a['jitterSdMs'],0)

if __name__=='__main__':
	unittest.main()
