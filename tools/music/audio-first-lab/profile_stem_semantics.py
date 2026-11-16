#!/usr/bin/env python3
"""Instrument-agnostic profiling of ALL six output stems and original 11 raw stems.
Spectral signatures/cross-stem similarity are screening signals, NOT reliable
instrument labels or proof of separation leakage.
"""
import argparse
import concurrent.futures
import json
import math
import subprocess
from pathlib import Path
import numpy as np
from scipy.signal import stft

ROLES=('vocals','drums','bass','guitar','piano','other')
RATE=11025
WINDOW=2048
HOP=256

def excerpt(path,start,seconds=3):
	p=subprocess.run(['ffmpeg','-v','error','-nostdin','-ss',str(start),
		'-i',str(path),'-t',str(seconds),'-ac','1','-ar',str(RATE),
		'-f','f32le','pipe:1'],capture_output=True,check=True,timeout=35)
	y=np.frombuffer(p.stdout,dtype='<f4').copy()
	n=round(seconds*RATE)
	return np.pad(y[:n],(0,max(0,n-len(y))))

def signature(y):
	f,t,s=stft(y,fs=RATE,nperseg=WINDOW,noverlap=WINDOW-HOP,
		boundary=None,padded=False)
	a=np.abs(s)
	power=a*a
	energy=np.sum(power,axis=0)
	good=energy>max(1e-12,float(np.percentile(energy,75))*.004)
	if not np.any(good):
		return {'rmsDb':-120,'activeFraction':0,'flatness':1,
			'centroidHz':0,'lowEnergyFraction':0,'highEnergyFraction':0,
			'attackDensityPerSecond':0,'pitchConcentration':0},np.zeros(32)
	used=a[:,good]
	rms=np.sqrt(np.mean(y.astype('float64')**2))
	centroid=np.sum(used*f[:,None])/max(np.sum(used),1e-9)
	flatness=np.exp(np.mean(np.log(np.maximum(used,1e-9)),axis=0))/np.maximum(
		np.mean(used,axis=0),1e-8)
	low=np.sum(power[(f>40)&(f<250)])/max(np.sum(power),1e-9)
	high=np.sum(power[f>2800])/max(np.sum(power),1e-9)
	flux=np.sum(np.maximum(0,np.diff(a,axis=1)),axis=0)
	flux=flux/max(np.percentile(flux,85),1e-8)
	onsets=int(np.sum((flux[1:-1]>.4)&(flux[1:-1]>flux[:-2])&
		(flux[1:-1]>=flux[2:])))
	# Spectral timbre coarse histogram, not instrument class.
	bins=np.geomspace(50,RATE*.49,33)
	vector=np.array([np.sum(power[(f>=lo)&(f<hi)]) for lo,hi in
		zip(bins[:-1],bins[1:])],dtype=float)
	vector=np.log1p(vector*10000)
	vector=vector/np.maximum(np.linalg.norm(vector),1e-8)
	# Chromatic energy concentration; high values can come from any pitched
	# instrument and some structured percussion.
	f0=f[(f>=60)&(f<5000)]
	p0=np.mean(power[(f>=60)&(f<5000)],axis=1)
	midis=np.rint(69+12*np.log2(f0/440)).astype(int)
	chroma=np.bincount(midis%12,weights=p0,minlength=12)
	pitch=float(np.sum(np.sort(chroma)[-3:])/max(np.sum(chroma),1e-9))
	return {'rmsDb':round(20*math.log10(max(rms,1e-9)),2),
		'activeFraction':round(float(np.mean(good)),3),
		'flatness':round(float(np.mean(flatness)),4),
		'centroidHz':round(float(centroid),1),
		'lowEnergyFraction':round(float(low),4),
		'highEnergyFraction':round(float(high),4),
		'attackDensityPerSecond':round(float(onsets/(len(y)/RATE)),3),
		'pitchConcentration':round(pitch,4)},vector

