#!/usr/bin/env python3
"""Articulated singing pitch stabilization, preserving timing and intentional glides.

Input is V2 pitch+onsets, which are never modified. Output is an alternative
vocal control track for audition. All output source-independent.
"""
import argparse
import json
from pathlib import Path

import numpy as np

HOP_SECONDS = .01

def robust_center(segment, voiced):
	good = segment[voiced & (segment > 70) & np.isfinite(segment)]
	if not len(good):
		good = segment[np.isfinite(segment) & (segment > 70)]
	if not len(good):
		return 440.0
	return float(np.median(good[:min(len(good), 20)]))

def stabilized_control(f0, active, notes, *, deadband_cents=25.0,
		expression=.35, large_glide_cents=90, hold_frames=4):
	"""Suppress jitter near each detected note center, preserve established glides."""
	raw = np.asarray(f0, dtype=np.float64)
	voiced = np.asarray(active, dtype=bool)
	out = raw.copy()
	new_notes = [dict(n) for n in notes]
	report = []
	for note in new_notes:
		begin = max(0, int(round(note['start'] / HOP_SECONDS)))
		end = min(len(raw), int(round(note['end'] / HOP_SECONDS)))
		if end <= begin:
			continue
		piece = raw[begin:end]
		good = voiced[begin:end]
		center = robust_center(piece,good)
		note['frequency'] = round(center, 3)
		note['midi'] = int(round(69 + 12*np.log2(center/440.0)))
		cents = 1200*np.log2(np.maximum(piece,1)/center)
		# Three-frame median: reject isolated wiggles, including many octave blips.
		pad = np.pad(cents,(2,2),mode='edge')
		filt = np.median(np.stack([pad[i:i+len(cents)] for i in range(5)]),axis=0)
		absolute = np.abs(filt)
		sign = np.sign(filt)
		# No bend at all for minor fluctuations within the deadband.
		movement = np.maximum(0,absolute-deadband_cents)
		# Gentle expression on modest slides, stronger on intentional sustained glides.
		persistent = np.zeros(len(cents),dtype=bool)
		large = absolute >= large_glide_cents
		for i in range(len(cents)):
			# Use future-and-past consensus to distinguish real slides from spuriously tracked partials.
			left=max(0,i-hold_frames//2)
			right=min(len(cents),i+hold_frames//2+1)
			persistent[i] = np.sum(large[left:right]) >= min(hold_frames,right-left)
		gain = np.where(persistent,0.8,expression)
		bends = np.clip(sign*movement*gain,-190,190)
		# Frame-to-frame slew suppression, but permit real fast (>1 semitone) transitions
		# via note-on events at the next note boundary instead of a forced glide.
		for i in range(1,len(bends)):
			step=bends[i]-bends[i-1]
			if abs(step) > 22 and not persistent[i]:
				bends[i] = bends[i-1] + np.clip(step,-22,22)
		smooth = center * np.exp2(bends/1200.0)
		out[begin:end] = np.where(good,smooth,center)
		report.append({
			'start':note['start'],'centerHz':round(center,1),
			'medianRawCents':round(float(np.median(cents)),1),
			'rawStepsAbove10c':int(np.sum(np.abs(np.diff(cents))>10)),
			'processedStepsAbove10c':int(np.sum(np.abs(np.diff(bends))>10)),
			'persistentGlideFrames':int(persistent.sum())
		})
	return out.astype(np.float32),new_notes,report

def main():
	p=argparse.ArgumentParser()
	p.add_argument('--analysis',type=Path,required=True)
	p.add_argument('--notes',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--expression',type=float,default=.35)
	p.add_argument('--deadband-cents',type=float,default=25)
	a=p.parse_args()
	if not 0<=a.expression<=1 or not 0<=a.deadband_cents<=80:
		raise ValueError('Invalid expression/deadband')
	with np.load(a.analysis) as z:
		data = {name:z[name] for name in z.files}
	notes=json.loads(a.notes.read_text())
	processed, revised, report = stabilized_control(data['f0'],data['active'],notes['notes'],
		expression=a.expression,deadband_cents=a.deadband_cents)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	data['f0']=processed
	np.savez_compressed(a.out,**data)
	notes['notes']=revised
	notes['pitchStabilization']={'deadbandCents':a.deadband_cents,
		'expression':a.expression,'intentionalGlideGain':0.8,'maxBendCents':190}
	a.out.with_suffix('.notes.json').write_text(json.dumps(notes,indent=2)+'\n')
	print(json.dumps({'notes':len(revised),'reportCount':len(report),
		'rawStepsAbove10c':sum(x['rawStepsAbove10c'] for x in report),
		'processedStepsAbove10c':sum(x['processedStepsAbove10c'] for x in report),
		'persistentGlideFrames':sum(x['persistentGlideFrames'] for x in report),
		'output':str(a.out)},indent=2))

if __name__=='__main__':
	main()
