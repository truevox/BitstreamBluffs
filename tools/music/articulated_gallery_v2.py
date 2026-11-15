#!/usr/bin/env python3
"""Articulated V2 voice audition: genuine SF2 sample attacks + distinct DSP.

Inputs remain read-only. Work in separate V2 derivative gallery. We preserve
the entire prior V1 gallery for immediate A/B comparison.
"""
import argparse
import json
import math
import subprocess
import wave
from pathlib import Path

import numpy as np

from sf2_melody_v2 import render as sf2_render

RATE=48000
PROGRAMS={
	"debumont":22,              # harmonica / old console reed
	"pyramid-peak":61,          # brass section
	"crystal-cavern":9,        # glockenspiel mallet
	"candy-cane-canyon":81,    # saw lead
	"sky-jellyfish-mountain":52,# choir aahs
	"steampunk-slopes":82,     # actual SF2 calliope lead
	"micro-mountain":10,       # music box
	"vertigo-vents":19,        # pipe/church organ
}
DESCRIPTIONS={
	"bitstream-bluffs":("BITSTREAM","Arcade speech-chip staccato","Hard-edged arcade blips and bitcrushed articulation"),
	"debumont":("DEBUMONT","SNES harmonica/reed","Bright reedy retro-console tone with clear tongue attacks"),
	"garbage-dump-glacier":("GARBAGE","Corrupt speech circuit","Broken data and crisp 8-bit percussion accents"),
	"pyramid-peak":("PYRAMID","Stabbed brass section","Punchy cinematic brass instead of a nasal oscillator"),
	"underwater-mountain":("UNDERWATER","Singing hydrophone","Liquid melody plus distinctive bubbling note attacks"),
	"crystal-cavern":("CRYSTAL","Struck glockenspiel + crystal resonator","Hard mallet strikes with long shimmering independent tails"),
	"space-mountain":("SPACE","Gliding analogue theremin","Expressive sci-fi bends and discrete articulation"),
	"candy-cane-canyon":("CANDY","Bright chiptune supersaw","Fast snapped leads and sparkling candy transients"),
	"sky-jellyfish-mountain":("JELLYFISH","Airy sampled choir","Soft floating vowels with distinct syllable onsets"),
	"steampunk-slopes":("STEAMPUNK","Steam calliope with pipe chiff","Real sampled fairground calliope with mechanical steam attacks"),
	"micro-mountain":("MICRO","Miniature struck music box","Short chime attacks with tiny ringing overtones"),
	"vertigo-vents":("VERTIGO","Volcanic church organ","Huge pipe-organ attacks and distorted sub-octaves"),
}

def openwav(path):
	with wave.open(str(path),"rb") as w:
		assert w.getsampwidth()==2 and w.getframerate()==RATE
		count=w.getnframes()
		num_channels=w.getnchannels()
		raw=w.readframes(count)
	pcm=np.frombuffer(raw,dtype="<i2").astype(np.float32)/32768
	if num_channels>1:
		pcm=pcm.reshape(-1,num_channels).mean(axis=1)
	return pcm

def savewav(path,audio):
	path.parent.mkdir(parents=True,exist_ok=True)
	with wave.open(str(path),"wb") as w:
		w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE)
		w.writeframes((np.clip(audio,-.99,.99)*32767).astype("<i2").tobytes())

