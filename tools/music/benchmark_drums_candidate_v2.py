#!/usr/bin/env python3
"""Simultaneous kick/snare/hat gold-synthetic probes (never artist gold)."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from scipy.signal import butter,sosfiltfilt
from evaluate_performance_v1 import match_events,metrics
from render_full_dynamic_orchestra_v1 import choose_drum_events
from detector_candidate_v2 import drum_simultaneous

RATE=16000
LENGTH=12
SEED=559103

def hits(case):
	if case=='cohits':
		# Kick+snare simultaneous on some beats; hats on subdivisions.
		return sorted(
			[{'t':round(.4+i*.42,4),'type':'kick'}
				for i in range(26)] +
			[{'t':round(.4+i*.84,4),'type':'snare'}
				for i in range(13)] +
			[{'t':round(.4+i*.21,4),'type':'hat'}
				for i in range(52)],key=lambda e:e['t'])
	if case=='isolated':
		return sorted([{'t':.4+i*.34,'type':('kick','snare','hat')[i%3]}
			for i in range(32)],key=lambda e:e['t'])
	if case=='hats-roll':
		return sorted(
			[{'t':round(.4+i*.07,4),'type':'hat'} for i in range(150)] +
			[{'t':round(.4+i*.56,4),'type':'kick'} for i in range(19)] +
			[{'t':round(.68+i*.56,4),'type':'snare'} for i in range(19)],
			key=lambda e:e['t'])
	if case=='echoed-cohits':
		return hits('cohits')
	raise ValueError(case)

def synth(notes,echo=False):
	rng=np.random.default_rng(SEED)
	y=np.zeros(LENGTH*RATE,dtype='float64')
	for i,event in enumerate(notes):
		t=event['t']
		start=round(t*RATE)
		dur={'kick':.165,'snare':.14,'hat':.067}[event['type']]
		length=min(round(dur*RATE),len(y)-start)
		if length<=0:continue
		time=np.arange(length)/RATE
		if event['type']=='kick':
			f=72*np.exp(-time/.05)+49
			tone=np.sin(np.cumsum(2*np.pi*f/RATE))
			s=tone*np.exp(-time/.045)*.21
			s+=rng.standard_normal(length)*np.exp(-time/.002)*.008
		elif event['type']=='snare':
			noise=rng.standard_normal(length)
			sos=butter(4,[500,3200],fs=RATE,btype='bandpass',output='sos')
			s=sosfiltfilt(sos,noise)*np.exp(-time/.035)*.15
		else:
			noise=rng.standard_normal(length)
			sos=butter(4,[4700,7600],fs=RATE,btype='bandpass',output='sos')
			s=sosfiltfilt(sos,noise)*np.exp(-time/.016)*.16
		s*=np.minimum(1,time/.0018)
		# Optional independently struck ghost-note velocity; default
		# remains byte-identical to the original four synthetic fixtures.
		velocity=event.get('velocity',1.)
		if not 0<velocity<=1.5:raise ValueError('invalid synthetic velocity')
		y[start:start+length]+=s*velocity
	if echo:
		prev=y.copy()
		for delay,amount in ((.080,.34),(.15,.18)):
			offset=round(delay*RATE)
			y[offset:]+=prev[:-offset]*amount
	y+=rng.standard_normal(len(y))*.000015
	return y.astype('float32')

def compare(pred,gold,tol):
	predmap,goldmap={},{}
	for row in pred:
		predmap.setdefault(row['type'],[]).append({
			'startFrame':round(row['t']*48000)})
	for row in gold:
		goldmap.setdefault(row['type'],[]).append({
			'startFrame':round(row['t']*48000)})
	pairs=[]
	for kind in predmap.keys()|goldmap.keys():
		a=sorted(predmap.get(kind,[]),key=lambda x:x['startFrame'])
		b=sorted(goldmap.get(kind,[]),key=lambda x:x['startFrame'])
		pairs.extend(match_events(a,b,round(tol*48)))
	return metrics(pairs,len(pred),len(gold),LENGTH*48000)

def run():
	d={'format':'bitstream-drums-synthetic-differential-v1',
		'seed':SEED,'goldStatus':'synthetic only not human',
		'passages':[],'candidateReleaseApproved':False}
	for case in ('isolated','cohits','hats-roll','echoed-cohits'):
		ground=hits(case)
		y=synth(ground,echo=case=='echoed-cohits')
		old,os=choose_drum_events(y)
		new,ns=drum_simultaneous(y)
		v1=compare(old,ground,20)
		v2=compare(new,ground,20)
		item={'scenario':case,'audioSha256':hashlib.sha256(y.tobytes()).hexdigest(),
			'ground':len(ground),'baselineCount':len(old),'candidateCount':len(new),
			'baseline':{'20ms':v1,'50ms':compare(old,ground,50)},
			'candidate':{'20ms':v2,'50ms':compare(new,ground,50)},
			'baselineDiagnostics':os,'candidateDiagnostics':ns}
		d['passages'].append(item)
		print(case,'GOLD',len(ground),'OLD',len(old),'NEW',len(new),
			'oldF1',v1['f1'],'newF1',v2['f1'],
			'oldTP',v1['truePositive'],'newTP',v2['truePositive'],
			'newBias',v2['signedBiasMs'],flush=True)
	return d

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise FileExistsError(a.out)
	report=run()
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('SYNTHETIC_DRUMS_RESULTS',a.out)
