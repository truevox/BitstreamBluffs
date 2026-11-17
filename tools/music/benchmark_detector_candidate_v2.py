#!/usr/bin/env python3
"""Differential *synthetic* benchmark, NOT evidence for musical gold accuracy.

Runs untouched release v1 vs new unapproved candidate v2 on equally known
sample-exact note events. Reverb, dense repeated attacks, low MIDI pitches,
and simultaneous chord attacks challenge old FFT-bin/onset methods.
Save metrics *including failures*: no cherry-picked single perfect example.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from scipy.signal import butter,sosfilt
from evaluate_performance_v1 import match_events,metrics
from render_full_dynamic_orchestra_v1 import choose_feature_events
from detector_candidate_v2 import accompaniment,source_onsets

RATE=16000
GROUND_SEED=2473
NOTE_DURATION=.265
TRACK_SECONDS=12

def generate(plucked,echo=False):
	"""Independent time-domain harmonic synth with no shared detector code."""
	rng=np.random.default_rng(GROUND_SEED)
	n=RATE*TRACK_SECONDS
	y=np.zeros(n,dtype=np.float64)
	for i,item in enumerate(plucked):
		origin=int(round(item['start']*RATE))
		end=min(n,origin+round(NOTE_DURATION*RATE))
		nframes=end-origin
		if nframes<=0:continue
		t=np.arange(nframes)/RATE
		f=440.0*2**((item['midi']-69)/12)
		# Mixed inharmonic attack and realistic harmonic envelopes:
		# fundamental sometimes weaker than third harmonic.
		signal=np.zeros(nframes)
		for harmonic in range(1,6):
			a=(.25 if harmonic==1 and i%3==0 else .95)/harmonic**1.0
			signal+=a*np.sin(2*np.pi*f*harmonic*t+
				(harmonic*.23+i*.11))
		env=(1-np.exp(-t/.0045))*np.exp(-t/.095)
		signal*=env*(.07 if i%4 else .11)
		signal+=rng.standard_normal(nframes)*np.exp(-t/.002)*.009
		y[origin:end]+=signal
	if echo:
		delay1=int(round(.075*RATE))
		delay2=int(round(.142*RATE))
		old=y.copy()
		y[delay1:]+=old[:-delay1]*.42
		y[delay2:]+=old[:-delay2]*.22
	y+=rng.standard_normal(n)*.00002
	return np.asarray(y,dtype='float32')

def fixture(name):
	if name=='chromatic-low':
		# Includes each of 8 release v1 *unreachable* low semitones.
		pitches=[41,43,44,46,48,50,52,55,41,43,44,46,48,50,52,55,
			58,60,63,66,69,72,75,79]
		events=[{'start':.4+i*.37,'midi':p}
			for i,p in enumerate(pitches)]
		return events,False
	if name=='repeated-eighths':
		# Re-struck identical pitch at 125ms; 9 groups of 4 notes.
		# 96 repetitions before old v1 grouped them into 12 events.
		events=[{'start':.35+i*.125,'midi':41+((i//4)%9)*3}
			for i in range(88)]
		return events,False
	if name=='plucks-with-echoes':
		pitches=[48,53,58,64,55,60,52,67,57,62,50,65,53,59,61,68,
			48,53,58,64,55,60,52,67,57,62,50,65]
		events=[{'start':.42+i*.36,'midi':p}
			for i,p in enumerate(pitches)]
		return events,True
	if name=='two-note-chords':
		pitches=[(48,55),(50,57),(53,60),(55,62),(57,64),(60,67),
			(48,60),(52,64),(55,67),(57,69),(53,65),(48,60),
			(50,62),(55,67),(57,69),(60,72),(59,71),(57,69)]
		events=[{'start':.35+i*.55,'midi':pitch}
			for i,duo in enumerate(pitches) for pitch in duo]
		return events,False
	raise ValueError(name)

def compare(predicted,gold,total_seconds,window_ms):
	pmap, gmap={},{}
	for e in predicted:pmap.setdefault(e['midi'],[]).append({
		'startFrame':round(e['start']*48000)})
	for e in gold:gmap.setdefault(e['midi'],[]).append({
		'startFrame':round(e['start']*48000)})
	pairs=[]
	for pitch in pmap.keys()|gmap.keys():
		pairs.extend(match_events(sorted(pmap.get(pitch,[]),
			key=lambda v:v['startFrame']),
			sorted(gmap.get(pitch,[]),key=lambda v:v['startFrame']),
			round(window_ms*48)))
	return metrics(pairs,len(predicted),len(gold),round(total_seconds*48000))

def run():
	report={'format':'bitstream-synthetic-detector-differential-v1',
		'seed':GROUND_SEED,'rate':RATE,
		'groundTruth':'sample-exact synthetic generation only; NOT artist human gold',
		'candidateStatus':'research-only-do-not-promote',
		'tests':[]}
	for name in ('chromatic-low','repeated-eighths',
		'plucks-with-echoes','two-note-chords'):
		ground,echo=fixture(name)
		y=generate(ground,echo=echo)
		old,old_stats=choose_feature_events(y)
		new,new_stats=accompaniment(y)
		old20=compare(old,ground,TRACK_SECONDS,20)
		old50=compare(old,ground,TRACK_SECONDS,50)
		new20=compare(new,ground,TRACK_SECONDS,20)
		new50=compare(new,ground,TRACK_SECONDS,50)
		item={'fixture':name,'events':len(ground),'audioSha256':hashlib.sha256(
			y.tobytes()).hexdigest(),'baseline':{'20ms':old20,'50ms':old50},
			'candidate':{'20ms':new20,'50ms':new50},
			'baselineStats':old_stats,'candidateStats':new_stats}
		report['tests'].append(item)
		print(name,'gold',len(ground),
			'baseEvents',len(old),'candidateEvents',len(new),
			'old20',old20['f1'],'new20',new20['f1'],
			'old50',old50['f1'],'new50',new50['f1'],
			'bias20',(old20['signedBiasMs'],new20['signedBiasMs']),
			flush=True)
		report.setdefault('results',[]).append({
			'name':name,
			'oldF1At20ms':old20['f1'],
			'newF1At20ms':new20['f1'],
			'oldPrecisionAt20ms':old20['precision'],
			'newPrecisionAt20ms':new20['precision'],
			'oldRecallAt20ms':old20['recall'],
			'newRecallAt20ms':new20['recall'],
			'oldBiasMs':old20['signedBiasMs'],
			'newBiasMs':new20['signedBiasMs']})
	return report

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',type=Path,required=True)
	args=p.parse_args()
	if args.out.exists():raise FileExistsError(args.out)
	report=run()
	args.out.parent.mkdir(parents=True,exist_ok=True)
	args.out.write_text(json.dumps(report,indent=2)+'\n')
	print('SYNTHETIC_DIFFERENTIAL_REPORT_CREATED',args.out)
