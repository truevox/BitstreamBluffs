#!/usr/bin/env python3
"""Offline twelve-instrument resynthesis gallery from one continuous vocal pitch contour.

Input: analysis .npz from voice_resynth.py (time/f0/rms/confidence).
Output: 12 master-independent, full-length mono 48k WAV renderings plus common
25-second audition excerpts in Opus. Never edits Demucs FLAC masters.

These are proposed voice timbres for listening/iteration, not finished sound assets.
"""
import argparse
import json
import math
import subprocess
import wave
from pathlib import Path

import numpy as np

RATE = 48000
BLOCK = RATE * 6
VOICES = {
	"bitstream-bluffs": ("BITSTREAM", "Glitch-chip vocoder", "Glitchy PCM speech-chip singing"),
	"debumont": ("DEBUMONT", "Warm SNES woodwind", "An airy sampled-console flute"),
	"garbage-dump-glacier": ("GARBAGE", "Corrupted 8-bit speech chip", "Crunchy machinery and bit-broken voice"),
	"pyramid-peak": ("PYRAMID", "Ancient FM brass", "Bold nasal synth brass and fanfare"),
	"underwater-mountain": ("UNDERWATER", "Liquid glass harmonica", "Wobbly watery bell-glass voice"),
	"crystal-cavern": ("CRYSTAL", "Crystalline FM bells", "Shimmering glass and bright inharmonics"),
	"space-mountain": ("SPACE", "Vintage sci-fi theremin", "Smooth legato sine voice with space shimmer"),
	"candy-cane-canyon": ("CANDY", "Hyperpop candy synth", "Detuned fizzy bright pulse stacks"),
	"sky-jellyfish-mountain": ("JELLYFISH", "Floating vowel choir", "An airy electronic ahhh ensemble"),
	"steampunk-slopes": ("STEAMPUNK", "Mechanical steam calliope", "Fairground organ and steam whistles"),
	"micro-mountain": ("MICRO", "Tiny music box", "Plucked digital toy-box chimes"),
	"vertigo-vents": ("VERTIGO", "Volcanic distorted pipe organ", "Heavy pipe-organ fundamentals and growl"),
}


def ema_bidirectional(x, attack_frames, release_frames):
	"""Smooth note volume in frame space, without silence-phase discontinuities."""
	out = np.empty_like(x, dtype=np.float32)
	last = 0.0
	for i, val in enumerate(x):
		tau = attack_frames if val > last else release_frames
		last = last + (val - last) / max(1.0, tau)
		out[i] = last
	return out


def melody_state(cache):
	with np.load(cache) as saved:
		f0 = saved["f0"].astype(np.float32)
		rms = saved["rms"].astype(np.float32)
		clock = saved["time"].astype(np.float32)
		conf = saved["confidence"].astype(np.float32)
		length = float(saved["duration"])
		loud = float(saved["loudness_ref"])
	valid = (f0 > 65) & (f0 < 1000) & (conf > 0.54)
	pitch = f0.copy()
	# Prevent mistaken pitch octaves while retaining the fast bends and natural vibrato.
	for i in range(3, len(pitch) - 3):
		if not valid[i]:
			continue
		around = pitch[i-3:i+4][valid[i-3:i+4]]
		if len(around) >= 4:
			med = np.median(around)
			if pitch[i] > med * 1.88:
				pitch[i] *= 0.5
			elif pitch[i] < med / 1.88:
				pitch[i] *= 2.0
	valid = valid & (pitch > 65)
	# Fill across unvoiced breaks so phase remains smooth; amplitude is gated instead.
	ids = np.flatnonzero(valid)
	if not len(ids):
		raise ValueError("No vocal F0 detected")
	filled = np.interp(np.arange(len(pitch)), ids, pitch[ids]).astype(np.float32)
	voiced = valid.astype(np.float32)
	# Bridge tiny 10-40 ms unvoiced gaps (consonants), not substantial rests.
	for i in range(1, len(voiced)-4):
		if voiced[i-1] and not voiced[i]:
			for width in range(1, 5):
				if i+width < len(voiced) and voiced[i+width]:
					voiced[i:i+width] = 0.58
					break
	level = np.clip(rms / max(0.002,loud), 0, 1.6) ** 0.62
	env = ema_bidirectional(level * voiced, attack_frames=2.4, release_frames=9.0)
	# Detect attacks from voiced transitions, pitch leaps, or vowel-energy rebounding.
	notes = np.zeros(len(pitch), np.float32)
	last_note = -300
	for i in range(1,len(pitch)):
		interval = (np.log2(max(1,filled[i]) / max(1,filled[i-1])))
		rebound = env[i] > 0.30 and (env[i] - env[max(0,i-4)]) > 0.30
		new = (voiced[i] > 0.5 and voiced[i-1] < 0.2) or (abs(interval) > 0.20) or rebound
		if voiced[i] > 0.42 and i-last_note > 15 and (new or i-last_note > 65):
			notes[i] = 1.0
			last_note = i
	last = -10000
	ages = np.empty(len(notes),np.float32)
	for i,flag in enumerate(notes):
		if flag:
			last=i
		ages[i] = max(0,i-last) * 0.01
	pluck = np.exp(-ages/0.26).astype(np.float32)
	return dict(clock=clock,pitch=filled,env=env,pluck=pluck,
		voices=voiced,duration=length,loud_ref=loud,notes=int(notes.sum()))