def attack_layer(name,notes,start,frames):
	"""A short, timbre-specific per-note strike. Not a volume envelope."""
	impacts=np.zeros(frames,dtype=np.float32)
	rng=np.random.default_rng(7323+list(DESCRIPTIONS).index(name))
	for n in notes:
		pos=round((n["start"]-start)*RATE)
		if pos<0 or pos>=frames:continue
		f0=float(n["frequency"])
		# 25-80ms attack sound, independent of note duration.
		attackdur={
			"steampunk-slopes":.09,"crystal-cavern":.07,"micro-mountain":.055,
			"space-mountain":.035,"underwater-mountain":.11,
		}.get(name,.04)
		count=min(frames-pos,round(RATE*attackdur))
		t=np.arange(count,dtype=np.float32)/RATE
		decay=np.exp(-t/max(.004,attackdur*.22))
		noise=rng.standard_normal(count).astype(np.float32)
		if name=="steampunk-slopes":
			# Pipe wind 'chiff', timed valve clack, gear rattle.
			pulse=.32*noise+.24*np.sin(2*np.pi*min(1200,f0*2.2)*t)
			pulse+=.24*np.sin(2*np.pi*160*t)*np.exp(-t/.012)
		elif name=="crystal-cavern":
			# Crisp mallet strike; long glass mode is added separately.
			pulse=.4*noise+.38*np.sin(2*np.pi*min(5500,f0*7.2)*t)
		elif name=="micro-mountain":
			pulse=.5*np.sin(2*np.pi*min(6000,f0*9)*t)+.25*noise
		elif name=="garbage-dump-glacier":
			pulse=.48*np.sign(np.sin(2*np.pi*max(240,f0*2)*t))+.3*noise
		elif name=="underwater-mountain":
			pulse=.65*np.sin(2*np.pi*(800*t-600*t*t))+.18*noise
		elif name=="space-mountain":
			pulse=.65*np.sin(2*np.pi*f0*t)+.12*noise
		elif name=="sky-jellyfish-mountain":
			pulse=.18*noise+.28*np.sin(2*np.pi*f0*t)
		else:
			pulse=.38*np.sin(2*np.pi*min(3000,f0*4)*t)+.3*noise
		scale=.24 if name in ("crystal-cavern","steampunk-slopes") else .12
		impacts[pos:pos+count]+=pulse*decay*scale
	return impacts

def crystal_rings(notes,start,frames):
	"""Independent triggered note resonators, with glassy inharmonic partials."""
	out=np.zeros(frames,dtype=np.float32)
	rng=np.random.default_rng(2141)
	for note in notes:
		pos=round((note["start"]-start)*RATE)
		if pos<0 or pos>=frames:continue
		f0=float(note["frequency"])
		dur=1.25
		count=min(round(dur*RATE),frames-pos)
		t=np.arange(count,dtype=np.float32)/RATE
		# Inharmonic modes of glass/mallet, each has own release.
		ring=np.zeros(count,dtype=np.float32)
		for ratio,amp,tau in [(1,0.22,.52),(2.01,.24,.30),
			(2.89,.25,.75),(4.02,.19,1.10),(6.13,.12,.21),(7.6,.10,.18)]:
			if f0*ratio>=17000:continue
			ring+=amp*np.exp(-t/tau)*np.sin(2*np.pi*(f0*ratio)*t)
		# Mallet transient not delayed by old vocal RMS window.
		ring+=.14*rng.standard_normal(count).astype(np.float32)*np.exp(-t/.006)
		amp=.27 * max(.45,min(1.,note["velocity"]/110))
		out[pos:pos+count]+=ring*amp
	return out

