#!/usr/bin/env python3
"""Additive high-resolution sampled air-drums from independently versioned V3
multi-band onset scores. Absolutely no source/master overwrites.

Unlike old sampled kits, supports simultaneous kick/snare/hat and preserves
precise fractional-frame MIDI note-on times (48k sample-time event scheduler).
Not a claim that automatic event guesses are ear-confirmed drum notation.
"""
import argparse
import ctypes as ct
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

import numpy as np
from sf2_melody_v2 import RATE, Synth
from audio_first_render import read_segment, ogg
from render_sampled_air_drums import KITS, airborne_polish

SECONDS=32
FRAMES=RATE*SECONDS

def render_percussion_precise(events,patch,notes):
	synth=Synth(0)
	p=ct.c_void_p
	i=ct.c_int
	select=synth.lib.fluid_synth_program_select
	select.restype=i
	select.argtypes=[p,i,i,i,i]
	code=select(synth.ptr,9,1,128,patch)
	if code!=0:
		synth.close()
		raise RuntimeError(f'Unavailable FluidR3 drum patch {patch}: {code}')
	schedule=[]
	for e in events:
		midi=notes[e['type']]
		pos=round(float(e['t'])*RATE)
		if not 0<=pos<FRAMES:
			continue
		velocity=int(np.clip(e['velocity'],40,120))
		# Percussion samples remain sample-based. Avoid arbitrary every-Nth
		# accented substitutions, which had changed drum-family identity.
		schedule.append((pos,1,midi,velocity))
		stop=min(FRAMES-1,pos+int(.075*RATE))
		schedule.append((stop,0,midi,velocity))
	# Note-offs first at equal timestamp; preserves simultaneous co-hits.
	schedule.sort(key=lambda q:(q[0],q[1],q[2]))
	out=np.zeros(FRAMES,dtype='float32')
	cursor=0
	changes=0
	try:
		for frame,on,midi,velocity in schedule:
			if frame>cursor:
				out[cursor:frame]=synth.render(frame-cursor)
				cursor=frame
			if on:
				synth.note_on(synth.ptr,9,midi,velocity)
			else:
				synth.note_off(synth.ptr,9,midi)
			changes+=1
		if cursor<FRAMES:
			out[cursor:FRAMES]=synth.render(FRAMES-cursor)
	finally:
		synth.close()
	return np.stack([out,out],axis=1),changes

def normalize_to_reference(reference,new):
	rms=lambda x:float(np.sqrt(np.mean(np.square(x.astype('float64')))))
	target=rms(reference)
	current=rms(new)
	if current<1e-8:
		raise RuntimeError('Sampled V3 drum performance is unexpectedly silent')
	new=new*min(3.,target/current)
	peak=float(np.max(np.abs(new)))
	if peak>.86:
		new*=.86/peak
	return new.astype('float32')

def run(args):
	assert not args.out.exists(),f'Refusing overwrite: {args.out}'
	doc=json.loads(args.events.read_text())
	assert doc['schemaVersion']==3
	assert abs(doc['startSeconds']-args.start)<1e-4
	assert doc['lengthSeconds']==SECONDS
	event_types={'kick','snare','hat'}
	assert all(e['type'] in event_types for e in doc['events'])
	assert doc['events']==sorted(doc['events'],key=lambda e:(e['t'],e['type']))
	args.out.mkdir(parents=True)
	original=read_segment(args.source,args.start)
	report={
		'version':3,'method':'5.805ms polyphonic onset -> precise 48k sample frame sampled GM drum performance',
		'eventSource':str(args.events),'sourceStem':str(args.source),
		'excerptStartSeconds':args.start,'eventCount':len(doc['events']),
		'distinctOnsets':doc['qa']['candidateOnsetPeaks'],
		'onsetHopMs':doc['qa']['analysisHopMs'],
		'minDetectorGapMs':doc['qa']['globalMinPeakSeparationMs'],
		'byType':doc['qa']['eventsByType'],
		'status':'private unapproved; ear-check drum event accuracy',
		'preservation':'old GM sampled kits, original separated source stem untouched',
		'kits':{}
	}
	for biome,(label,patch,mapping,wet,spread) in KITS.items():
		raw,event_changes=render_percussion_precise(doc['events'],patch,mapping)
		# Keep the original kit's overall timbral identity while exposing
		# more un-delayed per-hit samples to preserve fast roll articulation.
		styled=airborne_polish(original,raw,biome,wet,spread)
		sound=normalize_to_reference(original,.78*raw+.22*styled)
		assert len(sound)==FRAMES and np.all(np.isfinite(sound))
		ogg(args.out/(biome+'.ogg'),sound)
		report['kits'][biome]={
			'label':label,'gmPatch':patch,
			'liveNotes':len(doc['events']),
			'fluidSynthStateChanges':event_changes,
			'peak':round(float(np.max(np.abs(sound))),5),
			'rms':round(float(np.sqrt(np.mean(sound*sound))),5),
		}
		print('V3_SAMPLE_DRUM_KIT',args.song,biome,len(doc['events']),
			round(report['kits'][biome]['rms'],4),flush=True)
	(args.out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
	print('V3_SAMPLED_DRUMS_COMPLETE',args.song,
		len(KITS),len(doc['events']),args.out,flush=True)

if __name__=='__main__':
	parser=argparse.ArgumentParser(description=__doc__)
	parser.add_argument('--song',required=True)
	parser.add_argument('--events',type=Path,required=True)
	parser.add_argument('--source',type=Path,required=True)
	parser.add_argument('--start',type=float,required=True)
	parser.add_argument('--out',type=Path,required=True)
	run(parser.parse_args())