def harmonic(phase, pitch, n, gain, cutoff=17000):
	return (np.sin(n*phase)*gain*np.clip((cutoff-n*pitch)/2000,0,1)).astype(np.float32)


def render_voice(name, state, output, max_seconds=0, frame_count=None):
	total = frame_count if frame_count is not None else int(round(state["duration"] * RATE))
	if max_seconds>0:
		total = min(total,int(round(max_seconds * RATE)))
	output.parent.mkdir(parents=True, exist_ok=True)
	phase_acc = 0.0
	rng = np.random.default_rng(99173+list(VOICES).index(name))
	total_squares = 0.0
	peak = 0.0
	with wave.open(str(output), "wb") as w:
		w.setnchannels(1)
		w.setsampwidth(2)
		w.setframerate(RATE)
		for start in range(0,total,BLOCK):
			count = min(BLOCK,total-start)
			t = (start+np.arange(count,dtype=np.float32))/RATE
			pitch = np.interp(t,state["clock"],state["pitch"],
				left=state["pitch"][0],right=state["pitch"][-1]).astype(np.float32)
			env = np.interp(t,state["clock"],state["env"],left=0,right=0).astype(np.float32)
			pluck = np.interp(t,state["clock"],state["pluck"],left=0,right=0).astype(np.float32)
			increments = 2*np.pi*pitch/RATE
			phase = np.cumsum(increments,dtype=np.float64)+phase_acc
			phase_acc = float(phase[-1] % (2*np.pi))
			phase = np.mod(phase,2*np.pi).astype(np.float32)
			waveform = np.zeros(count,dtype=np.float32)

			if name == "bitstream-bluffs":
				# Synthesized arcade speech chip; deliberate 6-bit quantizing.
				for h,a in [(1,0.73),(3,0.23),(5,0.16),(7,0.1)]:
					waveform += harmonic(phase,pitch,h,a)
				waveform = np.tanh(waveform*1.5)
				quant = (np.floor(waveform*28)/28)
				pixels = 0.86+0.14*np.sin(2*np.pi*19*t)
				waveform = (quant*pixels).astype(np.float32)
			elif name == "debumont":
				# Breath-driven soft console woodwind with warm harmonics.
				for h,a in [(1,0.82),(2,0.15),(3,0.1),(5,0.035)]:
					waveform += harmonic(phase,pitch,h,a)
				breath = rng.standard_normal(count).astype(np.float32)
				waveform += 0.026*breath
				waveform *= (0.94+0.06*np.sin(2*np.pi*5.3*t))
			elif name == "garbage-dump-glacier":
				# An unstable, nasty digital speech-chip sound: ring + hard quantization.
				for h,a in [(1,0.38),(2,0.24),(3,0.37),(5,0.18),(9,0.2)]:
					waveform += harmonic(phase,pitch,h,a)
				waveform = np.tanh(waveform*3.1)
				waveform = np.round(waveform*8)/8
				waveform *= 0.72 + 0.28*np.sin(2*np.pi*33*t)
				waveform += 0.09*np.sin(phase+2*np.pi*96*t)
			elif name == "pyramid-peak":
				# FM brass with stronger upper partials during loud attacks.
				index = 0.65+2.3*np.clip(env,0,1)
				waveform = 0.78*np.sin(phase+index*np.sin(2*phase))
				waveform += 0.19*np.sin(2*phase+0.48*np.sin(3*phase))
				waveform += 0.10*np.sin(3*phase)
				waveform = np.tanh(waveform*1.35)
			elif name == "underwater-mountain":
				# Rounded, wobbly glass harmonica with sub-surface beating.
				wobble = 0.028*np.sin(2*np.pi*1.8*t)
				waveform = 0.78*np.sin(phase+wobble)
				waveform += 0.22*np.sin(2*phase+0.4*np.sin(2*np.pi*0.67*t))
				waveform += 0.07*np.sin(4.01*phase)
				waveform *= 0.89+0.11*np.sin(2*np.pi*0.43*t)
			elif name == "crystal-cavern":
				# Bright inharmonic crystal bells. Plucked transients linger in melody.
				waveform = 0.48*np.sin(phase)
				waveform += 0.35*np.sin(2*phase+0.27*np.sin(phase*3))
				waveform += 0.25*np.sin(2.78*phase)
				waveform += 0.20*np.sin(4.13*phase)
				waveform += 0.09*np.sin(6.77*phase)
				env = env*(0.32+0.68*pluck)
			elif name == "space-mountain":
				# Classic legato theremin: continuous fundamental and spectral shimmer.
				waveform = 0.88*np.sin(phase)
				waveform += 0.16*np.sin(2*phase)
				waveform += 0.05*np.sin(3*phase+0.18*np.sin(2*np.pi*0.6*t))
				env = np.sqrt(np.maximum(0,env))*(0.93+0.07*np.sin(2*np.pi*3.6*t))
			elif name == "candy-cane-canyon":
				# Hyperpop detuned virtual polysaw, octave candy sparkle.
				for h,a in [(1,0.51),(2,0.27),(3,0.18),(4,0.13),(5,0.1),(7,0.08)]:
					waveform += harmonic(phase,pitch,h,a)
				waveform += 0.25*np.sin(phase*1.012)+0.20*np.sin(phase*0.988)
				waveform += 0.12*np.sin(2*phase+2*np.pi*7.1*t)
				waveform = np.tanh(waveform*1.9)
				waveform *= 0.88+0.12*np.sin(2*np.pi*10*t)
			elif name == "sky-jellyfish-mountain":
				# Synthetic 'ahh' vowel choir: harmonic resonances at ~F1 700, F2 1200.
				for h in range(1,15):
					freq=h*pitch
					f1=650+110*np.sin(2*np.pi*0.35*t)
					f2=1300+250*np.sin(2*np.pi*0.23*t)
					res=(0.55*np.exp(-((freq-f1)/320)**2)+
						0.48*np.exp(-((freq-f2)/470)**2)+
						0.17*np.exp(-((freq-2800)/760)**2))
					waveform += (res*np.sin(h*phase+0.08*h*np.sin(2*np.pi*0.2*t))/max(1,h*0.58)).astype(np.float32)
				waveform += 0.19*np.sin(phase*0.997)+0.19*np.sin(phase*1.003)
				waveform = np.tanh(waveform*1.2)
				env = np.sqrt(np.maximum(0,env))
			elif name == "steampunk-slopes":
				# Calliope organ: organ pipes, stable stops and slightly wheezing steam.
				for h,a in [(1,0.52),(2,0.45),(3,0.31),(4,0.12),(6,0.08)]:
					waveform += harmonic(phase,pitch,h,a)
				waveform += 0.12*np.sin(phase*0.503)
				waveform *= 0.88+0.12*np.sin(2*np.pi*6.2*t)
				waveform += 0.014*rng.standard_normal(count).astype(np.float32)
			elif name == "micro-mountain":
				# Plucked digital music box, short note attacks and inharmonic ring.
				waveform = (0.62*np.sin(phase)+0.25*np.sin(2.04*phase)+
					0.13*np.sin(4.21*phase)+0.10*np.sin(6.31*phase))
				env = env*(0.11+0.89*pluck)
			elif name == "vertigo-vents":
				# Massive distorted pipe organ with sub-oscillator and tremolo.
				waveform = (0.58*np.sin(phase/2)+0.54*np.sin(phase)+
					0.32*np.sin(2*phase)+0.27*np.sin(3*phase)+
					0.13*np.sin(5*phase))
				waveform = np.tanh(waveform*2.4)
				waveform *= 0.91+0.09*np.sin(2*np.pi*4.2*t)
			else:
				raise ValueError("Unknown mountain: "+name)
			# Normalized to leave other stems plenty of mixing headroom.
			gain = 0.31 if name not in ("sky-jellyfish-mountain","micro-mountain") else 0.40
			audio = np.clip(waveform*env*gain,-0.95,0.95).astype(np.float32)
			total_squares += float(np.dot(audio,audio))
			peak = max(peak,float(np.max(np.abs(audio))))
			pcm = (audio*32767).astype("<i2")
			w.writeframes(pcm.tobytes())
	return {
		"voice":name,
		"wav":str(output),
		"seconds":round(total/RATE,3),
		"peak_dbfs":round(20*np.log10(max(1e-7,peak)),1),
		"rms_dbfs":round(10*np.log10(max(1e-12,total_squares/total)),1),
		"notes":state["notes"],
	}