def polish(name,old,sample,analysis,notes,start,seconds):
	frames=min(len(old),round(seconds*RATE))
	old=old[:frames].astype(np.float32)
	sample=sample[:frames].astype(np.float32) if sample is not None else None
	exciter=attack_layer(name,notes,start,frames)
	f0=analysis["f0"]
	env=analysis["env"]
	# Fast RMS envelope, aligned without 64ms window delay.
	at=(start+np.arange(frames,dtype=np.float32)/RATE)
	loud=np.interp(at,analysis["time"],env).astype(np.float32)
	active=np.interp(at,analysis["time"],analysis["active"]).astype(np.float32)
	fast=np.clip(loud*.82+.18,0,1.2)*np.clip(active,0,1)
	if name=="bitstream-bluffs":
		audio=old*.82*fast+exciter
	elif name=="debumont":
		audio=sample*.95+old*.14*fast+exciter*.75
	elif name=="garbage-dump-glacier":
		audio=np.round(old*22)/22 * fast*.85+exciter
	elif name=="pyramid-peak":
		audio=sample*1.05+old*.12*fast+exciter*.9
	elif name=="underwater-mountain":
		audio=old*.86*fast+exciter*.9
	elif name=="crystal-cavern":
		audio=sample*.66+crystal_rings(notes,start,frames)+exciter*.6
	elif name=="space-mountain":
		audio=old*.94*fast+exciter*.24
	elif name=="candy-cane-canyon":
		audio=np.tanh(sample*1.5)*.90+old*.12*fast+exciter*.55
	elif name=="sky-jellyfish-mountain":
		audio=sample*1.02+old*.11*fast+exciter*.65
	elif name=="steampunk-slopes":
		audio=sample*1.18+exciter
	elif name=="micro-mountain":
		audio=sample*1.18+exciter*.68
	elif name=="vertigo-vents":
		audio=np.tanh(sample*2.3)*.88+old*.14*fast+exciter*.35
	else:raise ValueError(name)
	# Optimize RMS for consistent audition levels without clipping or
	# normalizing away transient differences.
	power=float(np.sqrt(np.mean(audio*audio)))
	target=10**(-24/20)
	scale=min(4,target/max(.0005,power))
	audio=np.tanh(audio*scale*.8)/.8
	peak=float(np.max(np.abs(audio)))
	if peak>.86: audio*=.86/peak
	rms=float(np.sqrt(np.mean(audio*audio)))
	return audio.astype(np.float32),float(round(20*np.log10(max(1e-7,rms)),2)),float(round(20*np.log10(max(1e-7,np.max(np.abs(audio)))),2))

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument("--analysis",required=True,type=Path)
	p.add_argument("--notes",required=True,type=Path)
	p.add_argument("--v1",required=True,type=Path)
	p.add_argument("--out",required=True,type=Path)
	p.add_argument("--frame-count",type=int,required=True)
	p.add_argument("--start",type=float,default=150)
	p.add_argument("--seconds",type=float,default=25)
	p.add_argument("--bitrate",default="96k")
	a=p.parse_args()
	a.out.mkdir(parents=True,exist_ok=True)
	with np.load(a.analysis) as v:
		analysis={k:v[k] for k in v.files}
	notes=json.loads(a.notes.read_text())["notes"]
	notes=[n for n in notes if a.start-.01<=n["start"]<a.start+a.seconds]
	results=[]
	for name in DESCRIPTIONS:
		oldfile=a.v1/(name+".wav")
		assert oldfile.exists(),oldfile
		# Read only the excerpt, not the complete old 200MB gallery WAVs.
		with wave.open(str(oldfile),"rb") as w:
			w.setpos(round(a.start*RATE))
			old=np.frombuffer(w.readframes(round(a.seconds*RATE)),dtype="<i2").astype(np.float32)/32768
		sample=None
		if name in PROGRAMS:
			scratch=a.out/(name+"-sf2-temp.wav")
			sf2_render(a.analysis,a.notes,scratch,PROGRAMS[name],
				a.frame_count,a.start,a.seconds)
			sample=openwav(scratch)
			scratch.unlink()
		audio,rmsdb,peakdb=polish(name,old,sample,analysis,notes,a.start,a.seconds)
		wav=a.out/(name+"-excerpt.wav")
		savewav(wav,audio)
		ogg=a.out/(name+"-excerpt.ogg")
		subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
			"-i",str(wav),"-c:a","libopus","-b:a",a.bitrate,"-f","ogg",str(ogg)],check=True)
		label,instrument,description=DESCRIPTIONS[name]
		result=dict(id=name,label=label,instrument=instrument,description=description,
			file=name+"-excerpt.ogg",v1file=name+"-v1-excerpt.ogg",
			rmsDb=rmsdb,peakDb=peakdb,gainDb=0,program=PROGRAMS.get(name))
		results.append(result)
		print("V2_RENDER",json.dumps(result),flush=True)
	(a.out/"gallery.json").write_text(json.dumps({
		"format":"bitstream-voice-gallery-v1",
		"revision":2,
		"song":"Pope Leo Wants the AI Root Password",
		"subtitle":"V2 attacks vs V1 continuous oscillators",
		"excerptStartSeconds":a.start,
		"excerptSeconds":a.seconds,
		"sampleRate":RATE,
		"backing":"backing-excerpt.ogg",
		"originalVocal":"original-vocal-excerpt.ogg",
		"notes":"Timbres are provisional, V1 comparison is preserved. All live transitions remain aligned.",
		"voices":results,
	},indent=2)+"\n")
	print("V2_GALLERY_COMPLETE",a.out,len(results),flush=True)

if __name__=="__main__":
	main()
