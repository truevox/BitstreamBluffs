#!/usr/bin/env python3
"""Additive, onset-aware high-speed drum transcription prototype (v3).
At 5.805ms analysis hops, 17.4ms minimum cross-family refractory,
allowing fast roll transients and kick/snare/hat co-hits to coexist.
Original stems and V1/V2 event JSONs are never overwritten.
Source-derived event times are approximate, NOT ground-truth performances.
"""
import argparse
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks

RATE=22050
FFT=1024
HOP=128

def load_excerpt(source,start,seconds):
	p=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error',
		'-ss',str(start),'-i',str(source),'-t',str(seconds),
		'-ac','1','-ar',str(RATE),'-f','f32le','pipe:1'],
		capture_output=True,check=True)
	a=np.frombuffer(p.stdout,dtype='<f4').copy()
	size=int(seconds*RATE)
	return np.pad(a[:size],(0,max(0,size-len(a))))

def analyze(audio,seconds,old_count=None):
	# Attack bands help discriminate kick, snare, metallic hats and co-hits.
	from scipy.ndimage import median_filter
	from scipy.signal import stft
	freq,t,z=stft(audio,fs=RATE,window='hann',nperseg=FFT,
		noverlap=FFT-HOP,padded=True,boundary='zeros')
	spect=np.abs(z)
	flux=np.maximum(0,np.diff(spect,axis=1,prepend=spect[:,:1]))
	bands=((42,170),(170,1700),(1700,5000),(5000,10000))
	band=np.stack([np.sum(flux[(freq>=lo)&(freq<hi),:],axis=0)
		for lo,hi in bands],axis=0)
	# Relative attack intensity + global activity; keep quiet bars from inflating
	# silence-induced normalized spectral novelty.
	total=np.sum(band,axis=0)
	envelope=np.sqrt(np.mean(np.abs(z)**2,axis=0))
	energy_gate=max(.00004,float(np.percentile(envelope,55))*.24)
	normalized=total/np.maximum(np.percentile(total[envelope>energy_gate],70)
		if np.any(envelope>energy_gate) else .00001, .00001)
	# Three-hop (~17.4ms) refractory; preserves fast drum-roll transients.
	# Every coincident peak can still yield up to three drum-family events.
	active_novelty=normalized[envelope>energy_gate]
	peak_floor=.23
	if len(active_novelty):
		peak_floor=max(.23,float(np.percentile(active_novelty,60))*.48)
	peaks,_=find_peaks(normalized,height=peak_floor,
		prominence=.15,distance=max(1,round(.018*RATE/HOP)))
	peaks=[int(i) for i in peaks if envelope[i]>=energy_gate and t[i]<seconds-.005]
	peak_bands=band[:,peaks] if peaks else np.zeros((4,0))
	relative=peak_bands/np.maximum(peak_bands.sum(axis=0),1e-9)
	# Thresholds are source-adaptive: the most characteristic family hits are
	# recognized even when the producer has heavily processed a drum kit.
	events=[]
	for pos,i in enumerate(peaks):
		low,mid,upper,air=(float(x) for x in relative[:,pos])
		power=float(normalized[i])
		high=upper+air
		labels=[]
		if low>=.17 and (low>.26 or low>mid*.85):
			labels.append(('kick',min(1.,low/.42)))
		if mid>=.24 and (mid>.34 or high<.59):
			labels.append(('snare',min(1.,mid/.57)))
		if high>=.27 and (high>.45 or air>.20):
			labels.append(('hat',min(1.,high/.68)))
		# Unlike v1, preserve simultaneous low and high attacks; cap at two
		# families unless strong three-way evidence exists.
		labels.sort(key=lambda x:x[1],reverse=True)
		if len(labels)==3 and min(x[1] for x in labels)<.73:
			labels=labels[:2]
		if not labels:
			labels=[('snare',.32)]
		velocity=int(np.clip(60+19*math.log1p(power)+8*min(1,power/2),52,116))
		for name,score in labels:
			events.append({'t':round(float(t[i]),4),'type':name,
				'velocity':velocity,'confidence':round(float(score),3)})
	events.sort(key=lambda x:(x['t'],x['type']))
	hits={name:sum(x['type']==name for x in events) for name in
		('kick','snare','hat')}
	unique=len(peaks)
	warnings=[]
	if old_count is not None:
		if unique<old_count*.35:
			warnings.append('v2_much_fewer_onsets_than_v1')
		if unique>old_count*2.2:
			warnings.append('v2_many_more_onsets_than_v1')
	if not unique:
		warnings.append('no_onsets_detected')
	if len(events)>seconds*30:
		warnings.append('implausibly_many_events')
	quality={'candidateOnsetPeaks':unique,'eventsByType':hits,
		'eventCount':len(events),'simultaneousExtraHits':len(events)-unique,
		'sampleEnergyGate':round(energy_gate,8),
		'analysisHopMs':round(1000*HOP/RATE,3),
		'globalMinPeakSeparationMs':round(1000*max(1,round(.018*RATE/HOP))*HOP/RATE,3),
		'v1SourceHitCount':old_count,'warnings':warnings,
		'notes':'Thresholds source-adaptive; a hit type and even onset may be wrong.'}
	return events,quality

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--source',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--start',type=float,required=True)
	p.add_argument('--seconds',type=int,default=32)
	p.add_argument('--v1-count',type=int)
	a=p.parse_args()
	if a.out.exists():
		raise SystemExit('Do not overwrite existing percussion draft: '+str(a.out))
	if not a.source.is_file():
		raise SystemExit('Missing source: '+str(a.source))
	audio=load_excerpt(a.source,a.start,a.seconds)
	events,quality=analyze(audio,a.seconds,a.v1_count)
	report={'schemaVersion':3,'method':'High resolution 5.805ms multi-band spectral-flux onsets with <=20ms separation and co-hits',
		'source':str(a.source),'startSeconds':a.start,
		'lengthSeconds':a.seconds,'events':events,'qa':quality,
		'status':'unapproved V3 high-speed drum score candidate; not ground truth or production music'}
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('DRUMS_V3',a.out,'onsets',quality['candidateOnsetPeaks'],
		'events',quality['eventCount'],'types',quality['eventsByType'],
		'warnings',quality['warnings'],flush=True)

if __name__=='__main__':
	main()
