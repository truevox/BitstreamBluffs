#!/usr/bin/env python3
"""Audition diagnostics; compare separate model predictions without inventing ground truth."""
from collections import Counter
import json
from pathlib import Path
import math
import numpy as np
import pretty_midi

ROOT=Path('/root/bitstream-maxi/transcription-lab-20261115')
root=ROOT/'sheetsage2'
def load(path,offset=0):
	m=pretty_midi.PrettyMIDI(str(path))
	a=[]
	for inst in m.instruments:
		for n in inst.notes:
			start=n.start-offset
			end=n.end-offset
			if end>0 and start<25:
				a.append(dict(start=max(0,float(start)),end=min(25.,float(end)),pitch=int(n.pitch),velocity=int(n.velocity)))
	return sorted(a,key=lambda x:(x['start'],x['pitch']))

data={
	'vocal25':load(root/'maxi-vocal-25-cpufft/melody_vocal.mid'),
	'mix25':load(root/'fullmix-25/melody_vocal.mid'),
	'vocal215-window':load(root/'vocal-215/melody_vocal.mid',150),
	'mix215-window':load(root/'fullmix-215/melody_vocal.mid',150),
	'basic25-raw':load(next((ROOT/'basic-pitch').glob('*.mid'))),
}
v3=json.loads(Path('/root/bitstream-maxi/mountain-voice-gallery-v3/pope-pitch-stable-35.notes.json').read_text())['notes']
data['v3-note-onsets']=[dict(start=max(0,n['start']-150),end=min(25,n['end']-150),pitch=n['midi'],velocity=n['velocity'])
						for n in v3 if n['start']<175 and n['end']>150]
spice=json.loads(Path('/root/bitstream-maxi/mountain-ddsp-probe/ddsp-25s-spice.json').read_text())
assert spice['pitchSource'].startswith('Official Magenta SPICE')
freq=np.asarray(spice['f0_hz'])
conf=np.asarray(spice['confidence_spice'])
def agreement(a,b,window=.14):
	paired=[]
	taken=set()
	for n in a:
		options=[(abs(n['start']-k['start']),abs((n['pitch']-k['pitch'])%12),idx,k)
			for idx,k in enumerate(b) if idx not in taken and abs(n['start']-k['start'])<=window]
		if not options:continue
		_,_,idx,k=min(options,key=lambda v:(v[0],min(abs(v[1]),12-abs(v[1]))))
		taken.add(idx)
		paired.append((n['pitch']-k['pitch'],n,k))
	diff=Counter([d for d,_,_ in paired])
	pcs=sum(d%12==0 for d,_,_ in paired)
	return dict(onsetMatched=len(paired),exactPitch=sum(d==0 for d,_,_ in paired),
		pitchClassMatched=pcs,octaveDiffs={str(k):v for k,v in diff.most_common(9)})
def spiceerr(notes):
	errs=[]
	for n in notes:
		start=max(0,int((n['start']+.04)*250))
		end=min(len(freq),int(min(n['end'],n['start']+.18)*250))
		if end<=start:continue
		vals=freq[start:end][conf[start:end]>=.65]
		vals=vals[vals>70]
		if len(vals)<5:continue
		sample=float(np.median(vals))
		midi=69+12*math.log2(sample/440.)
		diff=n['pitch']-midi
		errs.append(diff)
	if not errs:return {}
	return dict(samples=len(errs),medianAbsSemitones=round(float(np.median(np.abs(errs))),1),
		medianAbsPitchClassSemitones=round(float(np.median(np.abs(((np.array(errs)+6)%12)-6))),2),
		medianDiffSemitones=round(float(np.median(errs)),1))
reports={}
for k,v in data.items():
	overlap=sum(any(j!=i and n['start']<m['end']-.01 and n['end']>m['start']+.01 for j,m in enumerate(v))
		for i,n in enumerate(v))
	reports[k]={
		'notes':len(v),
		'medianLength':round(float(np.median([n['end']-n['start'] for n in v])),3) if v else 0,
		'simultaneousNotes':overlap,
		'medianPitch':int(np.median([n['pitch'] for n in v])) if v else 0,
		'spice':spiceerr(v),
		'firstNotes':[(round(n['start'],2),pretty_midi.note_number_to_name(n['pitch'])) for n in v[:15]]
	}
print('INDIVIDUAL',json.dumps(reports,indent=2))
for k in ('mix25','vocal215-window','mix215-window','basic25-raw','v3-note-onsets'):
	print('AGREEMENT',k,'versus vocal25',agreement(data[k],data['vocal25']))
(ROOT/'comparison.json').write_text(json.dumps({'reports':reports,'referenceAgreements':{
	k:agreement(data[k],data['vocal25']) for k in data if k!='vocal25'
}},indent=2)+'\n')
