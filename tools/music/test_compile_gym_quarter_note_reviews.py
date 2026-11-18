"""Consensus tooling must fail closed; never auto-promote Gym beat grids."""
import copy
import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parent))
from compile_gym_quarter_note_reviews import (
	ATTESTATION, CANDIDATE_FORMAT, FORMAT, MIN_CONFIDENCE,
	compile_candidate, compare_pulses, make_template, source_identity,
	validate_review,
)

ROOT=Path(__file__).resolve().parents[2]
MANIFEST_PATH=ROOT/'public/music/packs/33_local-one-more-run-bitstream-bluffs/pack.json'
QUEUE_PATH=ROOT/'docs/music-review/one-more-run-machine-review-queue-UNVERIFIED-v1.json'


class QuarterNoteConsensusTests(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.manifest=json.loads(MANIFEST_PATH.read_text())
		cls.queue=json.loads(QUEUE_PATH.read_text())
		cls.manifest_sha=hashlib.sha256(MANIFEST_PATH.read_bytes()).hexdigest()
		cls.identity=source_identity(cls.queue,cls.manifest,cls.manifest_sha)

	def template(self, reviewer):
		review=make_template(self.queue,self.manifest,self.manifest_sha)
		review.update(reviewerId=reviewer,reviewerRole='independent-human',
			attestation=ATTESTATION)
		return review

	def add_reviewed(self, review, segment=0, offset_frames=0, confidence=.96):
		seg=self.manifest['segments'][segment]
		rate=self.manifest['sampleRate']
		# A fully annotated 161-BPM *synthetic test*, not a musical claim.
		period=rate*.3715
		first=seg['startFrame']+int(.1*rate)
		beats=[]
		while first+round(period*len(beats))<seg['startFrame']+seg['frames']:
			beats.append(first+int(round(period*len(beats)))+offset_frames)
		review['sections'][segment].update(status='reviewed',
			meter='regular-quarter-note',confidence=confidence,
			pulseFrames=beats,notes='Synthetic test annotation ONLY')
		return review

	def compile(self,a,b):
		return compile_candidate(self.queue,self.manifest,self.manifest_sha,a,b)

	def test_blank_template_is_not_review_and_not_a_game_grid(self):
		t=make_template(self.queue,self.manifest,self.manifest_sha)
		self.assertEqual(t['format'],FORMAT)
		self.assertEqual(t['attestation'],'PENDING')
		self.assertEqual(len(t['sections']),15)
		self.assertTrue(all(not s['pulseFrames'] and s['status']=='uncertain'
			for s in t['sections']))
		with self.assertRaisesRegex(ValueError,'reviewer identity'):
			validate_review(t,self.identity,self.manifest['segments'])

	def test_matching_two_people_create_candidate_not_accepted_game_grid(self):
		a=self.add_reviewed(self.template('reviewer-A'))
		b=self.add_reviewed(self.template('reviewer-B'),offset_frames=450)
		c=self.compile(a,b)
		self.assertEqual(c['format'],CANDIDATE_FORMAT)
		self.assertNotEqual(c['format'],'bitstream-beat-grid-v1')
		self.assertEqual(c['consensusCandidateSections'],1)
		self.assertEqual(c['unresolvedSections'],14)
		self.assertEqual(c['allSections'][0]['status'],'human-consensus-candidate')
		self.assertEqual(c['allSections'][0]['confidence'],.96)
		self.assertFalse(c['allSections'][0]['approvedForGame'])
		self.assertTrue(all(not s['approvedForGame'] for s in c['allSections']))

	def test_conflicting_phase_becomes_uncertain_not_average(self):
		a=self.add_reviewed(self.template('reviewer-A'))
		b=self.add_reviewed(self.template('reviewer-B'),offset_frames=-3000)
		c=self.compile(a,b)
		self.assertEqual(c['consensusCandidateSections'],0)
		self.assertEqual(c['allSections'][0]['reason'],'phase-disagreement')
		self.assertEqual(c['allSections'][0]['candidateQuarterPulseFrames'],[])

	def test_one_reviewer_uncertain_prevents_approval(self):
		a=self.add_reviewed(self.template('reviewer-A'))
		b=self.template('reviewer-B')
		c=self.compile(a,b)
		self.assertEqual(c['consensusCandidateSections'],0)
		self.assertEqual(c['allSections'][0]['status'],'uncertain')

	def test_different_pulse_counts_not_averaged_or_inferred(self):
		a=self.add_reviewed(self.template('reviewer-A'))
		b=self.add_reviewed(self.template('reviewer-B'))
		b['sections'][0]['pulseFrames'].pop(2)
		# Missing beat is correctly rejected instead of considered uncertainty
		# after a real human claimed complete review.
		with self.assertRaisesRegex(ValueError,'missing pulse'):
			self.compile(a,b)

	def test_bad_original_recording_and_manifest_rejected(self):
		a=self.add_reviewed(self.template('reviewer-A'))
		b=self.add_reviewed(self.template('reviewer-B'))
		for changed in ('originalWavSha256','manifestSha256','sourceFrameCount','trackId'):
			x=copy.deepcopy(a)
			x[changed]='b'*64 if 'Sha256' in changed else -1
			with self.subTest(changed=changed),self.assertRaisesRegex(ValueError,'provenance mismatch'):
				self.compile(x,b)
		with self.assertRaisesRegex(ValueError,'music pack changed'):
			source_identity(self.queue,self.manifest,'b'*64)

	def test_same_reviewer_or_absent_attestation_rejected(self):
		a=self.add_reviewed(self.template('Reviewer-A'))
		b=self.add_reviewed(self.template('reviewer-a'))
		with self.assertRaisesRegex(ValueError,'distinct'):
			self.compile(a,b)
		b['reviewerId']='Reviewer-B'
		b['attestation']='an algorithm told me the beats'
		with self.assertRaisesRegex(ValueError,'attestation'):
			self.compile(a,b)

	def test_uncertain_sections_may_not_smuggle_pulses(self):
		a=self.template('reviewer-A')
		a['sections'][2]['pulseFrames']=[48000*24+10]
		with self.assertRaisesRegex(ValueError,'uncertain must contain no beat'):
			validate_review(a,self.identity,self.manifest['segments'])

	def test_review_status_requires_high_confidence_and_regular_pulse(self):
		a=self.add_reviewed(self.template('reviewer-A'))
		a['sections'][0]['confidence']=.86
		with self.assertRaisesRegex(ValueError,'confidence insufficient'):
			validate_review(a,self.identity,self.manifest['segments'])
		a['sections'][0]['confidence']=.96
		a['sections'][0]['meter']='eighth-note-upbeat'
		with self.assertRaisesRegex(ValueError,'meter identity'):
			validate_review(a,self.identity,self.manifest['segments'])

	def test_subdivisions_that_skip_beats_cannot_claim_full_section(self):
		a=self.add_reviewed(self.template('reviewer-A'))
		a['sections'][0]['pulseFrames']=a['sections'][0]['pulseFrames'][::2]
		# This could be a true 80 BPM quarter pulse; tooling cannot decide
		# musical identity. It correctly REQUIRES a human metrical attestation.
		self.assertEqual(validate_review(a,self.identity,self.manifest['segments']),'reviewer-A')
		a['attestation']='I guessed the half-time'
		with self.assertRaisesRegex(ValueError,'attestation'):
			validate_review(a,self.identity,self.manifest['segments'])

	def test_even_unanimous_review_candidate_is_rejected_by_real_game_validator(self):
		# An end-to-end trust-boundary test: intentionally synthetic two-person
		# agreement cannot masquerade as runtime beat-grid metadata. No human
		# review is simulated as actual proof.
		a=self.add_reviewed(self.template('synthetic-reviewer-A'))
		b=self.add_reviewed(self.template('synthetic-reviewer-B'),offset_frames=360)
		candidate=self.compile(a,b)
		js="""import {validateBeatGrid} from './src/systems/music/BeatGridTiming.js';
const input=JSON.parse(process.argv[1]);
const pack={id:input.trackId,sampleRate:input.sourceSampleRate,
 frameCount:input.sourceFrameCount};
const verdict=validateBeatGrid(input,pack);
if(verdict.trusted||verdict.reason!=='missing-or-mismatched-grid')
 process.exit(2);
console.log('UNTRUSTED_CONSENSUS_CANDIDATE_CANNOT_AUTHORIZE_GYM');
"""
		p=subprocess.run(['node','--input-type=module','-e',js,
			json.dumps(candidate,sort_keys=True)],cwd=ROOT,text=True,
			capture_output=True,timeout=12,check=False)
		self.assertEqual(p.returncode,0,p.stderr)
		self.assertIn('CANNOT_AUTHORIZE',p.stdout)

	def test_comparison_boundary_45ms(self):
		self.assertTrue(compare_pulses([1_000,2_000],[3_160,4_160],2160)['trustedConsensus'])
		self.assertFalse(compare_pulses([1_000,2_000],[3_161,4_160],2160)['trustedConsensus'])
		self.assertFalse(compare_pulses([1_000,2_000],[1_000],2160)['trustedConsensus'])


if __name__=='__main__':
	unittest.main()
