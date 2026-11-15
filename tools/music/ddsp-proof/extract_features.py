#!/usr/bin/env python3
"""Extract a 25-second DDSP control test from the existing isolated vocal stem.

Uses real vocal loudness and the already-existing V3 continuous F0 contour.
No new pitch inference, no source stem mutation and no MIDI.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np

def extract(path, seconds, start):
	command=[
		"ffmpeg","-hide_banner","-loglevel","error","-nostdin",
		"-ss",str(start),"-t",str(seconds),"-i",str(path),
		"-ac","1","-ar","16000","-f","f32le","pipe:1",
	]
	p=subprocess.run(command,check=True,capture_output=True)
	audio=np.frombuffer(p.stdout,dtype="<f4").copy()
	assert len(audio)==round(seconds*16000),(len(audio),seconds)
	return audio

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument("--vocal",required=True,type=Path)
	p.add_argument("--control",required=True,type=Path)
	p.add_argument("--out",required=True,type=Path)
	p.add_argument("--start",type=float,default=150.)
	p.add_argument("--seconds",type=float,default=25.)
	a=p.parse_args()
	wav=extract(a.vocal,a.seconds,a.start)
	frames=round(a.seconds*250)
	time=np.arange(frames,dtype=np.float64)/250.
	# Match Magenta JS SPICE loudness: centered RMS on 1024-sample frames
	# with 64-sample hops; convert amplitude to -120 dB..0 dB with 20.7 dB offset.
	window=1024
	hop=64
	pad=np.pad(wav,(window//2,window//2))
	starts=np.arange(frames,dtype=int)*hop
	view=np.stack([pad[i:i+window] for i in starts])
	rms=np.sqrt(np.mean(view**2,axis=1))
	power=np.maximum(-120.,20*np.log10(np.maximum(1e-20,rms))-20.7)
	with np.load(a.control) as source:
		c=source["time"].astype(np.float64)
		f0=source["f0"].astype(np.float64)
		active=source["active"].astype(np.float64)
		assert len(c)==len(f0)
		freq=np.interp(time+a.start,c,f0).astype(np.float32)
		valid=np.interp(time+a.start,c,active)
	freq=np.clip(freq,0,1500)
	# Preserve naturally unvoiced/consonant audio with noise conditioning.
	freq[valid<.42]=0
	# This source's voiced state is a rough energy flag, not calibrated confidence.
	# Keep confidence separate so future engines can improve it independently.
	data=dict(
		schema="bitstream-ddsp-offline-conditions-v1",
		song="Pope Leo Wants the AI Root Password",
		excerptStart=a.start,seconds=a.seconds,
		sampleRate=16000,frameRate=250,
		pitchSource="V3 stabilized continuous f0 (no MIDI), with energy gate",
		loudnessSource="source vocal centered RMS, 1024 window/64 hop; -20.7dB reference",
		f0_hz=np.round(freq,3).tolist(),
		loudness_db=np.round(power.astype(np.float32),3).tolist(),
		energy_active=np.round(valid.astype(np.float32),3).tolist(),
	)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(data,separators=(",",":"))+"\n")
	print(json.dumps({
		"path":str(a.out),"samples":len(wav),"featureFrames":frames,
		"sourceRms":float(np.sqrt(np.mean(wav**2))),
		"activeFraction":round(float(np.mean(freq>0)),3),
		"freqQuantilesVoiced":np.percentile(freq[freq>0],[10,50,90]).tolist(),
		"loudnessQuantiles":np.percentile(power,[10,50,90]).tolist(),
	},indent=2))

if __name__=="__main__":
	main()
