#!/usr/bin/env python3
"""Reversible transcription-only 25s audition, preserving V3 SoundFont design.

SheetSage2 raw and down octave, plus Basic Pitch monophonic selection.
No changes to original score, stems or original V3 control.
"""
import json
import math
from pathlib import Path

import numpy as np
import pretty_midi

ROOT=Path('/root/bitstream-maxi/transcription-lab-20261115')
OUT=ROOT/'organ-ear-test'
OUT.mkdir(parents=True,exist_ok=True)
V3=Path('/root/bitstream-maxi/mountain-voice-gallery-v3/pope-pitch-stable-35.npz')
SHEET=ROOT/'sheetsage2/maxi-vocal-25-cpufft/melody_vocal.mid'
BASIC=next((ROOT/'basic-pitch').glob('*.mid'))
START=150.
SECONDS=25.
def read_midi(path):
	m=pretty_midi.PrettyMIDI(str(path))
	notes=[
		dict(start=max(0.,float(n.start)),end=min(SECONDS,float(n.end)),midi=int(n.pitch),
			velocity=int(n.velocity))
		for i in m.instruments if not i.is_drum
		for n in i.notes if n.end>0 and n.start<SECONDS
	]
	return sorted(notes,key=lambda n:(n['start'],n['end'],n['midi']))

def select_basic(notes):
	# Nonoverlapping weighted interval selection; no SheetSage/SPICE influence.
	candidates=sorted([
		n for n in notes if 48<=n['midi']<=85 and
		n['end']-n['start']>=.075 and n['velocity']>=25
	],key=lambda n:(n['end'],n['start']))
	n=len(candidates)
	assert n>20,n
	dp=[0.]*n
	links=[-1]*n
	for i,x in enumerate(candidates):
		dur=x['end']-x['start']
		weight=(.5+x['velocity']/130.)*math.sqrt(dur)*2.0-.05
		dp[i]=weight
		for j in range(i):
			y=candidates[j]
			if y['end']>x['start']+.012: continue
			gap=max(0,x['start']-y['end'])
			penalty=.012*min(20,abs(x['midi']-y['midi']))+.035*min(gap,1.)
			candidate_score=dp[j]+weight-penalty
			if candidate_score>dp[i]:
				dp[i]=candidate_score
				links[i]=j
	ix=max(range(n),key=lambda j:dp[j])
	selected=[]
	while ix>=0:
		selected.append(dict(candidates[ix]))
		ix=links[ix]
	selected.reverse()
	for ix in range(len(selected)-1):
		selected[ix]['end']=min(selected[ix]['end'],selected[ix+1]['start'])
	return [x for x in selected if x['end']-x['start']>=.07],n

sheet=read_midi(SHEET)
basic=read_midi(BASIC)
basic_clean,eligible=select_basic(basic)
sources={
	'sheet-original':(sheet,0),
	'sheet-down12':(sheet,-12),
	'basic-monophonic':(basic_clean,0),
}
with np.load(V3) as f:
	orig={k:f[k].copy() for k in f.files}
print('CONTROL_KEYS',[(k,list(v.shape),str(v.dtype)) for k,v in orig.items()])
assert all(x in orig for x in ('f0','active','env','time'))
assert len(orig['f0'])>=17500
summary={
	'inputStartSeconds':START,
	'inputLengthSeconds':SECONDS,
	'sheetRawNotes':len(sheet),'basicRawNotes':len(basic),
	'basicCandidates':eligible,
	'rawModelsReadOnly':True,
	'pitchRendering':'constant note pitch without expressive bends (diagnostic)',
	'instrument':'FluidR3_GM sf2, GM program 19, identical V3 Vertigo Vents polish',
	'versions':{}
}
for label,(notes,shift) in sources.items():
	dst=OUT/label
	dst.mkdir(exist_ok=True)
	c={k:v.copy() for k,v in orig.items()}
	left=round(START*100)
	right=round((START+SECONDS)*100)
	c['f0'][left:right]=0.
	c['active'][left:right]=0
	out_notes=[]
	for n in notes:
		pitch=int(n['midi']+shift)
		if not 40<=pitch<=96:continue
		if n['end']-n['start']<.06:continue
		start=START+n['start']
		end=START+n['end']
		freq=440*2**((pitch-69)/12)
		out_notes.append({
			'start':round(start,4),'end':round(end,4),
			'midi':pitch,'frequency':round(freq,3),
			'velocity':int(np.clip(n['velocity'],60,112))
		})
		i0=max(left,round(start*100))
		i1=min(right,round(end*100))
		if i1>i0:
			c['f0'][i0:i1]=freq
			c['active'][i0:i1]=1
	assert len(out_notes)>=25,(label,len(out_notes))
	out_notes.sort(key=lambda x:x['start'])
	control=dst/'control.npz'
	np.savez_compressed(control,**c)
	notes_path=dst/'notes.json'
	notes_path.write_text(json.dumps({
		'format':'bitstream-intended-notes-v1',
		'notes':out_notes,'duration':215,
		'noteDetection':label,
		'pitchStabilization':'constant MIDI note pitch',
		'inputFile':str(SHEET if label.startswith('sheet') else BASIC),
	},indent=2)+'\n')
	summary['versions'][label]={
		'rawNotes':len(notes),'renderedNotes':len(out_notes),'octaveShift':shift,
		'medianPitch':int(np.median([n['midi'] for n in out_notes])),
		'notesPath':str(notes_path),'analysisPath':str(control)
	}
	print('READY',label,summary['versions'][label],flush=True)
(OUT/'controls-manifest.json').write_text(json.dumps(summary,indent=2)+'\n')
print('COMPLETE',len(summary['versions']),flush=True)
