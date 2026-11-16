#!/usr/bin/env python3
"""V4 proof: source-guided continuous timbre synthesis with no note event model.

Inputs:
- source separated vocal FLAC (read-only)
- V3 frame pitch track (read-only)
Output: sample-aligned 48kHz 25s 2-instrument renderings for independent A/B.
No MIDI notes, MIDI pitch wheels, beat grid, or 70ms onset refractory.
"""
import argparse
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

RATE = 48000
INPUT_RATE = 16000

def vocal_excerpt(path, start, seconds):
	command = [
		"ffmpeg","-hide_banner","-loglevel","error","-nostdin","-ss",str(start),
		"-t",str(seconds),"-i",str(path),"-ac","1","-ar",str(INPUT_RATE),
		"-f","f32le","pipe:1",
	]
	x = subprocess.run(command, capture_output=True, check=True)
	return np.frombuffer(x.stdout,dtype="<f4").copy()

def features(audio):
	"""5ms RMS/attack envelope from 32ms overlapping FFT frames."""
	hop=80
	window=512
	frames=int(np.ceil(len(audio)/hop))
	buffer=np.pad(audio,(window//2,window//2))
	starts=np.arange(frames)*hop
	blocks=np.stack([buffer[s:s+window] for s in starts],axis=0)
	rms=np.sqrt(np.mean(blocks**2,axis=1)).astype(np.float32)
	mag=np.abs(np.fft.rfft(blocks*np.hanning(window),axis=1)).astype(np.float32)
	# Detect increases in acoustic energy from source, not pitch steps.
	band=np.log1p(25*mag)
	change=np.zeros(frames,dtype=np.float32)
	change[1:]=np.maximum(0,band[1:]-band[:-1]).mean(axis=1)
	# Local sound onset prominence; no hard 70ms refractory, but avoid
	# multiple nearly identical peaks inside the same transient.
	p25=float(np.percentile(change,25))
	p90=float(np.percentile(change,90))
	threshold=max(p90*.95,p25*2.1)
	target=np.flatnonzero((change>=threshold)&
		(change>=np.roll(change,1))&
		(change>np.roll(change,-1)))
	# Use energy at or immediately after the peak to avoid soft silence artifacts.
	target=target[rms[target]>max(.006,float(np.percentile(rms,80))*.12)]
	prominence=[]
	for candidate in target:
		start=max(0,candidate-3)
		end=min(frames,candidate+4)
		val=float(change[candidate])
		base=float(np.min(change[start:end]))
		if val-base>p90*.25:
			prominence.append(candidate)
	# Merge peaks closer than 10ms only; this is deglitching, not a note gap.
	selected=[]
	for i in prominence:
		if selected and i-selected[-1]<2:
			if change[i]>change[selected[-1]]:
				selected[-1]=i
			continue
		selected.append(i)
	return rms,change,np.asarray(selected,dtype=int)

def envelope_from_source(rms,duration,voicing):
	times=np.arange(len(rms),dtype=np.float64)*.005
	count=round(duration*RATE)
	x=(np.arange(count)/RATE).astype(np.float64)
	loud=np.interp(x,times,rms,left=0,right=0).astype(np.float32)
	gate=np.interp(x,voicing["time"],voicing["active"],left=0,right=0)
	# Smooth *audio level*, not the pitch. 5ms attack, ~20ms release.
	loud=np.clip(loud/(max(.012,float(np.percentile(rms,88)))),0,1.8)**0.64
	target=loud*np.clip(gate,0,1)
	gain=np.empty(len(target),dtype=np.float32)
	prev=0.
	attack=np.exp(-1/(RATE*.003))
	release=np.exp(-1/(RATE*.018))
	for i,v in enumerate(target):
		alpha=attack if v>prev else release
		prev=alpha*prev+(1-alpha)*float(v)
		gain[i]=prev
	return gain

def onset_exciter(indexes,seconds,variant):
	"""Separate unpitched transient lane: no note re-keying or forced F0 steps."""
	count=round(seconds*RATE)
	result=np.zeros(count,dtype=np.float32)
	random=np.random.default_rng(20261115)
	for frame in indexes:
		pos=round((frame*.005)*RATE)
		if pos<0 or pos>=count:
			continue
		duration=.032 if variant=="saw" else .025
		window=min(count-pos,round(RATE*duration))
		t=np.arange(window,dtype=np.float32)/RATE
		noise=random.standard_normal(window).astype(np.float32)
		if variant=="saw":
			sound=.36*noise+.64*np.sin(2*np.pi*(1100*t+400*t*t))
		else:
			sound=.21*noise+.79*np.sin(2*np.pi*1800*t)
		result[pos:pos+window]+=sound*np.exp(-t/.007)*(.045 if variant=="saw" else .038)
	return result

def synthesize(f0,rms,events,control,seconds,variant):
	"""Band-limited, phase-coherent additive synthesis with real source articulation."""
	out_frames=round(seconds*RATE)
	t=np.arange(out_frames,dtype=np.float64)/RATE
	source_time=control["time"].astype(np.float64)
	target_freq=np.interp(t,source_time,f0,left=float(f0[0]),right=float(f0[-1]))
	target_freq=np.clip(target_freq,70,1400)
	phase=np.cumsum(2*np.pi*target_freq/RATE,dtype=np.float64)
	env=envelope_from_source(rms,seconds,control)
	audio=np.zeros(out_frames,dtype=np.float32)
	if variant=="saw":
		# Band-limited harmonic saw, stronger high partials as Maxi attacks.
		brightness=np.clip(env*.7+.25,.12,1.12)
		for harmonic in range(1,34):
			if harmonic==1:
				weight=1.
			else:
				weight=1/harmonic
			nyquist_gate=np.clip((20000-harmonic*target_freq)/4000,0,1)
			amp=(weight*nyquist_gate*(brightness if harmonic>4 else 1.)).astype(np.float32)
			audio+=np.sin(phase*harmonic).astype(np.float32)*amp
		audio=np.tanh(audio*1.1)
	else:
		# Classic additive organ ranks, frequency ratios remain stable;
		# no sample transposition or channel-wide pitch wheel.
		ranks=[(.5,.25),(1,.75),(2,.43),(3,.18),(4,.14),(5,.07)]
		for multiplier,weight in ranks:
			audio+=(weight*np.sin(phase*multiplier)).astype(np.float32)
		audio=np.tanh(audio*1.36)
	audio*=env*.38
	audio+=onset_exciter(events,seconds,variant)
	# Output gain normalized on the same excerpt, without softening strikes.
	power=float(np.sqrt(np.mean(audio*audio)))
	if power<=1e-8: raise ValueError("Silent synthesized output")
	audio*=min(4.0,(10**(-24/20))/power)
	peak=float(np.max(np.abs(audio)))
	if peak>.91:audio*=.91/peak
	return audio

def write_wave(path,audio):
	with wave.open(str(path),"wb") as w:
		w.setnchannels(1)
		w.setsampwidth(2)
		w.setframerate(RATE)
		w.writeframes((np.clip(audio,-.99,.99)*32767).astype("<i2").tobytes())

def main():
	p=argparse.ArgumentParser()
	p.add_argument("--vocal",required=True,type=Path)
	p.add_argument("--control",required=True,type=Path)
	p.add_argument("--out",required=True,type=Path)
	p.add_argument("--start",type=float,default=150.0)
	p.add_argument("--seconds",type=float,default=25.0)
	a=p.parse_args()
	a.out.mkdir(parents=True,exist_ok=True)
	x=vocal_excerpt(a.vocal,a.start,a.seconds)
	rms,flux,onsets=features(x)
	with np.load(a.control) as saved:
		v=slice(int(round(a.start*100)),int(round((a.start+a.seconds)*100)))
		control={k:saved[k][v] for k in ("time","f0","active")}
		control["time"]=control["time"]-a.start
	f0=control["f0"].copy()
	# Use independent voice gates from vocal source energy.
	for variant,name in [("saw","candy-cane-canyon"),("organ","vertigo-vents")]:
		audio=synthesize(f0,rms,onsets,control,a.seconds,variant)
		wav=a.out/(name+"-continuous-v4.wav")
		ogg=a.out/(name+"-continuous-v4.ogg")
		write_wave(wav,audio)
		subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
			"-i",str(wav),"-c:a","libopus","-b:a","96k",str(ogg)],check=True)
		peak=float(np.max(np.abs(audio)))
		power=float(np.sqrt(np.mean(audio*audio)))
		print(json.dumps({"voice":name,"source":"continuous-v3-F0/5ms-articulation",
			"frames":len(audio),"seconds":a.seconds,"acousticOnsets":len(onsets),
			"peakDb":round(20*np.log10(peak),2),"rmsDb":round(20*np.log10(power),2),
			"file":str(ogg)}),flush=True)
	(a.out/"analysis-metadata.json").write_text(json.dumps({
		"sourceVocal":"Demucs isolated lead, unchanged","onsetIntervalMs":5,
		"pitchControl":"V3 pitch frame sequence; zero MIDI note selection",
		"attackEvents":len(onsets),"glideSource":"V3 stable f0 without note retriggering",
		"architecturalStatus":"V4 continuous challenger, NOT complete V4 detector upgrade",
	},indent=2)+"\n")

if __name__=="__main__":
	main()
