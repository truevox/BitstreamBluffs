"""Acceptance tests for V4 source-driven synthesis without MIDI note timing."""
import unittest

import numpy as np

from continuous_challenger_v4 import INPUT_RATE, RATE, features, synthesize


class ContinuousV4Tests(unittest.TestCase):
	def test_two_separate_attacks_under_70ms(self):
		seconds=1
		audio=np.zeros(INPUT_RATE*seconds,dtype=np.float32)
		rate=INPUT_RATE
		# Two true attacks 40ms apart, formerly too close for 70ms refractory.
		for start in (.35,.39):
			origin=round(start*rate)
			t=np.arange(round(.012*rate),dtype=np.float32)/rate
			audio[origin:origin+len(t)]+=.7*np.sin(2*np.pi*830*t).astype(np.float32)
		_,_,events=features(audio)
		event_times=events*.005
		for target in (.35,.39):
			self.assertTrue(np.any(np.abs(event_times-target)<.012),
				f"Missing {target}s attack: {event_times.tolist()}")
	def test_stable_pitch_renders_wav_without_midi_events(self):
		duration=.2
		n=int(duration*RATE)
		frame_count=int(duration*100)
		freq=np.full(frame_count,440,dtype=np.float32)
		control={
			"time":np.arange(frame_count,dtype=np.float32)*.01,
			"f0":freq,
			"active":np.ones(frame_count,dtype=np.uint8),
		}
		rms=np.ones(round(duration/.005),dtype=np.float32)*.12
		for name in ("saw","organ"):
			a=synthesize(freq,rms,np.array([],dtype=int),control,duration,name)
			self.assertEqual(a.shape,(n,))
			self.assertTrue(np.isfinite(a).all())
			self.assertGreater(float(np.sqrt(np.mean(a*a))),.001)
			self.assertLess(float(np.max(np.abs(a))),.95)
	def test_note_attack_lane_does_not_reset_synth_phase(self):
		"""Attack markers may affect transient energy but not the pitch trajectory."""
		duration=.4
		count=int(duration*100)
		control={"time":np.arange(count,dtype=np.float32)*.01,
			"f0":np.full(count,329.628,dtype=np.float32),
			"active":np.ones(count,dtype=np.uint8)}
		rms=np.ones(int(duration/.005),dtype=np.float32)*.13
		with_no_onsets=synthesize(control["f0"],rms,np.array([],dtype=int),control,duration,"organ")
		with_two_onsets=synthesize(control["f0"],rms,np.array([20,27]),control,duration,"organ")
		self.assertEqual(with_no_onsets.shape,with_two_onsets.shape)
		# At times after the attack tails have decayed, the waveform should
		# closely track (allowing level-normalization differences).
		corr=np.corrcoef(with_no_onsets[int(.25*RATE):],
			with_two_onsets[int(.25*RATE):])[0,1]
		self.assertGreater(corr,.995)


if __name__=="__main__":
	unittest.main()
