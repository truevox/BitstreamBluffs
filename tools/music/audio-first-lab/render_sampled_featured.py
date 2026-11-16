#!/usr/bin/env python3
"""Actual sampled SF2 re-performance of piano/other source harmonies.

Runs on the 32-second experimental separated-stem polyphonic note estimates,
producing ELEVEN new instrument renditions for the ONE featured family
selected for that SONG. Original and previously rendered DSP stay untouched.
This is not merely a frequency or distortion effect. Notes/chords estimated
by source separation + nonneural spectral methods are EAR-TEST CANDIDATES.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from sf2_melody_v2 import Synth,RATE
from audio_first_render import read_segment,ogg,echo,detune_color

# 0-index GM 1..128 palette. Chosen to be SONICALLY distinguishable and to
# contrast with the existing approved melody instrument for each biome.
# Two distinct sources receive entirely different series of instruments.
PIANO_PATCHES={
	'debumont':('Frosted Rhodes',4,0),
	'garbage-dump-glacier':('Prepared Wreck',6,0),
	'pyramid-peak':('Desert Dulcimer',15,0),
	'underwater-mountain':('Submerged Wurli',5,0),
	'crystal-cavern':('HoloPad',88,0),
	'space-mountain':('Stellar Keys',2,0),
	'candy-cane-canyon':('Fizzy Wurli',4,12),
	'sky-jellyfish-mountain':('Feather Felt',0,0),
	'steampunk-slopes':('Clockwork Upright',6,0),
	'micro-mountain':('Matchstick Piano',1,12),
	'vertigo-vents':('Black Grand',0,-12),
}
OTHER_PATCHES={
	'debumont':('Snowstrings',48,0),
	'garbage-dump-glacier':('Data Compost',81,0),
	'pyramid-peak':('Sarcophagus Strings',48,0),
	'underwater-mountain':('Sonar Pad',89,0),
	'crystal-cavern':('Spectral Threads',92,0),
	'space-mountain':('Radio Nebula',91,0),
	'candy-cane-canyon':('Gumdrop Sequencer',80,0),
	'sky-jellyfish-mountain':('Skyloom Strings',50,0),
	'steampunk-slopes':('Boiler Strings',21,0),
	'micro-mountain':('Handheld Wave',80,12),
	'vertigo-vents':('Ash Cloud',50,-12),
}

def synthesize(events,program,shift):
	synth=Synth(program)
	frames=32*RATE
	result=np.zeros(frames,dtype=np.float32)
	actions=[]
	for row in events:
		midi=int(row['midi']+shift)
		if midi<29 or midi>102:continue
		a=int(round(max(0,float(row['start']))*RATE))
		b=int(round(min(32,float(row['end']))*RATE))
		if b-a<.105*RATE or float(row.get('confidence',1))<.178:continue
		actions.extend([(a,1,midi),(max(a+1,min(frames-1,b)),0,midi)])
	actions.sort(key=lambda a:(a[0],a[1]))
	i=0
	try:
		for frame in range(0,frames,480):
			while i<len(actions) and actions[i][0]<=frame:
				_,on,note=actions[i]
				if on:synth.note_on(synth.ptr,0,note,96)
				else:synth.note_off(synth.ptr,0,note)
				i+=1
			part=min(480,frames-frame)
			result[frame:frame+part]=synth.render(part)
	finally:
		synth.close()
	return np.stack([result,result],axis=1),len(actions)//2

def polish(original,sampled,role,biome):
	# A tiny source layer aids familiar rhythm in difficult chordal stems
	# without masking the clearly different sampled timbre.
	if biome in ('space-mountain','sky-jellyfish-mountain','crystal-cavern'):
		sampled=detune_color(sampled,.012,.1)
		sampled=echo(sampled,.22,feedback=.15)
	elif biome in ('candy-cane-canyon','micro-mountain','steampunk-slopes'):
		sampled=echo(sampled,.066,feedback=.10)
	elif biome in ('underwater-mountain','vertigo-vents'):
		sampled=echo(sampled,.16,feedback=.12)
	sourceRMS=float(np.sqrt(np.mean(original.astype(np.float64)**2)))
	rms=float(np.sqrt(np.mean(sampled.astype(np.float64)**2)))
	if rms<1e-7:raise RuntimeError('Rendered a silent sampled instrument for '+biome)
	sampled*=min(3.6,sourceRMS/rms)
	mixed=.94*sampled+.06*original
	volume=float(np.sqrt(np.mean(mixed.astype(np.float64)**2)))
	if volume>1e-8:mixed*=min(2.5,sourceRMS/volume)
	peak=float(np.max(np.abs(mixed)))
	if peak>.91:mixed*=.91/peak
	return mixed.astype(np.float32)

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--source',type=Path,required=True)
	p.add_argument('--notes',type=Path,required=True)
	p.add_argument('--start',type=float,required=True)
	p.add_argument('--role',choices=['piano','other'],required=True)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	assert not a.out.exists(),'Cannot overwrite earlier drafts: '+str(a.out)
	a.out.mkdir(parents=True)
	notes=json.loads(a.notes.read_text())['events']
	original=read_segment(a.source,a.start)
	patches=PIANO_PATCHES if a.role=='piano' else OTHER_PATCHES
	report={'source':str(a.source),'noteSource':str(a.notes),
		'role':a.role,'startSeconds':a.start,'noteEvents':len(notes),
		'warning':'Experimental SOURCE polyphonic note estimates: pitch/chords may need correction after musical audition.',
		'instruments':{}}
	for biome,(name,patch,shift) in patches.items():
		raw,count=synthesize(notes,patch,shift)
		replacement=polish(original,raw,a.role,biome)
		ogg(a.out/(biome+'.ogg'),replacement)
		report['instruments'][biome]={'name':name,'gmProgram':patch,'octaveShift':shift,
			'noteEvents':count,'rms':round(float(np.sqrt(np.mean(replacement*replacement))),5),
			'peak':round(float(np.max(np.abs(replacement))),4)}
		print('TRUE_SAMPLED',a.role,biome,name,'events',count,
			'rms',report['instruments'][biome]['rms'],flush=True)
	(a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
	print('ELEVEN_REAL_SAMPLED_FEATURED_READY',a.role,len(list(a.out.glob('*.ogg'))),flush=True)

if __name__=='__main__':
	main()