def extract_preview(input_wav, output_ogg, start, seconds, bitrate):
	cmd=[
		"ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
		"-ss",str(start),"-i",str(input_wav),"-t",str(seconds),
		"-ar",str(RATE),"-c:a","libopus","-application","audio",
		"-b:a",bitrate,"-f","ogg",str(output_ogg),
	]
	subprocess.run(cmd,check=True)


def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument("--analysis",required=True,type=Path)
	p.add_argument("--out",required=True,type=Path)
	p.add_argument("--preview-start",type=float,default=150.0)
	p.add_argument("--preview-seconds",type=float,default=25.0)
	p.add_argument("--preview-only",action="store_true",help="Render only first N seconds for fast smoke")
	p.add_argument("--max-seconds",type=float,default=0.0)
	p.add_argument("--frame-count",type=int,default=None,help="Exact sample count from validated pack manifest")
	p.add_argument("--bitrate",default="88k")
	a=p.parse_args()
	state=melody_state(a.analysis)
	a.out.mkdir(parents=True,exist_ok=True)
	status=[]
	for voice,(label,instrument,description) in VOICES.items():
		master=a.out/(voice+".wav")
		excerpt=a.out/(voice+"-excerpt.ogg")
		result=render_voice(voice,state,master,a.max_seconds,a.frame_count)
		if a.preview_start+a.preview_seconds <= result["seconds"]:
			extract_preview(master,excerpt,a.preview_start,a.preview_seconds,a.bitrate)
			result["preview"]=str(excerpt)
			result["preview_bytes"]=excerpt.stat().st_size
		status.append({**result,"label":label,"instrument":instrument,"description":description})
		print(json.dumps(status[-1]),flush=True)
	(a.out/"voice-gallery.json").write_text(json.dumps({
		"schemaVersion":1,"source":"Pope Leo Wants the AI Root Password",
		"alignment":"continuous F0 from original separated vocals (no MIDI)",
		"sampleRate":RATE,
		"previewStart":a.preview_start,"previewSeconds":a.preview_seconds,
		"voices":status,
	},indent=2)+"\n")
	print("GALLERY_DONE",a.out,len(status),flush=True)


if __name__=="__main__":
	main()
