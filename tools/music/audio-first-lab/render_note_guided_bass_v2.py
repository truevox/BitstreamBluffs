#!/usr/bin/env python3
"""PRIVATE A/B bass-v2. Note-guided SoundFont timbres using experimental
low-F0 estimates from SOURCE BASS alone; outputs can fail if bass is polyphonic.
No original source is overwritten. Fidelity must be judged by user.
"""
import sys,json,numpy as np
from pathlib import Path
from sf2_melody_v2 import Synth,RATE
from audio_first_render import render as colorize, read_segment, ogg
OUT=Path('/root/bitstream-maxi/private-bass-sf2-audition-v2')
SRC=Path('/root/bitstream-maxi/private-four-family-ab-20261116')
# 0-based GM patch IDs. Some true low instruments, some unconventional
# octave-lifted sampled instruments; always blend source bass for weight.
PATCHES={
	'debumont':(39,0,'rounded console synth bass'),
	'garbage-dump-glacier':(38,0,'fractured saw-bass'),
	'pyramid-peak':(58,12,'tuba/low brass'),
	'underwater-mountain':(35,0,'fretless electric bass'),
	'crystal-cavern':(98,12,'subglass/sample crystal'),
	'space-mountain':(39,0,'orbiting synth bass'),
	'candy-cane-canyon':(80,12,'rubbery square-bass lead'),
	'sky-jellyfish-mountain':(52,12,'low aah choir'),
	'steampunk-slopes':(82,12,'steam calliope reed bass'),
	'micro-mountain':(80,12,'toy pulse bass'),
	'vertigo-vents':(19,12,'church organ pedal'),
}
def make_mono(events,program,shift):
	synth=Synth(program)
	n=32*RATE
	pcm=np.zeros(n,dtype=np.float32)
	actions=[]
	for note in events:
		a=int(round(note['start']*RATE))
		b=int(round(note['end']*RATE))
		midi=int(np.clip(note['midi']+shift,26,98))
		if b-a<.065*RATE:continue
		actions.append((a,1,midi))
		actions.append((b,0,midi))
	actions.sort()
	index=0
	for begin in range(0,n,480):
		while index<len(actions) and actions[index][0]<=begin:
			_,on,midi=actions[index]
			if on:synth.note_on(synth.ptr,0,midi,96)
			else:synth.note_off(synth.ptr,0,midi)
			index+=1
		step=min(480,n-begin)
		pcm[begin:begin+step]=synth.render(step)
	synth.close()
	return pcm
def render_one(slug,original,notes,biome):
	patch,shift,desc=PATCHES[biome]
	mono=make_mono(notes,patch,shift)
	# The sampled sound source has real natural attacks. Follow original bass
	# envelope, avoiding arbitrary volume normalization during rests.
	coarse=original.reshape(32*100,480,2)
	rms=np.sqrt(np.mean(coarse**2,axis=(1,2)))
	active=rms[rms>.005]
	ref=float(np.median(active)) if len(active) else .01
	envelope=np.interp(np.arange(len(mono))/480,[*range(3200)],rms).astype(np.float32)
	envelope=np.minimum(1.6,np.maximum(0.,envelope/max(ref,.001)))
	# Smooth envelope 20ms via moving average then interpolate at 10ms.
	envelope=np.maximum(.0,envelope)
	mono*=envelope
	# Contrast real instrument with exact original at matched song clock.
	rmsSource=float(np.sqrt(np.mean(original**2)))
	rmsSynth=float(np.sqrt(np.mean(mono**2)))
	normalized=mono*min(5.,rmsSource/max(rmsSynth,.00001))
	stereo=np.stack([normalized,normalized],axis=1)
	# Subtle per-biome coloring, unlike v1 which left >98% original.
	stereo=colorize(stereo,'bass',biome)
	combined=stereo*.88+original*.12
	power=float(np.sqrt(np.mean(combined**2)))
	if power>1e-6:combined*=min(2.,rmsSource/max(power,.00001))
	peak=float(np.max(np.abs(combined)))
	if peak>.9:combined*=.9/peak
	return combined.astype(np.float32),{'patch':patch,'shift':shift,'description':desc,
									'notes':len(notes),'sourceRMS':round(rmsSource,4),
									'synthRMS':round(rmsSynth,4),'resultRMS':round(float(np.sqrt(np.mean(combined**2))),4)}
def main():
	assert not OUT.exists(),str(OUT)
	OUT.mkdir()
	report={}
	for slug in ('pope','one-more-run'):
		folder=OUT/slug;folder.mkdir()
		notes=json.loads(Path('/root/bitstream-maxi/'+slug+'-bass-extracted-notes-v1.json').read_text())['notes']
		srcFile=SRC/slug/'original/bass.ogg'
		original=read_segment(srcFile,0)
		report[slug]={}
		for name in PATCHES:
			arr,stats=render_one(slug,original,notes,name)
			ogg(folder/(name+'.ogg'),arr)
			report[slug][name]=stats
			print('SOUNDFONT_BASS_V2',slug,name,stats,flush=True)
	(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
	print('SOUNDFONT_BASS_V2_READY',len(list(OUT.rglob('*.ogg'))),flush=True)
if __name__=='__main__':main()
