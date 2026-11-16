#!/usr/bin/env python3
"""Additive source-envelope expression estimates for candidate note events.
Only local source dynamics, NOT isolated-note velocity ground truth.
Never infer arbitrary pitch bends or mutate v1/v2 note JSON.
"""
import argparse
import json
import math
import subprocess
from pathlib import Path
import numpy as np

RATE=22050

def mono_excerpt(path,start,seconds):
	p=subprocess.run(['ffmpeg','-v','error','-nostdin','-ss',str(start),
		'-i',str(path),'-t',str(seconds),'-ac','1','-ar',str(RATE),
		'-f','f32le','pipe:1'],capture_output=True,check=True,timeout=80)
	y=np.frombuffer(p.stdout,dtype='<f4').copy()
	count=round(seconds*RATE)
	return np.pad(y[:count],(0,max(0,count-len(y))))

def rms(y,start,end):
	a=max(0,min(len(y),round(start*RATE)))
	b=max(a,min(len(y),round(end*RATE)))
	if b<=a:return 0.
	return float(np.sqrt(np.mean(y[a:b].astype('float64')**2)))

def annotate(y,events):
	# Source stem may be polyphonic; coinciding hits contaminate level evidence.
	measure=[]
	for note in events:
		a=float(note['start']);b=float(note['end'])
		attack=rms(y,a,a+.065)
		sustain=rms(y,a+.065,min(b,a+.35))
		pre=rms(y,max(0,a-.065),a)
		release=rms(y,max(a,b-.06),min(len(y)/RATE,b+.09))
		measure.append({'attack':attack,'sustain':sustain,'pre':pre,
			'release':release,'impact':max(attack-pre*.55,attack*.16,1e-8)})
	logs=np.log(np.maximum([m['impact'] for m in measure],1e-8))
	lo=float(np.percentile(logs,15)) if len(logs) else 0.
	hi=float(np.percentile(logs,85)) if len(logs) else 1.
	if hi-lo<.25:hi=lo+.25
	rich=[]
	for i,note in enumerate(events):
		m=measure[i];note=dict(note)
		attack_level=(math.log(max(m['impact'],1e-8))-lo)/(hi-lo)
		velocity=int(np.clip(round(56+58*attack_level),45,120))
		hold=m['sustain']/max(m['attack'],1e-8)
		articulation=('plucked_or_percussive' if hold<.4 else
			'sustained_or_legato' if hold>.78 else 'neutral_or_mixed')
		simultaneous=sum(abs(float(other['start'])-float(note['start']))<.09
			for j,other in enumerate(events) if j!=i)
		repeat=any(int(prev['midi'])==int(note['midi']) and
			0<=float(note['start'])-float(prev['end'])<.20
			for prev in events[:i])
		note['expression']={
			'estimatedVelocity':velocity,
			'attackVsPreDb':round(20*math.log10(max(m['attack'],1e-8)/
				max(m['pre'],1e-8)),2),
			'sustainToAttackRatio':round(hold,3),
			'articulationHint':articulation,
			'repeatedSamePitchAttack':repeat,
			'otherNearSimultaneousOnsets':simultaneous,
			'pitchBendStatus':'not_estimated_polyphonic_source',
			'vibratoStatus':'not_estimated_polyphonic_source',
			'confidenceNote':'Velocity and envelope may belong to overlapping instruments'}
		rich.append(note)
	return rich

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--source',type=Path,required=True)
	p.add_argument('--notes',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--start',type=float,required=True)
	p.add_argument('--seconds',type=int,default=32)
	a=p.parse_args()
	if a.out.exists():
		raise SystemExit('Refusing to overwrite expression candidates')
	src=json.loads(a.notes.read_text())
	events=src['events']
	y=mono_excerpt(a.source,a.start,a.seconds)
	out=annotate(y,events)
	doc={'schemaVersion':3,'sourceStem':str(a.source),
		'notesSource':str(a.notes),'excerptStartSeconds':a.start,
		'excerptSeconds':a.seconds,'events':out,'count':len(out),
		'status':'unapproved expression test, never final note velocity',
		'limitations':[
			'Velocity from mixed original stem attack level, not isolated MIDI velocity',
			'Polyphonic pitch bends/vibrato cannot be safely inferred this way',
			'Sustain/articulation are source-envelope hints, not independent instruments']}
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(doc,indent=2)+'\n')
	print('EXPRESSION_V3',a.out,'notes',len(out),
		'velocityRange',([min(x['expression']['estimatedVelocity'] for x in out),
			max(x['expression']['estimatedVelocity'] for x in out)] if out else []),
		flush=True)

if __name__=='__main__':
	main()
