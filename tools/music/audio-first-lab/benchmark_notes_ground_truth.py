#!/usr/bin/env python3
"""Known-note SoundFont benchmark for legacy FFT vs Basic Pitch V2.
Synthetic GM only; passing this does not prove real stem musical accuracy.
All generated media and model outputs remain in a private directory.
"""
import argparse
import json
import math
import wave
from pathlib import Path
import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.signal import resample_poly
from sf2_melody_v2 import Synth, RATE
from extract_polyphonic_guitar import decode

PATCHES={'guitar':{'nylon':24,'distorted':30},
	'piano':{'grand':0,'rhodes':4},
	'other':{'square_synth':80,'pad':88}}
SECONDS=16

def notes_for(role,pattern):
	base={'guitar':52,'piano':60,'other':56}[role]
	events=[]
	starts=np.arange(.5,12,.60) if pattern=='melody' else np.arange(.5,12,1.2)
	for k,t in enumerate(starts):
		if pattern=='melody':
			n=base+[0,2,5,7,4,9,7,5,2,0,4,7,9][k%13]
			events.append({'midi':int(n),'start':round(float(t),3),
				'end':round(float(t+.36+(k%3)*.07),3),
				'velocity':int(58+(k*9)%54)})
		else:
			for j,step in enumerate([0,4,7] if k%3 else [0,3,7,10]):
				if j==3 and role=='guitar':continue
				events.append({'midi':int(base+step+2*(k%3)),
					'start':round(float(t+j*.012),3),
					'end':round(float(t+.80-j*.04),3),
					'velocity':int(63+(k*7+j*8)%51)})
	return events

def render(events,program,file):
	if file.exists():
		raise FileExistsError(file)
	synth=Synth(program)
	frames=RATE*SECONDS
	y=np.zeros(frames,dtype=np.float32)
	actions=[]
	for row in events:
		a=int(round(row['start']*RATE))
		b=int(round(row['end']*RATE))
		actions.extend([(a,1,row['midi'],row['velocity']),
			(b,0,row['midi'],row['velocity'])])
	actions.sort(key=lambda x:(x[0],x[1]))
	cursor=0
	try:
		for start in range(0,frames,480):
			while cursor<len(actions) and actions[cursor][0]<=start:
				_,on,note,vel=actions[cursor]
				if on:synth.note_on(synth.ptr,0,note,vel)
				else:synth.note_off(synth.ptr,0,note)
				cursor+=1
			count=min(480,frames-start)
			y[start:start+count]=synth.render(count)
	finally:
		synth.close()
	peak=float(np.max(np.abs(y)))
	if peak>.95:y*=.95/peak
	with wave.open(str(file),'wb') as w:
		w.setnchannels(1);w.setsampwidth(2);w.setframerate(RATE)
		w.writeframes((y*32767).astype('<i2').tobytes())
	return y

def match(truth,candidates,onset_limit=.125):
	if not truth:
		return {'tp':0,'fp':len(candidates),'fn':0,'precision':0,'recall':1,'f1':0}
	if not candidates:
		return {'tp':0,'fp':0,'fn':len(truth),'precision':0,'recall':0,'f1':0}
	penalty=np.full((len(truth),len(candidates)),1e4)
	for i,a in enumerate(truth):
		for j,b in enumerate(candidates):
			onset=abs(a['start']-b['start'])
			if int(a['midi'])==int(b['midi']) and onset<=onset_limit:
				penalty[i,j]=onset
	rows,cols=linear_sum_assignment(penalty)
	good=[(i,j) for i,j in zip(rows,cols) if penalty[i,j]<1e4]
	tp=len(good)
	precision=tp/max(1,len(candidates))
	recall=tp/len(truth)
	off=[abs(truth[i]['end']-candidates[j]['end']) for i,j in good]
	return {'tp':tp,'fp':len(candidates)-tp,'fn':len(truth)-tp,
		'precision':round(precision,4),'recall':round(recall,4),
		'f1':round(2*precision*recall/max(precision+recall,1e-9),4),
		'onsetMeanErrorMs':round(float(np.mean([penalty[i,j] for i,j in good]))*1000,2)
			if good else None,
		'offsetMeanErrorMs':round(float(np.mean(off))*1000,2) if good else None}

def score_case(role,patch,pattern,out):
	from basic_pitch.inference import predict
	from basic_pitch import ICASSP_2022_MODEL_PATH
	events=notes_for(role,pattern)
	name=f'{role}-{patch}-{pattern}'
	wav=out/(name+'.wav')
	samples=render(events,PATCHES[role][patch],wav)
	# Existing decoder expects 11.025 kHz mono; use fixed source-clock resample.
	legacy=decode(resample_poly(samples,147,640).astype('float32'))
	_,_,pred=predict(wav,ICASSP_2022_MODEL_PATH,
		onset_threshold=.48,frame_threshold=.28,
		minimum_note_length=95,minimum_frequency=60,maximum_frequency=1500)
	new=[]
	for start,end,pitch,amplitude,*_ in pred:
		if end-start>=.095:
			new.append({'midi':int(pitch),'start':round(float(start),3),
				'end':round(float(end),3),'confidence':round(float(amplitude),3)})
	scores={'fft_v1':match(events,legacy['events']),
		'basic_pitch_v2':match(events,new)}
	(out/(name+'.json')).write_text(json.dumps({
		'case':name,'truth':events,'fft_v1':legacy['events'],
		'basic_pitch_v2':new,'scores':scores},indent=2)+'\n')
	print('NOTES_BENCH_CASE',name,'true',len(events),
		'fft_f1',scores['fft_v1']['f1'],'basic_f1',scores['basic_pitch_v2']['f1'],
		flush=True)
	return {'name':name,'role':role,'patch':patch,'pattern':pattern,
		'truthNotes':len(events),'scores':scores}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--roles',default='guitar,piano,other')
	p.add_argument('--patterns',default='melody,chords')
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Private benchmark dir already exists: '+str(a.out))
	a.out.mkdir(parents=True,exist_ok=False)
	cases=[]
	for role in a.roles.split(','):
		for name in PATCHES[role]:
			for pattern in a.patterns.split(','):
				cases.append(score_case(role,name,pattern,a.out))
	averages={}
	for role in a.roles.split(','):
		items=[x for x in cases if x['role']==role]
		averages[role]={method:round(float(np.mean(
			[x['scores'][method]['f1'] for x in items])),4)
			for method in ('fft_v1','basic_pitch_v2')}
	doc={'schemaVersion':1,'type':'known-MIDI synthetic benchmark',
		'onsetMatchToleranceMs':125,'sampleRateHz':RATE,
		'secondsPerSample':SECONDS,'cases':cases,'meanF1ByFamily':averages,
		'limitations':['GM SoundFont synthetic performances, not original stems',
			'No claim of real-source note accuracy or musical endorsement',
			'One simple onset window; chord, tuning and playing variations limited',
			'Sustain tails and resonances may produce extra acoustic note triggers']}
	(a.out/'benchmark-results.json').write_text(json.dumps(doc,indent=2)+'\n')
	print('NOTES_BENCH_COMPLETE',len(cases),averages,flush=True)

if __name__=='__main__':
	main()
