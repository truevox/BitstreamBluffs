#!/usr/bin/env python3
"""Real sampled *new* Candy Cane melody, isolated from approved Pyramid lead.

New identity: 'Sugar Pop' — tightly gated sampled GM marimba plus a
small square synth fundamental, independent pitched 'bubble' note-on attacks.
Uses PREVIOUSLY DERIVED original Maxi melody note JSON (not a fake source).
This renders ONLY the requested private audio-lab excerpt, preserving the
earlier Candy V2 and perfect Pyramid melody untouched for direct A/B.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from sf2_melody_v2 import RATE,Synth
from audio_first_render import ogg

def layer(notes,program,start,seconds,velocity_scale=1,shorten=1):
	synth=Synth(program)
	frames=RATE*seconds
	y=np.zeros(frames,dtype=np.float32)
	actions=[]
	for note in notes:
		a=max(0,int(round((float(note['start'])-start)*RATE)))
		b=min(frames,int(round((float(note['end'])-start)*RATE)))
		midi=int(note['midi'])
		if b<a or a>=frames or midi<42 or midi>96:continue
		dur=b-a
		# Rapid articulated plucks instead of the Pyramid brass's broad
		# stabs or sustaining saw-wave lead from previous Candy version.
		on=min(b,max(a+1,a+int(dur*shorten)))
		vel=int(np.clip(note.get('velocity',95)*velocity_scale,30,123))
		actions.append((a,1,midi,vel))
		actions.append((min(frames-1,on),0,midi,vel))
	actions.sort(key=lambda a:(a[0],a[1]))
	i=0
	try:
		for frame in range(0,frames,480):
			while i<len(actions) and actions[i][0]<=frame:
				_,on,midi,vel=actions[i]
				if on:synth.note_on(synth.ptr,0,midi,vel)
				else:synth.note_off(synth.ptr,0,midi)
				i+=1
			count=min(480,frames-frame)
			y[frame:frame+count]=synth.render(count)
	finally:
		synth.close()
	return y,len(actions)//2

def candy_pops(notes,start,seconds):
	out=np.zeros(RATE*seconds,dtype=np.float32)
	rng=np.random.default_rng(31241)
	for n in notes:
		begin=int(round((float(n['start'])-start)*RATE))
		if begin<0 or begin>=len(out):continue
		count=min(len(out)-begin,round(.14*RATE))
		t=np.arange(count,dtype=np.float32)/RATE
		f0=440*2**((int(n['midi'])-69)/12)
		# Exponentially settling pitch bubble (start sharp then fall) +
		# very short sugary click noise. Not a second song/melody.
		phase=2*np.pi*f0*(t+.18*.028*(1-np.exp(-t/.028)))
		plop=(.35*np.sin(phase)+.14*np.sin(2.01*phase)) * np.exp(-t/.045)
		click=.06*rng.standard_normal(count).astype(np.float32)*np.exp(-t/.005)
		out[begin:begin+count]+=plop+click
	return out

def render(notes,start,seconds):
	selected=[n for n in notes if n['end']>start and n['start']<start+seconds]
	samples,noteCount=layer(selected,12,start,seconds,velocity_scale=.94,shorten=.78)
	pulse,_=layer(selected,80,start,seconds,velocity_scale=.39,shorten=.49)
	boing=candy_pops(selected,start,seconds)
	# Distinctive marimba/bubble pluck lead (without brass section samples or
	# GM 81 supersaw). No change to the original note pitch or start time.
	total=.95*samples+.13*pulse+.12*boing
	# Gate extra synth sustain against source note onsets, not vocal RMS.
	# Preserve deliberate musical gaps without the original saw pad smear.
	stereo=np.stack([total,total],axis=1)
	rms=float(np.sqrt(np.mean(stereo.astype(np.float64)**2)))
	if rms<1e-7:raise RuntimeError('Candy lead synthesis is completely silent')
	# Compare comfortably to other existing lead voices, with no clipping.
	stereo*=min(3.,.070/rms)
	peak=float(np.max(np.abs(stereo)))
	if peak>.89:stereo*=.89/peak
	return stereo.astype(np.float32),noteCount

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--notes',type=Path,required=True)
	p.add_argument('--start',type=float,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--song',required=True)
	a=p.parse_args()
	assert not a.out.exists(),'Never overwrite previous lead versions '+str(a.out)
	a.out.mkdir(parents=True)
	allNotes=json.loads(a.notes.read_text())['notes']
	sound,n=render(allNotes,a.start,32)
	ogg(a.out/'candy-cane-canyon.ogg',sound,bitrate='112k')
	meta={'biome':'candy-cane-canyon','song':a.song,'instrument':'Sugar Pop marimba + toy square + rubber-bubble note articulation',
		'method':'Actual native sampled marimba instrument performance from previous Gentle-score Maxi melody note events',
		'sampleProgram':12,'supportProgram':80,
		'notesUsed':n,'rms':round(float(np.sqrt(np.mean(sound*sound))),5),
		'peak':round(float(np.max(np.abs(sound))),4),
		'unchanged':'Original Pyramid Peak, all original recordings, original Candy lead V2 (retained as previous audition version)'}
	(a.out/'report.json').write_text(json.dumps(meta,indent=2)+'\n')
	print('NEW_CANDY_MELODY_V3',meta,flush=True)

if __name__=='__main__':
	main()
