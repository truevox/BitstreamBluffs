#!/usr/bin/env python3
"""Private first-pass ELEVEN distinct, actual sampled airborne drum kits.

Detect low/mid/high drum hit impulses in each separated drums stem,
re-perform them with FluidR3 GM **drum-bank samples**, themed individual kit
mappings and airy overlays. This is not an effects-only re-EQ of the stem.
The original drum audio remains separately available and unchanged.

WARNING: beat transcription is a source-estimation prototype; QA by ear.
"""
import argparse
import ctypes as ct
import json
import math
from pathlib import Path

import numpy as np
from sf2_melody_v2 import RATE, Synth
from audio_first_render import read_segment, ogg, echo, detune_color, flutter, shape_fft

FRAME=1024
HOP=256
SCAN_RATE=11025
# All patches and percussion note numbers are 0-index GM; choose actual
# bank-128 SF2 drum samples, not harmonic instruments pretending to be drums.
KITS={
	'debumont':('Powder Shaker',0,{'kick':36,'snare':38,'hat':70,'accent':81},.24,.18),
	'garbage-dump-glacier':('Scrapstorm',25,{'kick':35,'snare':40,'hat':54,'accent':56},.11,.32),
	'pyramid-peak':('Sandwake',48,{'kick':36,'snare':65,'hat':69,'accent':80},.35,.24),
	'underwater-mountain':('Bubblewake',8,{'kick':35,'snare':41,'hat':80,'accent':78},.29,.42),
	'crystal-cavern':('Prism Dust',0,{'kick':36,'snare':37,'hat':81,'accent':80},.34,.48),
	'space-mountain':('Vacuum Clicks',25,{'kick':36,'snare':39,'hat':42,'accent':77},.25,.31),
	'candy-cane-canyon':('Sugar Snap',25,{'kick':36,'snare':40,'hat':76,'accent':77},.12,.24),
	'sky-jellyfish-mountain':('Cloudmist',8,{'kick':35,'snare':60,'hat':69,'accent':80},.38,.48),
	'steampunk-slopes':('Pneumatic Skitter',16,{'kick':36,'snare':38,'hat':65,'accent':67},.20,.32),
	'micro-mountain':('Thimble Rain',0,{'kick':35,'snare':75,'hat':76,'accent':77},.15,.17),
	'vertigo-vents':('Ventwhisper',32,{'kick':35,'snare':38,'hat':57,'accent':55},.42,.35),
}

def read_mono(source,start):
	import subprocess
	p=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-ss',str(start),'-i',str(source),'-t','32',
		'-ac','1','-ar',str(SCAN_RATE),'-f','f32le','pipe:1'],capture_output=True,check=True)
	data=np.frombuffer(p.stdout,dtype='<f4').copy()
	return data

