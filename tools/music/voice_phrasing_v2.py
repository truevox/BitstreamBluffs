#!/usr/bin/env python3
"""Extract vocal melody and note attacks from FLAC for articulated mountain instruments.

This is analysis only. All source masters remain read-only. 10ms frames, separate
fast envelope and onset analysis; retain continuous F0, not snapped MIDI.
"""
import argparse
import json
import subprocess
from pathlib import Path
import numpy as np

SAMPLE_RATE = 16000
HOP = 160
WIN = 512

def read_vocal(input_file):
	command=["ffmpeg","-hide_banner","-loglevel","error","-nostdin",
		"-i",str(input_file),"-vn","-ac","1","-ar",str(SAMPLE_RATE),
		"-f","f32le","pipe:1"]
	p=subprocess.run(command,check=True,capture_output=True)
	return np.frombuffer(p.stdout,dtype="<f4").copy()

def medfilt(x,k=5):
	r=k//2
	p=np.pad(x,(r,r),mode="edge")
	return np.median(np.stack([p[i:i+len(x)] for i in range(k)]),axis=0)

def detect_notes(x,previous_cache=None):
	import torch
	import torchaudio.functional as T
	frames=int(np.ceil(len(x)/HOP))
	fcount=min(frames,200000)
	# NCCF median window of 50ms; pitch resolution refined with existing 128ms
	# autocorrelation estimate only when it agrees with the new NCCF candidate.
	nccf=T.detect_pitch_frequency(torch.from_numpy(x).unsqueeze(0),
		SAMPLE_RATE,frame_time=.01,win_length=5,freq_low=140,freq_high=1000)[0].numpy()
	clock=np.arange(frames,dtype=np.float32)*.01
	torch_freq=np.interp(clock,np.arange(len(nccf))*.01,nccf).astype(np.float32)
	torch_freq=medfilt(torch_freq,5)
	# Unlike original 128ms windows, fast 32ms windows preserve note onset.
	xpad=np.pad(x,(WIN//2,WIN//2),mode="constant")
	start=np.arange(frames)*HOP
	fr=np.stack([xpad[s:s+WIN] for s in start])
	if fr.shape[1]!=WIN:raise AssertionError(fr.shape)
	rms=np.sqrt(np.mean(fr*fr,axis=1)).astype(np.float32)
	hann=np.hanning(WIN).astype(np.float32)
	mag=np.abs(np.fft.rfft(fr*hann,axis=1))
	mag=np.log1p(mag*35)
	flux=np.zeros(frames,dtype=np.float32)
	flux[1:]=np.maximum(0,mag[1:]-mag[:-1]).mean(axis=1)
	# Base pitch tracks exactly one 10ms grid, but an existing cached high-res F0
	# can be used to refine bends/vibrato where its octave estimate is credible.
	freq=torch_freq.copy()
	if previous_cache:
		with np.load(previous_cache) as old:
			oldtime=old["time"]
			high=np.interp(clock,oldtime,old["f0"],left=0,right=0)
			conf=np.interp(clock,oldtime,old["confidence"],left=0,right=0)
		match=(high>140)&(conf>.62)&(np.abs(12*np.log2(np.maximum(1,high)/np.maximum(1,freq)))<1.5)
		freq[match]=.83*high[match]+.17*freq[match]
	# Smooth only small high-frequency jumps (<20ms), preserving pitch contours.
	freq=medfilt(freq,3)
	loud=np.percentile(rms,90)
	noise=np.percentile(rms,14)
	gate_level=max(.012,loud*.08,noise*2.5)
	active=rms>gate_level
	# Short energy holes are consonants, not new notes.
	for i in range(1,frames-4):
		if active[i-1] and not active[i]:
			for width in range(1,5):
				if i+width<frames and active[i+width]:
					active[i:i+width]=True
					break
	env=np.clip(rms/max(.03,loud),0,1.5)**.58
	# F0 is never computed as "volume"; unvoiced syllable starts still
	# inform attacks while pitch tracks the nearest audible voiced frames.
	flux_floor=np.quantile(flux,.70)
	events=[]
	last=-100
	last_pitch=float(freq[0])
	for i in range(2,frames-5):
		if not active[i] or i-last<7:continue
		level_rise=env[i]-env[i-3]
		spectral_peak=flux[i]>=flux[i-2:i+3].max()
		spectral_hit=(flux[i]>flux_floor*1.42 and spectral_peak and
			level_rise>.07 and env[i]>.24)
		start_after_gap=(not np.any(active[max(0,i-4):i]) and
			np.sum(active[i:i+3])>=2)
		old_med=np.median(freq[max(0,i-7):i-2])
		new_med=np.median(freq[i+1:i+5])
		step=abs(12*np.log2(max(1,new_med)/max(1,old_med)))
		stepped=(step>1.55 and
			np.std(freq[i+1:i+5])<max(8,new_med*.07) and
			abs(12*np.log2(max(1,float(freq[i]))/max(1,new_med)))<.9)
		energy_burst=(level_rise>.28 and env[i]>.35)
		if start_after_gap or spectral_hit or stepped or energy_burst:
			# shift onset just before spectrogram peak to capture original
			# consonant/plosive attack without 128ms analysis latency.
			when=max(0,i-1 if spectral_hit else i)
			if when-last<7:continue
			events.append(when)
			last=when
			last_pitch=float(freq[i])
	# First audible note in a continuous phrase.
	if np.any(active):
		first=int(np.flatnonzero(active)[0])
		if not events or events[0]-first>7:events.insert(0,first)
	events=sorted(set(events))
	notes=[]
	for j,frame in enumerate(events):
		if frame<0:continue
		start=frame*.01
		stop=(events[j+1] if j+1<len(events) else frames)*.01
		if stop-start<.055:continue
		pitch=float(np.median(freq[min(frame+2,frames-1):min(frame+8,frames)]))
		notes.append(dict(start=round(start,4),end=round(stop,4),
			frequency=round(pitch,3),midi=round(69+12*np.log2(max(1,pitch)/440)),
			velocity=int(np.clip(40+60*env[frame:frame+9].max(),40,120))))
	# Normalize the onset accents independently of the source's smooth voice env.
	attack=np.zeros(frames,dtype=np.float32)
	attack[[min(frames-1,round(n["start"]*100)) for n in notes]]=1.0
	print("ANALYSIS",json.dumps({"frames":frames,"voiced_fraction":round(float(active.mean()),3),
		"notes":len(notes),"median_f0":round(float(np.median(freq[active])),2),
		"median_pitch_changes":round(float(np.median(np.abs(np.diff(freq)))),2),
		"first_10":notes[:10]},default=float))
	return dict(time=clock,f0=freq,rms=rms,env=env,
		active=active.astype(np.uint8),attack=attack,flux=flux,
		notes=notes,duration=len(x)/SAMPLE_RATE)

def main():
	p=argparse.ArgumentParser()
	p.add_argument("--vocal",type=Path,required=True)
	p.add_argument("--old-analysis",type=Path,default=None)
	p.add_argument("--out",type=Path,required=True)
	a=p.parse_args()
	data=detect_notes(read_vocal(a.vocal),a.old_analysis)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	np.savez_compressed(a.out,time=data["time"],f0=data["f0"],rms=data["rms"],
		env=data["env"],active=data["active"],attack=data["attack"],
		flux=data["flux"],duration=data["duration"])
	(a.out.with_suffix(".notes.json")).write_text(json.dumps({
		"format":"bitstream-vocal-events-v2","notes":data["notes"],"duration":data["duration"],
		"noteDetection":"spectral-onset, fast envelope, pitch-step, all 10ms unquantized",
	},indent=2)+"\n")
	print("WROTE",a.out,"with",len(data["notes"]),"attacks")

if __name__=="__main__":
	main()
