#!/usr/bin/env python3
"""V3 church organ's micro-expression with SheetSage2 -12 melody.

Keep original V3 SF2 program, V1 blend/attack polish and SheetSage note-onsets.
Derive only the *relative* sub-semitone movements from the original V3 f0
within each SheetSage2 note, reanchor them to its octave-lowered target.
Never import V3 absolute note center, dissonant octave hops or note boundaries.
"""
import json
import math
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d, median_filter

LAB=Path('/root/bitstream-maxi/transcription-lab-20261115/organ-ear-test')
base=LAB/'sheet-down12'
original=Path('/root/bitstream-maxi/mountain-voice-gallery-v3/pope-pitch-stable-35.npz')
notes=json.loads((base/'notes.json').read_text())['notes']
assert len(notes)==68
with np.load(original) as z:
	v3={k:z[k].copy() for k in z.files}
with np.load(base/'control.npz') as z:
	baseline={k:z[k].copy() for k in z.files}
assert baseline['f0'].shape==v3['f0'].shape
assert not np.array_equal(baseline['f0'][15000:17500],v3['f0'][15000:17500])

variants=[
	('hybrid-gentle',32.0,0.72),
	('hybrid-expressive',70.0,0.92),
]
for name,maxc,weight in variants:
	out=LAB/name
	out.mkdir(parents=True,exist_ok=True)
	info=[]
	ctrl={k:v.copy() for k,v in baseline.items()}
	for n in notes:
		begin=max(15000,int(round(float(n['start'])*100)))
		end=min(17500,int(round(float(n['end'])*100)))
		if end<=begin:
			continue
		ref=v3['f0'][begin:end].astype(np.float64)
		is_active=v3['active'][begin:end].astype(bool)
		valid=np.isfinite(ref)&is_active&(ref>80)&(ref<1600)
		if valid.sum()<max(4,min(9,(end-begin)//4)):
			continue
		median=float(np.median(ref[valid]))
		# Relative expressive pitch only, not original note center.
		cents=np.zeros(len(ref),dtype=np.float64)
		cents[valid]=1200*np.log2(ref[valid]/median)
		cents[valid]=np.clip(cents[valid],-maxc,maxc)
		# Fill unvoiced frames with nearby motion, then smooth in time
		# to remove spikes but retain gentle musical bends/vibrato.
		if valid.sum()>=2:
			times=np.arange(len(ref))
			cents=np.interp(times,times[valid],cents[valid])
		cents=median_filter(cents,size=3,mode='nearest')
		cents=gaussian_filter1d(cents,sigma=2.5,mode='nearest')
		cents=np.clip(cents*weight,-maxc,maxc)
		freq=440*2**((int(n['midi'])-69)/12)
		replacement=freq*2**(cents/1200)
		gate=ctrl['active'][begin:end].astype(bool)
		ctrl['f0'][begin:end][gate]=replacement[gate]
		info.append({
			'start':n['start'],'end':n['end'],'targetMidi':n['midi'],
			'originalMedianHz':round(median,2),
			'maxExpressiveCents':round(float(np.max(np.abs(cents))),1)
		})
	# Sanity: no new octave errors from V3's measured source.
	for n in notes:
		start=max(15000,int(round(n['start']*100)))
		end=min(17500,int(round(n['end']*100)))
		if end<=start:continue
		active=ctrl['active'][start:end].astype(bool)
		hz=ctrl['f0'][start:end][active]
		if hz.size==0:continue
		target=440*2**((n['midi']-69)/12)
		assert np.max(np.abs(1200*np.log2(hz/target)))<=maxc+1.0,(name,n)
	np.savez_compressed(out/'control.npz',**ctrl)
	(out/'notes.json').write_text(json.dumps({
		'format':'bitstream-intended-notes-v1','duration':215,
		'notes':notes,
		'noteDetection':'SheetSage2 vocal melody shifted down 12 semitones',
		'pitchStabilization':'V3 within-note residual only; no V3 center/octave; '+'max '+str(maxc)+' cents',
		'retains':'V3 organ SF2 program 19, V1 texture blend and attacks, SheetSage timing',
	},indent=2)+'\n')
	(out/'hybrid-report.json').write_text(json.dumps({
		'variant':name,'maxCents':maxc,'sourceMovementWeight':weight,
		'processedNotes':len(info),
		'sourceCurve':'original V3 100Hz F0, centered separately within each SheetSage note',
		'anchor':'SheetSage2 -12 MIDI pitches and timestamps, untouched',
		'expressionDiagnostics':info,
	},indent=2)+'\n')
	changed=np.sum(np.abs(ctrl['f0'][15000:17500]-baseline['f0'][15000:17500])>0.01)
	print('READY',name,'notes',len(info),'modifiedFrames',int(changed),
		'maxCents',maxc,'weight',weight,flush=True)