def analyze_one(task):
	slot,role,path,starts=task
	results=[signature(excerpt(path,at)) for at in starts]
	feat=[r[0] for r in results]
	vector=np.mean([r[1] for r in results],axis=0)
	vector=vector/max(np.linalg.norm(vector),1e-9)
	avg={k:round(float(np.mean([x[k] for x in feat])),4) for k in feat[0]}
	return (slot,role),{'path':str(path),'features':avg,
		'perWindow':feat,'signature':np.round(vector,5).tolist()}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--root',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True,help='New private result')
	p.add_argument('--workers',type=int,default=4)
	a=p.parse_args()
	if a.out.exists():
		raise SystemExit('Do not overwrite earlier semantic profile')
	roster=json.loads((a.root/'roster.json').read_text())['tracks']
	tasks=[]
	for item in roster:
		slot=int(item['slot'])
		stemdir=(a.root/'stems/grouped_6s/33_one_more_run') if slot==33 else (
			a.root/'stems/htdemucs_6s'/f"{slot:02}_{item['id']}")
		probe=subprocess.run(['ffprobe','-v','error','-show_entries',
			'format=duration','-of','default=noprint_wrappers=1:nokey=1',
			str(stemdir/'vocals.flac')],capture_output=True,text=True,check=True)
		dur=float(probe.stdout.strip())
		starts=[round(max(0,(dur-3)*fraction),2) for fraction in (.13,.41,.77)]
		for role in ROLES:
			tasks.append((slot,role,stemdir/(role+'.flac'),starts))
		if slot==33:
			for file in sorted((a.root/'stems/original_11s/33_one_more_run').glob('*.wav')):
				tasks.append((slot,'raw:'+file.stem,file,starts))
	with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
		results=dict(pool.map(analyze_one,tasks))
	songs=[]
	for item in roster:
		slot=int(item['slot'])
		parts={role:results[(slot,role)] for role in ROLES}
		similar=[]
		for i,left in enumerate(ROLES):
			for right in ROLES[i+1:]:
				u=np.array(parts[left]['signature'])
				v=np.array(parts[right]['signature'])
				sim=round(float(u@v),4)
				similar.append({'a':left,'b':right,'timbreSimilarity':sim})
		similar.sort(key=lambda x:x['timbreSimilarity'],reverse=True)
		raw={k[1][4:]:v for k,v in results.items() if k[0]==slot and
			k[1].startswith('raw:')}
		# Numeric signatures can be very similar for two intentional
		# instruments playing in unison. Never call high similarity "bleed".
		flags=[]
		for role in ('guitar','piano','other'):
			x=parts[role]['features']
			if x['attackDensityPerSecond']>6 and x['pitchConcentration']<.42:
				flags.append(role+':strong_transient_broadband_signature')
			if x['lowEnergyFraction']>.55 and x['centroidHz']<700:
				flags.append(role+':bass_dominant_signature')
		songs.append({'slot':slot,'title':item['title'],
			'stems':parts,'raw11':raw,'topPairs':similar[:6],
			'heuristicReviewFlags':flags})
	doc={'schemaVersion':1,'method':'sampled spectral signature and multi-family flags',
		'songCount':len(songs),'sampleWindowsPerStem':3,
		'limitations':[
			'Demucs guitar/piano/other are source output buckets, NOT guaranteed instrument identities.',
			'Instrument identification needs independent labels or human review.',
			'Features are short-window heuristics; no machine-rated contamination claim.',
			'Cross-stem spectral similarity may reflect valid same-key accompaniment, not bleed.',
			'Separated multi-instrument tracks cannot be interpreted as unique source instruments.'],
		'songs':songs}
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(doc,indent=2)+'\n')
	print('SEMANTIC_PROFILE',a.out,len(songs),
		'source_stems',len(results),'review_flags',
		sum(len(x['heuristicReviewFlags']) for x in songs),flush=True)
	for x in songs:
		if x['heuristicReviewFlags']:
			print('REVIEW',x['slot'],','.join(x['heuristicReviewFlags']),flush=True)

if __name__=='__main__':
	main()
