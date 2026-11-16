#!/usr/bin/env python3
"""One More Run: SheetSage2 -12 intended notes + bounded V2 pitch residual (Gentle).
Separate working directory, source stems never rewritten.
"""
import json
from pathlib import Path
import numpy as np
import pretty_midi
from scipy.ndimage import median_filter,gaussian_filter1d

LAB=Path('/root/bitstream-maxi/transcription-lab-20261115/full-song-one-more-run')
SRC=LAB/'input/one-more-run-phrasing.npz'
SCORE=LAB/'input/sheetsage-vocal-full.mid'
OUT=LAB/'output'
FRAMES=8380800
DURATION=FRAMES/48000
m=pretty_midi.PrettyMIDI(str(SCORE))
ns=sorted([n for i in m.instruments if not i.is_drum for n in i.notes],key=lambda x:(x.start,x.pitch))
assert 280<len(ns)<500,len(ns)
with np.load(SRC) as z:
	raw={k:z[k].copy() for k in z.files}
print('RAW',[(k,list(v.shape)) for k,v in raw.items()],flush=True)
assert len(raw['f0'])==17460 and len(raw['active'])==17460
notes=[]
for x in ns:
	begin=max(0.,float(x.start));end=min(DURATION,float(x.end))
	if end-begin<.055:continue
	pitch=int(x.pitch)-12
	if not 40<=pitch<=96:continue
	notes.append(dict(start=round(begin,5),end=round(end,5),
		midi=pitch,frequency=round(440*2**((pitch-69)/12),5),
		velocity=int(np.clip(x.velocity,60,112))))
for i in range(len(notes)-1):
	if notes[i]['end']>notes[i+1]['start']:
		notes[i]['end']=notes[i+1]['start']
notes=[n for n in notes if n['end']-n['start']>=.05]
assert len(notes)>275,len(notes)
out={}
for mode,maxc,weight in [('gentle',32.,.72),('pure',0.,0.)]:
	p=OUT/mode;p.mkdir(parents=True,exist_ok=True)
	ctrl={k:v.copy() for k,v in raw.items()}
	ctrl['f0'][:]=0.;ctrl['active'][:]=0
	processed=0
	for note in notes:
		i0=max(0,int(round(note['start']*100)))
		i1=min(len(ctrl['f0']),int(round(note['end']*100)))
		if i1<=i0:continue
		hz=note['frequency']
		residual=np.zeros(i1-i0,dtype=np.float64)
		original=raw['f0'][i0:i1]
		valid=raw['active'][i0:i1].astype(bool)&np.isfinite(original)&(original>80)&(original<1600)
		if mode=='gentle' and valid.sum()>=max(4,min(9,(i1-i0)//4)):
			center=float(np.median(original[valid]))
			residual[valid]=1200*np.log2(original[valid]/center)
			residual[valid]=np.clip(residual[valid],-maxc,maxc)
			indices=np.arange(i1-i0)
			if valid.sum()>=2:
				residual=np.interp(indices,indices[valid],residual[valid])
			residual=median_filter(residual,size=3,mode='nearest')
			residual=gaussian_filter1d(residual,sigma=2.5,mode='nearest')
			residual=np.clip(residual*weight,-maxc,maxc)
			processed+=1
		sequence=hz*2**(residual/1200)
		ctrl['f0'][i0:i1]=sequence
		ctrl['active'][i0:i1]=1
		if mode=='gentle':assert np.max(np.abs(1200*np.log2(sequence/hz)))<=maxc+1
	np.savez_compressed(p/'controls.npz',**ctrl)
	(p/'notes.json').write_text(json.dumps({
		'format':'bitstream-intended-notes-v1','duration':DURATION,
		'title':'One More Run (The Ballad of Bitstream Bluffs)',
		'scoreSource':'SheetSage2 full isolated lead vocal, 333 notes',
		'instrumentalRegisterShiftSemitones':-12,
		'v3Expression':mode,
		'notes':notes,
	},indent=2)+'\n')
	out[mode]=dict(notes=len(notes),boundedCents=maxc,weight=weight,processedNotes=processed)
	print('READY',mode,len(notes),'processed',processed,flush=True)
(OUT/'full-score-manifest.json').write_text(json.dumps({
	'originalScoreNoteCount':len(ns),'outputNoteCount':len(notes),
	'durationSeconds':DURATION,'sampleFrames':FRAMES,
	'sourceVocalStemSha256':'f67ac4d04cfdd6e8e3c8975d982575a1cac22dea4c824ec8440721ea73c9e8b2',
	'variants':out,
	'rights':'SheetSage2 research/noncommercial weights; private audition only',
},indent=2)+'\n')
print('CONTROL_DONE',len(notes),DURATION,flush=True)
