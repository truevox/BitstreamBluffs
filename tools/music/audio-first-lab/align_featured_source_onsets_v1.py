#!/usr/bin/env python3
"""Conservative, reversible, source-transient-guided timing candidate.

Keep identical Basic Pitch pitch classes/velocities and note count.
Only move polyphonic onset *clusters* when a clear original-stem
spectral attack provides evidence, with max 45ms movement.
Do not assume nearest audio transient is ground truth. No quantization.
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks

RATE=22050
HOP=128
WINDOW=1024
SECONDS=32

def read_stem(path,start):
	raw=subprocess.run([
		'ffmpeg','-v','error','-nostdin','-ss',str(start),'-i',str(path),
		'-t',str(SECONDS),'-ar',str(RATE),'-ac','1','-f','f32le','pipe:1',
	],capture_output=True,check=True,timeout=90).stdout
	audio=np.frombuffer(raw,dtype='<f4').copy()
	size=RATE*SECONDS
	if len(audio)<size:
		audio=np.pad(audio,(0,size-len(audio)))
	return audio[:size]

def source_transients(y):
	"""Positive log-spectral change in the *isolated* instrument stem."""
	from scipy.signal import stft
	freq,seconds,spectrum=stft(
		y,fs=RATE,nperseg=WINDOW,noverlap=WINDOW-HOP,
		window='hann',boundary='zeros',padded=True)
	mag=np.abs(spectrum).astype('float64')
	# Focus on source attacks, not bass rumble or far upper hiss.
	selected=(freq>=90)&(freq<=8500)
	logspec=np.log1p(mag[selected]*900)
	flux=np.maximum(0,np.diff(logspec,axis=1,prepend=logspec[:,:1]))
	weights=1/np.sqrt(np.maximum(1,np.arange(flux.shape[0],dtype='float64')))
	onsets=np.sum(flux*weights[:,None],axis=0)
	# A modest smoothing kernel limits spurious single FFT-frame spikes.
	onsets=np.convolve(onsets,[.2,.6,.2],mode='same')
	# Source-local attack evidence, avoiding a blunt uniform cutoff.
	height=max(.035,float(np.percentile(onsets,58))*.45)
	prominence=max(.015,float(np.percentile(onsets,65))*.20)
	peaks,info=find_peaks(onsets,height=height,prominence=prominence,distance=3)
	times=seconds[peaks]
	return times,onsets,peaks,info

def onset_clusters(events,gap=.027):
	indices=sorted(range(len(events)),key=lambda i:float(events[i]['start']))
	groups=[]
	for i in indices:
		at=float(events[i]['start'])
		if groups and at-float(events[groups[-1][-1]]['start'])<=gap:
			groups[-1].append(i)
		else:
			groups.append([i])
	return groups

def align_events(events,attack_times,strengths,peaks,stft_s):
	updated=json.loads(json.dumps(events))
	groups=onset_clusters(events)
	corrections=[]
	used_peaks=set()
	for group_index,cluster in enumerate(groups):
		start=float(np.median([events[i]['start'] for i in cluster]))
		if not 0<=start<SECONDS-.1:
			continue
		# Correlation over the original source attack envelope, NOT beat-grid
		# snapping or bulk global movement.
		diffs=attack_times-start
		near=np.array([i for i,diff in enumerate(diffs)
			if abs(diff)<=.047 and i not in used_peaks],dtype=int)
		if not len(near):
			continue
		# Drop weak candidates when there are many competing transients.
		powers=strengths[peaks[near]]
		best=float(np.max(powers))
		# High weighting for close peaks, slight preference for strong attacks.
		scores=powers/(best+.001)-.42*(abs(diffs[near])/.047)
		chosen=int(near[np.argmax(scores)])
		delta=float(diffs[chosen])
		# Already aligned to within 11ms; leave original musician phrasing.
		if abs(delta)<=.011:
			continue
		# Conservative: don't shift a note backward before t=0, or rewrite
		# the harmony/order. Offset end with start to retain duration.
		# Never collapse distinct polyphonic onset groups onto one peak.
		new_start=start+delta
		if group_index>0:
			prev=float(np.median([events[i]['start'] for i in groups[group_index-1]]))
			if new_start<prev+.012:continue
		if group_index+1<len(groups):
			next_start=float(np.median([events[i]['start'] for i in groups[group_index+1]]))
			if new_start>next_start-.012:continue
		if min(float(events[i]['start'])+delta for i in cluster)<0:
			continue
		if max(float(events[i]['end'])+delta for i in cluster)>SECONDS:
			continue
		for i in cluster:
			updated[i]['start']=round(float(events[i]['start'])+delta,4)
			updated[i]['end']=round(float(events[i]['end'])+delta,4)
		used_peaks.add(chosen)
		corrections.append({
			'at':round(start,4),'sourceAttack':round(float(attack_times[chosen]),4),
			'deltaMs':round(delta*1000,1),'noteCount':len(cluster),
			'midi':[int(events[i]['midi']) for i in cluster],
		})
	return updated,corrections,groups

def run(args):
	if args.out.exists():
		raise FileExistsError(args.out)
	old=json.loads(args.events.read_text())
	stem=Path(old['sourceStem'])
	assert stem.is_file(),stem
	assert old['excerptSeconds']==SECONDS
	audio=read_stem(stem,old['excerptStartSeconds'])
	times,strength,peaks,_=source_transients(audio)
	notes,corrections,groups=align_events(old['events'],times,strength,peaks,
		np.arange(len(strength))*HOP/RATE)
	assert len(notes)==len(old['events'])
	for source,target in zip(old['events'],notes):
		assert source['midi']==target['midi']
		assert source.get('expression')==target.get('expression')
		assert abs((source['end']-source['start'])-
			(target['end']-target['start']))<.0003
	report={
		'schemaVersion':4,
		'method':'Conservative clustered source positive-log-STFT attack snapping, max 47ms; not musically quantized',
		'input':str(args.events),'sourceStem':str(stem),
		'excerptStartSeconds':old['excerptStartSeconds'],
		'excerptSeconds':SECONDS,'sourceAttackHopMs':round(HOP/RATE*1000,3),
		'sourcePeakCount':len(peaks),'sourceNoteCount':len(notes),
		'sourceOnsetClusters':len(groups),'correctedClusters':len(corrections),
		'correctedNotes':sum(c['noteCount'] for c in corrections),
		'maxAbsoluteShiftMs':max([abs(c['deltaMs']) for c in corrections],default=0),
		'medianAbsoluteShiftMs':round(float(np.median(
			[abs(c['deltaMs']) for c in corrections])),1) if corrections else 0,
		'corrections':corrections,
		'events':notes,
		'status':'EXPERIMENTAL candidate; transients can belong to other instrument/echo/noise',
		'limitations':[
			'No lost or spurious note events repaired',
			'No chord labeling or human ear verification',
			'Retains original pitch/velocity/duration; not a fully corrected score',
			'An onset aligned to source energy is not necessarily the true pitch attack',
		],
	}
	args.out.parent.mkdir(parents=True,exist_ok=True)
	args.out.write_text(json.dumps(report,indent=2)+'\n')
	print('CONSERVATIVE_ALIGN',args.name,'clusters',len(groups),
		'changed',len(corrections),'noteCount',report['correctedNotes'],
		'medianMs',report['medianAbsoluteShiftMs'],
		'maxMs',report['maxAbsoluteShiftMs'],flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser()
	p.add_argument('--name',required=True)
	p.add_argument('--events',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	run(p.parse_args())
