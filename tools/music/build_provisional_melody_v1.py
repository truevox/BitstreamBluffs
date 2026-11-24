#!/usr/bin/env python3
"""Full-length provisional 4-song melodic voice by model-FREE audio pitch DSP.

This uses librosa YIN on the six-stem *vocals* source; it does NOT reuse any
SheetSage research-weight derivatives. The score is deliberately approximate.
Each 12s encoded voice chunk aligns exactly to its six source stem frames.
The original FLAC/WAV files are only read; the additive files are produced in
a new staging folder and embedded as voice:bitstream-bluffs in pack.json.
"""
import argparse
import json
import subprocess
from pathlib import Path

import librosa
import numpy as np
from scipy.ndimage import median_filter

RATE=48000
EXTRACT_RATE=16000
HOP=160
CORE=('vocals','drums','bass','guitar','piano','other')

def read_mono(path):
	cmd=['ffmpeg','-v','error','-nostdin','-i',str(path),'-ar',str(EXTRACT_RATE),
		'-ac','1','-f','f32le','pipe:1']
	p=subprocess.run(cmd,capture_output=True,check=True,timeout=180)
	return np.frombuffer(p.stdout,dtype='<f4').copy()

def detect(y,expected_duration):
	if len(y)<1000:
		raise ValueError('Empty vocals stem')
	f0=librosa.yin(y.astype('float64'),fmin=95,fmax=1000,sr=EXTRACT_RATE,
		frame_length=2048,hop_length=HOP,center=True, trough_threshold=.15)
	rms=librosa.feature.rms(y=y,frame_length=2048,hop_length=HOP,center=True)[0]
	n=min(len(rms),len(f0))
	rms=rms[:n]
	f0=f0[:n]
	floor=max(.0005,float(np.percentile(rms,83))*.20)
	voiced=(rms>floor)&np.isfinite(f0)&(f0>96)&(f0<990)
	notes=np.rint(librosa.hz_to_midi(np.clip(f0,95,1000))).astype('int16')
	notes=median_filter(notes,size=9)
	notes[~voiced]=-1
	events=[]
	start=None
	last=None
	for i,v in enumerate(np.append(notes,-100)):
		if i<n and v==last:
			continue
		if start is not None and last>=0:
			a=start*HOP/EXTRACT_RATE
			b=min(expected_duration,i*HOP/EXTRACT_RATE)
			if b-a>=.075:
				events.append({'start':round(a,5),'end':round(b,5),
					'midi':int(last)})
		start=i
		last=int(v)
	# Merge same-note runs across short breaks, leave discrete repeated
	# long breaks separate so we do not hide real re-attacks.
	merged=[]
	for e in events:
		if merged and merged[-1]['midi']==e['midi'] and e['start']-merged[-1]['end']<=.045:
			merged[-1]['end']=e['end']
		else:
			merged.append(e)
	if len(merged)<25:
		raise ValueError('Vocal pitch extraction too sparse: '+str(len(merged)))
	return merged,{'frames':n,'rmsFloor':floor,'voicedFraction':float(voiced.mean()),
		'rawDetectedNotes':len(events),'mergedNotes':len(merged)}

def synth(events,frames):
	"""Buzzy-but-gentle source note sequence for LIVE biome filtering."""
	mono=np.zeros(frames,dtype='float32')
	for e in events:
		a=round(e['start']*RATE)
		b=min(frames,round(e['end']*RATE))
		if b-a<32:
			continue
		t=np.arange(b-a,dtype=np.float64)/RATE
		f=440.*2**((e['midi']-69)/12)
		# Some harmonics are essential: sine-only loses its character if
		# the biome UI applies a lowpass/bandpass filter.
		phase=2*np.pi*f*t
		s=.68*np.sin(phase)+.31*np.sin(2*phase)+.17*np.sin(3*phase)
		s+=.10*np.sin(4*phase)
		gate=np.minimum(1,t/.006)*np.minimum(1,(e['end']-e['start']-t)/.023)
		s*=np.clip(gate,0,1)
		mono[a:b]+=(s*.19).astype('float32')
	peak=float(np.max(np.abs(mono)))
	if peak>.74:
		mono*=.74/peak
	return mono

def encode(path,mono,segment,bitrate='64k'):
	start=segment['startFrame']
	stop=start+segment['frames']
	mono_chunk=mono[start:stop]
	if len(mono_chunk)!=segment['frames']:
		raise ValueError('Frame mismatch')
	stereo=np.repeat(mono_chunk[:,None],2,axis=1)
	command=['ffmpeg','-v','error','-nostdin','-y','-f','f32le','-ar',str(RATE),
		'-ac','2','-i','pipe:0','-c:a','libopus','-application','audio',
		'-b:a',bitrate,'-vbr','on',str(path)]
	subprocess.run(command,input=stereo.astype('<f4').tobytes(),
		check=True,capture_output=True,timeout=100)
	if not path.exists() or path.stat().st_size<500:
		raise ValueError('Missing/short voice chunk: '+str(path))

def run(a):
	if a.out.exists():
		raise FileExistsError('Refusing to overwrite '+str(a.out))
	a.out.mkdir(parents=True)
	master=json.loads((a.master/'game-stems-manifest.json').read_text())
	manifest=json.loads((a.pack_source/'catalog.json').read_text())
	report={'format':'bitstream-provisional-melody-v1',
		'extraction':'Model-free librosa YIN isolated vocals; tentative not verified',
		'songs':[]}
	for song in manifest['tracks']:
		info=next(x for x in master['tracks'] if x['id']==song['id'])
		path=a.master/info['stem_files']['vocals'] if info['slot']!=33 else (
			a.master/info['grouped_6s']['stemFiles']['vocals'])
		orig=json.loads((a.pack_source/song['manifest']).read_text())
		if 'voice:bitstream-bluffs' in orig['segments'][0]['sources']:
			raise ValueError('Already contains voice')
		duration=orig['frameCount']/RATE
		samples=read_mono(path)
		events,stats=detect(samples,duration)
		sound=synth(events,orig['frameCount'])
		dirname=Path(song['manifest']).parent
		target=a.out/dirname
		target.mkdir(parents=True,exist_ok=True)
		for idx,segment in enumerate(orig['segments']):
			name=f'{idx:04d}-voice-home.ogg'
			encode(target/name,sound,segment)
		# Keep original source packs unchanged: distribution step copies
		# only this new voice and patches the working public manifests.
		(target/'melody-audit-private.json').write_text(json.dumps({
			'song':song['id'],'duration':duration,'stats':stats,
			'notes':events},indent=2)+'\n')
		report['songs'].append({'id':song['id'],'title':song['title'],
			'duration':duration,'eventCount':len(events),
			'voiceSegments':len(orig['segments']),'statistics':stats})
		print('MELODY_READY',song['id'],'notes',len(events),
			'segments',len(orig['segments']),flush=True)
	(a.out/'private-summary.json').write_text(json.dumps(report,indent=2)+'\n')
	print('FOUR_SONGS_SYNTH_DONE',flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--master',required=True,type=Path)
	p.add_argument('--pack-source',required=True,type=Path)
	p.add_argument('--out',required=True,type=Path)
	run(p.parse_args())
