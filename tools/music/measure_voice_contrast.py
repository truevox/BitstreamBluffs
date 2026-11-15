#!/usr/bin/env python3
"""Objective-but-limited contrast check of two mountain-voice audition batches.

Measures average log spectral-shape correlation across instruments, plus
note-onset rise (post minus pre RMS, normalized to total RMS). Neither
metric replaces actual listening. Uses only NumPy and Python stdlib.
"""
import argparse
import json
import wave
from pathlib import Path

import numpy as np

RATE=48000

def mono(path,start=0,seconds=25):
	with wave.open(str(path),"rb") as w:
		if w.getframerate()!=RATE or w.getnchannels()!=1 or w.getsampwidth()!=2:
			raise ValueError("Expected 48 kHz mono 16-bit WAV: "+str(path))
		w.setpos(round(start*RATE))
		return np.frombuffer(w.readframes(round(seconds*RATE)),dtype="<i2").astype(np.float32)/32768

def spectral_profile(a):
	size=4096
	freq=np.fft.rfftfreq(size,1/RATE)
	w=np.hanning(size)
	x=np.lib.stride_tricks.sliding_window_view(a,size)[::2048]
	magnitude=np.abs(np.fft.rfft(x*w,axis=1)).mean(axis=0)
	edges=np.geomspace(140,18000,32)
	bands=[float(magnitude[(freq>=lo)&(freq<hi)].mean()) if np.any((freq>=lo)&(freq<hi))
		else 0. for lo,hi in zip(edges[:-1],edges[1:])]
	return np.log1p(np.asarray(bands))

def attack_rise(audio,notes,start):
	rms=float(np.sqrt(np.mean(audio*audio)))
	vals=[]
	for note in notes:
		at=round((note["start"]-start)*RATE)
		if at<1440 or at+2880>=len(audio):continue
		before=float(np.sqrt(np.mean(audio[at-1440:at]**2)))
		after=float(np.sqrt(np.mean(audio[at:at+2880]**2)))
		vals.append((after-before)/max(.01,rms))
	return float(np.median(vals)) if vals else None

def main():
	p=argparse.ArgumentParser()
	p.add_argument("--v1",type=Path,required=True)
	p.add_argument("--v2",type=Path,required=True)
	p.add_argument("--notes",type=Path,required=True)
	p.add_argument("--start",type=float,default=150)
	p.add_argument("--seconds",type=float,default=25)
	a=p.parse_args()
	gallery=json.loads((a.v2/"gallery.json").read_text())
	allnotes=json.loads(a.notes.read_text())["notes"]
	notes=[n for n in allnotes if a.start<n["start"]<a.start+a.seconds]
	features={};attacks={}
	for version in ("v1","v2"):
		v=[];a_metrics={}
		for voice in gallery["voices"]:
			name=voice["id"]
			file=a.v1/(name+".wav") if version=="v1" else a.v2/(name+"-excerpt.wav")
			data=mono(file,a.start if version=="v1" else 0,a.seconds)
			v.append(spectral_profile(data))
			a_metrics[name]=attack_rise(data,notes,a.start)
		corr=np.corrcoef(v)
		values=corr[np.triu_indices(len(v),1)]
		features[version]={"medianPairCorrelation":round(float(np.median(values)),3),
			"p90PairCorrelation":round(float(np.percentile(values,90)),3)}
		attacks[version]=a_metrics
	print(json.dumps({"qualityEvidence":"Numerical contrast only; human listening still required",
		"voiceCount":len(gallery["voices"]), "excerptSeconds":a.seconds,
		"attacksMeasured":len(notes),"spectralContrast":features,
		"onsetRise":{name:{version:round(attacks[version][name],3)
			for version in ("v1","v2")}
			for name in ("crystal-cavern","steampunk-slopes","micro-mountain","pyramid-peak")},
	},indent=2))

if __name__=="__main__":
	main()
