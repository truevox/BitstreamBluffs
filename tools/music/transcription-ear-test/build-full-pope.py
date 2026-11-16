#!/usr/bin/env python3
"""Full-song Pope SheetSage2 -12 / V3 organ Gentle render.

KEEP canonical original Demucs stem source, V3 master and score untouched.
Build controls on the 214.975979s original clock. Score is full-song
SheetSage2 original-vocal MIDI; transpose 12 semitones as ORGAN register.
Variant gentle inherits only original V3 within-note relative <=32 cent pitch.
Model checkpoint rights: SheetSage2 research-only/noncommercial; no game ship.
"""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import numpy as np
import pretty_midi
from scipy.ndimage import gaussian_filter1d,median_filter

BASE=Path('/root/bitstream-maxi/transcription-lab-20261115/full-song-pope')
V3=Path('/root/bitstream-maxi/mountain-voice-gallery-v3/pope-pitch-stable-35.npz')
SCORE=BASE/'input/sheetsage2-vocal-full.mid'
FRAME_COUNT=10318847
SAMPLE_RATE=48000
TIME=FRAME_COUNT/SAMPLE_RATE
assert abs(TIME-214.976)<.001
START=0
OUT=BASE/'output'
OUT.mkdir(parents=True,exist_ok=True)

m=pretty_midi.PrettyMIDI(str(SCORE))
notes_in=sorted([n for x in m.instruments if not x.is_drum for n in x.notes],key=lambda n:(n.start,n.pitch))
assert len(notes_in)>=600, len(notes_in)
with np.load(V3) as orig:
	v3={k:orig[k].copy() for k in orig.files}
assert len(v3['f0'])>=round(TIME*100)-1
notes=[]
for n in notes_in:
	begin=max(0.,float(n.start))
	end=min(TIME,float(n.end))
	if end-begin<.055:continue
	pitch=int(n.pitch)-12
	if not 40<=pitch<=96:
		continue
	notes.append(dict(
		start=round(begin,5),end=round(end,5),
		midi=pitch,
		frequency=round(440*2**((pitch-69)/12),5),
		velocity=int(np.clip(n.velocity,60,112)),
	))
assert len(notes)>=590,len(notes)
# Monophonic score: shorten overlap to the subsequent onset for sample synth.
for i in range(len(notes)-1):
	if notes[i]['end']>notes[i+1]['start']:
		notes[i]['end']=notes[i+1]['start']
notes=[n for n in notes if n['end']-n['start']>=.05]
assert len(notes)>=590,len(notes)

out_manifest={
	'song':'Pope Leo Wants the AI Root Password',
	'sourceMidi':str(SCORE),
	'sourceNotes':len(notes_in),
	'recordableNotes':len(notes),
	'originalV3Analysis':str(V3),
	'originalWavFrames':FRAME_COUNT,
	'fps':SAMPLE_RATE,
	'controlRateHz':100,
	'fullDurationSeconds':TIME,
	'organProgram':19,
	'registerShiftSemitones':-12,
	'exactRegisterMeaning':'musical arrangement octave; not a claim Maxi sang an octave lower',
	'variants':{},
}
for name,maxc,weight in [('pure',0.,0.),('gentle',32.,.72)]:
	dest=OUT/name
	dest.mkdir(parents=True,exist_ok=True)
	ctrl={k:v.copy() for k,v in v3.items()}
	ctrl['f0'][:]=0.
	ctrl['active'][:]=0
	processed=0
	changed_frames=0
	for note in notes:
		i0=max(0,int(round(note['start']*100)))
		i1=min(len(ctrl['f0']),int(round(note['end']*100)))
		if i1<=i0:continue
		target=note['frequency']
		f0=np.full(i1-i0,target,dtype=np.float64)
		original=v3['f0'][i0:i1]
		valid=v3['active'][i0:i1].astype(bool)&np.isfinite(original)&(original>80)&(original<1600)
		if name=='gentle' and valid.sum()>=max(4,min(9,(i1-i0)//4)):
			median=float(np.median(original[valid]))
			cents=np.zeros(len(original),dtype=np.float64)
			cents[valid]=1200*np.log2(original[valid]/median)
			cents[valid]=np.clip(cents[valid],-maxc,maxc)
			if valid.sum()>=2:
				times=np.arange(len(original))
				cents=np.interp(times,times[valid],cents[valid])
			cents=median_filter(cents,size=3,mode='nearest')
			cents=gaussian_filter1d(cents,sigma=2.5,mode='nearest')
			cents=np.clip(cents*weight,-maxc,maxc)
			f0=target*2**(cents/1200)
			processed+=1
			changed_frames+=int(np.count_nonzero(abs(f0-target)>.01))
		ctrl['f0'][i0:i1]=f0
		ctrl['active'][i0:i1]=1
		assert np.max(np.abs(1200*np.log2(f0/target)))<=maxc+1 if maxc else True

	cpath=dest/'controls.npz'
	npath=dest/'notes.json'
	np.savez_compressed(cpath,**ctrl)
	npath.write_text(json.dumps({
		'format':'bitstream-intended-notes-v1',
		'source':'Full original Maxi vocal stem, official SheetSage2 melody_vocal.mid',
		'musicalRegisterShiftSemitones':-12,
		'v3Expression':name,
		'notes':notes,
		'duration':TIME,
	},indent=2)+'\n')
	out_manifest['variants'][name]={
		'controlsPath':str(cpath),'notesPath':str(npath),
		'expressiveBoundCents':maxc,'expressiveWeight':weight,
		'processedNotes':processed,'changedFrames':changed_frames,
	}
	print('PREPARED',name,'notes',len(notes),'microExpressiveNotes',processed,
		  'changedFrames',changed_frames,flush=True)
(OUT/'full-score-manifest.json').write_text(json.dumps(out_manifest,indent=2)+'\n')
print('CONTROLS_PREPARED',len(notes),TIME)
