#!/usr/bin/env python3
"""Audio-only, SHORT-EXCERPT true sampled-instrument guitar audition.

Replays estimated polyphonic *source-guitar* note events via 11 distinct
FluidR3 SoundFont patches, preserving original source recording untouched.
No pretrained models, no game engine, no whole-song approval implied.
"""
import json,sys
from pathlib import Path
import numpy as np
from sf2_melody_v2 import Synth,RATE
from audio_first_render import read_segment,ogg,render as colorize

INPUT=Path('/root/bitstream-maxi/launch33/stems/htdemucs_6s/03_WRBGQUqD54U')
NOTES=Path('/root/bitstream-maxi/launch33/hacker-guitar-notes-private.json')
DEST=Path('/root/bitstream-maxi/private-hacker-guitar-20261116')
START=4.5
SECONDS=32
PATCHES={
	'debumont':{'program':24,'octave':0,'instrument':'Hearth Nylon / picked nylon guitar'},
	'garbage-dump-glacier':{'program':30,'octave':0,'instrument':'Corroded Strings / distorted electric guitar'},
	'pyramid-peak':{'program':104,'octave':0,'instrument':'Dune Lute / sitar-like plucked string'},
	'underwater-mountain':{'program':27,'octave':0,'instrument':'Tidal E-Bow / clean guitar sustained'},
	'crystal-cavern':{'program':46,'octave':0,'instrument':'Quartz Harp / sampled orchestral harp'},
	'space-mountain':{'program':27,'octave':12,'instrument':'Star Strings / space guitar high harmonics'},
	'candy-cane-canyon':{'program':28,'octave':0,'instrument':'Bubble Funk / muted electric guitar'},
	'sky-jellyfish-mountain':{'program':31,'octave':0,'instrument':'Silken Harmonics / guitar harmonics'},
	'steampunk-slopes':{'program':105,'octave':0,'instrument':'Copper Banjo / picked banjo'},
	'micro-mountain':{'program':24,'octave':12,'instrument':'Clockwork Ukulele / raised nylon pluck'},
	'vertigo-vents':{'program':30,'octave':-12,'instrument':'Lava Feedback / lower distorted electric guitar'},
}

def render_notes(events,prog,octave):
	synth=Synth(prog)
	frames=RATE*SECONDS
	samples=np.zeros(frames,dtype=np.float32)
	actions=[]
	for event in events:
		if event['confidence']<.18:continue
		midi=int(event['midi']+octave)
		if midi<34 or midi>88:continue
		a=int(round(event['start']*RATE))
		b=int(round(event['end']*RATE))
		if b-a<.095*RATE:continue
		actions.extend([(max(0,a),1,midi),(min(frames-1,b),0,midi)])
	actions.sort(key=lambda x:(x[0],x[1]))
	i=0
	try:
		for begin in range(0,frames,480):
			while i<len(actions) and actions[i][0]<=begin:
				_,on,midi=actions[i]
				if on:synth.note_on(synth.ptr,0,midi,95)
				else:synth.note_off(synth.ptr,0,midi)
				i+=1
			n=min(480,frames-begin)
			samples[begin:begin+n]=synth.render(n)
	finally:
		synth.close()
	return samples,len(actions)//2

def render_one(audio,events,biome,cfg):
	mono,count=render_notes(events,cfg['program'],cfg['octave'])
	# Reaperform guitar as genuine distinct sampled timbre, not a filter-only
	# imitation. Blend 9% original stem for source rhythmic glue.
	native=np.stack((mono,mono),axis=1)
	rms_src=float(np.sqrt(np.mean(audio**2)))
	rms_new=float(np.sqrt(np.mean(native**2)))
	if rms_new<1e-6:raise RuntimeError('Empty sampled guitar '+biome)
	native*=min(4.,rms_src/rms_new)
	colored=colorize(native,'featured',biome)
	result=.91*colored+.09*audio
	rms_result=float(np.sqrt(np.mean(result**2)))
	if rms_result>1e-8:result*=min(2.,rms_src/rms_result)
	peak=float(np.max(np.abs(result)))
	if peak>.91:result*=.91/peak
	return result.astype(np.float32),{'patch':cfg['program'],'octave':cfg['octave'],
		'instrument':cfg['instrument'],'notes':count,
		'rms_original':round(rms_src,5),
		'rms_new':round(float(np.sqrt(np.mean(result**2))),5)}

def main():
	assert not DEST.exists(),'Refuse overwrite '+str(DEST)
	DEST.mkdir(parents=True)
	original=read_segment(INPUT/'guitar.flac',START,SECONDS)
	notes=json.loads(NOTES.read_text())['events']
	report={}
	for biome,cfg in PATCHES.items():
		out,meta=render_one(original,notes,biome,cfg)
		ogg(DEST/(biome+'.ogg'),out)
		report[biome]=meta
		print('GUItAR_SAMPLED',biome,meta,flush=True)
	(DEST/'guitar-report.json').write_text(json.dumps({
		'song':'Every Hacker (Runs Out of Code) - Part 2 of 2',
		'startSeconds':START,'seconds':SECONDS,
		'transcription':str(NOTES),'source':str(INPUT/'guitar.flac'),
		'patches':report,
		'caution':'Automatic polyphonic guitar transcription can contain wrong pitches or chord guesses; these are musical candidate samples, NOT approved production masters.',
	},indent=2)+'\n')
	print('GUITAR_11_NEW_SAMPLED_INSTRUMENTS_READY',len(list(DEST.glob('*.ogg'))),flush=True)

if __name__=='__main__':main()
