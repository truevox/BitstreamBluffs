#!/usr/bin/env python3
"""Regression gates for the two independent user-requested orchestra fixes."""
import unittest
import numpy as np
import render_biome_orchestras_v1 as previous
import render_biome_orchestras_v2 as revised

class OrchestraRevisionTests(unittest.TestCase):
	def test_all_modes_release_to_actual_silence(self):
		for biome,row in revised.CHARACTERS.items():
			mode=row[2]
			for revision in ('articulation','orchestral'):
				with self.subTest(biome=biome,revision=revision):
					signal=revised.corrected_note(63,.2,90,mode,
						np.random.default_rng(402),revision)
					self.assertGreater(len(signal),int(.2*revised.SYNTH_RATE))
					self.assertTrue(np.all(np.isfinite(signal)))
					self.assertAlmostEqual(float(signal[-1]),0,places=7)
					body=float(np.sqrt(np.mean(signal.astype('float64')**2)))
					first=float(np.sqrt(np.mean(signal[:360].astype('float64')**2)))
					tail=float(np.sqrt(np.mean(signal[-216:].astype('float64')**2)))
					self.assertGreater(first/body,.11,'Start must be audible')
					self.assertLess(tail/body,.012,'End must have a real release')
	def test_old_envelopes_were_truncated_without_note_off(self):
		for mode in ('holopad','hydroglass','windharp','bowedsteel'):
			with self.subTest(mode=mode):
				signal=previous.modal_note(63,.55,90,mode,
					np.random.default_rng(33))
				body=float(np.sqrt(np.mean(signal.astype('float64')**2)))
				tail=float(np.sqrt(np.mean(signal[-240:].astype('float64')**2)))
				self.assertGreater(tail/body,.7)
	def test_same_score_and_same_number_of_notes(self):
		events=[{'midi':63,'start':.16,'end':.36,'confidence':.89,
			'expression':{'estimatedVelocity':85}},
			{'midi':58,'start':.62,'end':.94,'confidence':.81,
			'expression':{'estimatedVelocity':72}},
			{'midi':66,'start':1.10,'end':1.23,'confidence':.57,
			'expression':{'estimatedVelocity':90}}]
		for mode in ('crystal-cavern','vertigo-vents','steampunk-slopes'):
			with self.subTest(mode=mode):
				timed,n1=revised.render_featured_notes(events,mode,'articulation')
				unique,n2=revised.render_featured_notes(events,mode,'orchestral')
				self.assertEqual((n1,n2),(3,3))
				self.assertEqual(timed.shape,(revised.SYNTH_FRAMES*2,2))
				self.assertEqual(unique.shape,timed.shape)
				self.assertFalse(np.array_equal(timed,unique))
	def test_crystal_bong_adds_real_bell_ringing(self):
		note=revised.crystal_bong(60,100,np.random.default_rng(5))
		self.assertGreater(len(note),revised.SYNTH_RATE)
		self.assertGreater(np.sqrt(np.mean(note[:4800]**2)),.07)
		self.assertLess(float(np.max(np.abs(note[-40:]))),.002)

if __name__=='__main__':unittest.main()