def extract_hits(file,start):
	"""Detect fast source transient rises; categorize by low/mid/high spectral energy."""
	samples=read_mono(file,start)
	samples=np.pad(samples,(FRAME//2,FRAME))
	count=(len(samples)-FRAME)//HOP
	flux=np.zeros(count,dtype=np.float32)
	rms=np.zeros(count,dtype=np.float32)
	bands=np.zeros((count,3),dtype=np.float32)
	hanning=np.hanning(FRAME).astype(np.float32)
	freq=np.fft.rfftfreq(FRAME,1/SCAN_RATE)
	slices=[(freq>=45)&(freq<170),(freq>=170)&(freq<2400),(freq>=2400)&(freq<5300)]
	last=np.zeros(FRAME//2+1,dtype=np.float32)
	for i in range(count):
		x=samples[i*HOP:i*HOP+FRAME]*hanning
		spec=np.abs(np.fft.rfft(x)).astype(np.float32)
		rms[i]=float(np.sqrt(np.mean(x*x)))
		diff=np.maximum(0,spec-last)
		flux[i]=np.sum(diff)/max(1e-5,float(np.sum(spec))+.06)
		for k,mask in enumerate(slices):
			bands[i,k]=float(np.sum(diff[mask]))
		last=spec
	# Time-invariant fractional flux can be noisy at silence; gate by
	# original drum source rms and source flux distribution.
	median=float(np.median(rms))
	peak=float(np.percentile(rms,90))
	gate=max(.0027,median*.55,peak*.045)
	threshold=max(.10,float(np.percentile(flux[rms>gate],45)) if np.any(rms>gate) else .12)
	# Onset peak separated by 65ms; retain better of overlapping candidates.
	candidates=[]
	for i in range(2,count-2):
		if rms[i]<gate or flux[i]<threshold:continue
		if flux[i]<flux[i-1] or flux[i]<=flux[i+1]:continue
		# Source onset class by relative attack-band power.
		power=bands[i]
		norm=power/max(1e-6,float(power.sum()))
		low=float(norm[0]);middle=float(norm[1]);high=float(norm[2])
		if low>.27 or (low>.13 and middle<.57):
			family='kick'
		elif high>.44 and low<.12:
			family='hat'
		else:
			family='snare'
		t=float(i*HOP/SCAN_RATE)
		candidates.append((t,float(flux[i]*rms[i]),family,low,middle,high))
	events=[]
	for t,strength,group,low,mid,high in candidates:
		if events and t-events[-1]['t']<.065:
			if strength>events[-1]['strength']:
				events[-1]={'t':round(t,4),'strength':strength,'type':group}
		else:
			events.append({'t':round(t,4),'strength':strength,'type':group})
	for e in events:
		e['velocity']=round(float(np.clip(62+26*np.log1p(e['strength']*38),53,115)))
		del e['strength']
	return {'events':events,'gate':gate,'threshold':threshold,'rms':float(np.sqrt(np.mean(samples*samples)))}

def render_percussion(events,bank,patch,notes):
	synth=Synth(0)
	# SF2 percussion bank (not melodic channel); SFID is first SoundFont id.
	p=ct.c_void_p;i=ct.c_int
	select=synth.lib.fluid_synth_program_select
	select.restype=i
	select.argtypes=[p,i,i,i,i]
	res=select(synth.ptr,9,1,128,patch)
	if res!=0:raise RuntimeError(f'GM percussion patch {patch} unavailable, code {res}')
	frames=RATE*32
	y=np.zeros(frames,dtype=np.float32)
	actions=[]
	for idx,event in enumerate(events):
		note=notes[event['type']]
		if idx%9==8:note=notes['accent']
		vel=int(event['velocity'])
		at=int(round(event['t']*RATE))
		if at>=frames:continue
		actions.append((at,1,note,vel))
		actions.append((min(frames-1,at+int(.09*RATE)),0,note,vel))
	actions.sort(key=lambda z:(z[0],z[1]))
	atEvent=0
	try:
		for offset in range(0,frames,480):
			while atEvent<len(actions) and actions[atEvent][0]<=offset:
				_,on,note,vel=actions[atEvent]
				if on:synth.note_on(synth.ptr,9,note,vel)
				else:synth.note_off(synth.ptr,9,note)
				atEvent+=1
			part=min(480,frames-offset)
			y[offset:offset+part]=synth.render(part)
	finally:
		synth.close()
	return np.stack((y,y),axis=1)

def airborne_polish(source,raw,biome,wet,spread):
	# Drum samples are DISTINCT new performances. The airy shimmer is
	# supplementary, not the sole mechanism of changing the sound.
	hp=shape_fft(raw,130 if biome!='underwater-mountain' else 75,
		6500 if biome=='underwater-mountain' else 11300,
		[(3500,3.0,1.1)])
	trails=echo(hp,.09+spread*.35,feedback=min(.36,.17+wet*.28),stereo_delta=.009)
	result=.68*hp+.42*trails
	if biome in ('sky-jellyfish-mountain','crystal-cavern','space-mountain'):
		result=detune_color(result,.014,.07+wet*.13)
	if biome in ('garbage-dump-glacier','steampunk-slopes'):
		result=flutter(result,.14,rate=11.7)
	# Quietly keep original source transient density to retain recognizable
	# rhythm during a hard A/B switch, while 90%+ of audible source comes
	# from fresh GM percussion samples.
	mixed=.93*result+.07*source
	target=float(np.sqrt(np.mean(source.astype(np.float64)**2)))
	actual=float(np.sqrt(np.mean(mixed.astype(np.float64)**2)))
	mixed*=min(3.,target/max(actual,1e-8))
	peak=float(np.max(np.abs(mixed)))
	if peak>.89:mixed*=.89/peak
	return mixed.astype(np.float32)

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--source',type=Path,required=True)
	p.add_argument('--start',type=float,required=True)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	assert not a.out.exists(),'Do not overwrite prior audio: '+str(a.out)
	a.out.mkdir(parents=True)
	original=read_segment(a.source,a.start)
	onsets=extract_hits(a.source,a.start)
	# The file argument is a 32-second excerpt; pass the clipped original
	# source segment as a scratch FLAC to ensure the same local song time.
	events=onsets['events']
	report={'source':str(a.source),'startSeconds':a.start,'hitCount':len(events),
		'hitBreakdown':{group:sum(e['type']==group for e in events) for group in ('kick','snare','hat')},
		'method':'Original separated percussion onset extraction, re-performed by GM SoundFont drum bank and biome-specific note maps',
		'versions':{}}
	for biome,(label,patch,mapping,wet,spread) in KITS.items():
		output=render_percussion(events,128,patch,mapping)
		output=airborne_polish(original,output,biome,wet,spread)
		ogg(a.out/(biome+'.ogg'),output)
		report['versions'][biome]={'label':label,'gmDrumPatch':patch,'noteMap':mapping,
			'peak':round(float(np.max(np.abs(output))),4),
			'rms':round(float(np.sqrt(np.mean(output*output))),5)}
		print('SAMPLED_AIR_KIT',biome,label,'hits',len(events),
			'rms',report['versions'][biome]['rms'],flush=True)
	(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
	print('ELEVEN_AIR_KITS_READY',a.out,len(list(a.out.glob('*.ogg'))),flush=True)

if __name__=='__main__':
	main()
