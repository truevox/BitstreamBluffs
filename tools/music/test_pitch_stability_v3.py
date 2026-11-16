"""Offline pitch stabilization acceptance tests; no imported app runtime."""
import unittest
import numpy as np
from pitch_stability_v3 import stabilized_control

class PitchStabilityTests(unittest.TestCase):
	def test_micro_slides_suppressed_without_requantizing_center(self):
		n=120
		time=np.arange(n)*.01
		cents=12*np.sin(time*2*np.pi*5)+8*np.sin(time*2*np.pi*11)
		f0=447*np.exp2(cents/1200)
		out,notes,_=stabilized_control(f0,np.ones(n,bool),
			[dict(start=0.,end=1.2,frequency=447,midi=69)],
			expression=.35)
		self.assertLess(np.std(1200*np.log2(out/np.median(out))),1.3)
		self.assertAlmostEqual(float(np.median(out)),447,delta=1)
	def test_large_real_glide_retained(self):
		n=130
		cents=np.zeros(n)
		cents[30:95]=np.linspace(0,240,65)
		cents[95:]=240
		f0=440*np.exp2(cents/1200)
		out,notes,report=stabilized_control(f0,np.ones(n,bool),
			[dict(start=0.,end=1.3,frequency=440,midi=69)],
			expression=.35)
		# Intentional 240-cent glide remains large and smooth, not flattened.
		diff=1200*np.log2(out[106]/out[10])
		self.assertGreater(diff,120)
		self.assertLess(diff,250)
		self.assertGreater(report[0]['persistentGlideFrames'],30)
	def test_note_reset_keeps_real_steps(self):
		f0=np.concatenate([np.full(100,440.),np.full(100,523.251)])
		out,notes,_=stabilized_control(f0,np.ones(200,bool),[
			dict(start=0.,end=1.,frequency=440.,midi=69),
			dict(start=1.,end=2.,frequency=523.251,midi=72)
		])
		self.assertAlmostEqual(notes[0]['midi'],69)
		self.assertAlmostEqual(notes[1]['midi'],72)
		self.assertAlmostEqual(float(np.median(out[:95])),440,delta=1)
		self.assertAlmostEqual(float(np.median(out[105:])),523.251,delta=1)

if __name__=='__main__':
	unittest.main()
