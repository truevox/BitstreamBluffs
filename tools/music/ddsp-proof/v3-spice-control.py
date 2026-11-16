#!/usr/bin/env python3
"""Replace ONLY pitch control on a 25s copy of V3 to isolate raw detector effects.

Do not modify any stem, older cache, or previous gallery output. Use the
existing V3 notes, same MIDI sample programs and polish, same song timing.
"""
import argparse
import json
from pathlib import Path
import numpy as np

def main():
	p=argparse.ArgumentParser()
	p.add_argument('--spice-features',required=True,type=Path)
	p.add_argument('--v3-analysis',required=True,type=Path)
	p.add_argument('--v3-notes',required=True,type=Path)
	p.add_argument('--out',required=True,type=Path)
	p.add_argument('--start',default=150,type=float)
	p.add_argument('--duration',default=25,type=float)
	a=p.parse_args()
	with np.load(a.v3_analysis) as raw:
		analysis={k:raw[k].copy() for k in raw.files}
	notes=json.loads(a.v3_notes.read_text())
	control=json.loads(a.spice_features.read_text())
	hz=np.asarray(control['f0_hz'],dtype=np.float32)
	conf=np.asarray(control['confidence_spice'],dtype=np.float32)
	assert len(hz)==int(a.duration*250)
	lo=round(a.start*100)
	hi=round((a.start+a.duration)*100)
	assert hi-lo==2500
	source_time=np.arange(len(hz))*.004
	frame_time=np.arange(lo,hi)*.01-a.start
	pitch=np.interp(frame_time,source_time,hz).astype(np.float32)
	confidence=np.interp(frame_time,source_time,conf).astype(np.float32)
	# On long unvoiced gaps leave V3 pitch, but silence/energy gates remain
	# the original V3 values; no interval timing or note onset is altered.
	reliable=(pitch>70)&(confidence>=.54)
	new=analysis['f0'][lo:hi].copy()
	new[reliable]=pitch[reliable]
	analysis['f0'][lo:hi]=new
	revised=0
	for n in notes['notes']:
		if not a.start <= n['start'] < a.start+a.duration:
			continue
		t0=n['start']+.02
		t1=min(n['end'],n['start']+.12)
		left=max(lo,round(t0*100))
		right=min(hi,max(left+1,round(t1*100)))
		valid=reliable[left-lo:right-lo]
		segment=new[left-lo:right-lo][valid]
		if segment.size<2:
			continue
		median=float(np.median(segment))
		n['frequency']=round(median,3)
		n['midi']=int(round(69+12*np.log2(median/440)))
		revised+=1
	a.out.parent.mkdir(parents=True,exist_ok=True)
	np.savez_compressed(a.out,**analysis)
	note_path=a.out.with_suffix('.notes.json')
	note_path.write_text(json.dumps(notes,indent=2)+'\n')
	print(json.dumps({
		'version':'V3 timbre with SPICE pitch only',
		'outfile':str(a.out),'notesFile':str(note_path),
		'originalNotes':len(notes['notes']),
		'notesRetuned':revised,
		'newF0Frames':int(reliable.sum()),
		'untouchedOnsetTimes':True,
		'unchangedTimbres':True,
	},indent=2))

if __name__=='__main__': main()
