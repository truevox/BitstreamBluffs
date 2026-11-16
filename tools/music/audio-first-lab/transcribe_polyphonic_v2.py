#!/usr/bin/env python3
"""Alternative, ADDITIVE transcription via local Basic Pitch inference.
Never replace the older FFT decoder or audio. Report source-chroma agreement as
a *proxy*, NOT verified ground-truth note accuracy or musical approval.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

def extract_excerpt(src,start,seconds,dst):
	subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin',
		'-ss',str(start),'-i',str(src),'-t',str(seconds),'-ac','1',
		'-ar','22050','-acodec','pcm_s16le','-y',str(dst)],check=True)

def chroma_proxy(wav,events,seconds):
	"""Quantify same-time pitch-class evidence, not audio/performance accuracy."""
	import librosa
	audio,sr=librosa.load(str(wav),sr=11025,mono=True)
	hop=256
	chroma=librosa.feature.chroma_stft(y=audio,sr=sr,n_fft=4096,
		hop_length=hop,tuning=0)
	chroma=np.maximum(chroma,0)
	# Chroma may have strong source harmonics and cannot resolve note octaves.
	predicted=np.zeros_like(chroma)
	for note in events:
		a=int(max(0,float(note['start']))*sr/hop)
		b=int(min(seconds,float(note['end']))*sr/hop)
		if b>a:
			predicted[int(note['midi'])%12,a:b]=1
	energy=np.max(chroma,axis=0)
	active=energy>.10
	observed=(chroma>.62*np.maximum(energy[None,:],.01))
	support=predicted.astype(bool)&observed
	pred_count=int(np.sum(predicted.astype(bool)&active[None,:]))
	observed_count=int(np.sum(observed&active[None,:]))
	supported=int(np.sum(support&active[None,:]))
	norm=np.maximum(np.linalg.norm(chroma,axis=0),.0001)
	normalized=chroma/norm[None,:]
	q=np.sum(normalized*predicted,axis=0)/np.maximum(
		np.linalg.norm(predicted,axis=0),1)
	playing=(predicted.sum(axis=0)>0)&active
	return {'name':'source_chroma_pitchclass_proxy','notes':len(events),
		'activeFrames':int(np.sum(active)),
		'meanActiveCosine':round(float(np.mean(q[playing])),4) if np.any(playing) else 0.,
		'pitchClassSupportPrecision':round(supported/max(pred_count,1),4),
		'pitchClassSupportRecall':round(supported/max(observed_count,1),4),
		'warning':'Proxy only: same source harmonics and overlapping instruments can inflate scores; it cannot establish correct pitches, octaves, attacks or timbre.'}

def normalize_notes(note_events,seconds):
	events=[]
	for start,end,pitch,amplitude,*_ in note_events:
		start=max(0.,float(start));end=min(float(seconds),float(end))
		if end-start<.095 or pitch<30 or pitch>105:
			continue
		events.append({'midi':int(pitch),'start':round(start,3),
			'end':round(end,3),'confidence':round(float(np.clip(amplitude,.20,1)),3)})
	events.sort(key=lambda e:(e['start'],e['midi']))
	return events

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('input',type=Path)
	p.add_argument('output',type=Path,help='NEW file; existing transcription is immutable')
	p.add_argument('--role',choices=['guitar','piano','other'],required=True)
	p.add_argument('--start',type=float,required=True)
	p.add_argument('--seconds',type=int,default=32)
	p.add_argument('--legacy',type=Path,help='Optional OLD decoder note JSON for proxy comparison')
	p.add_argument('--onset-threshold',type=float,default=.48)
	p.add_argument('--frame-threshold',type=float,default=.28)
	a=p.parse_args()
	if a.output.exists():
		raise SystemExit('Refusing overwrite of note candidates: '+str(a.output))
	if not a.input.is_file():
		raise SystemExit('Missing stem: '+str(a.input))
	import librosa
	from basic_pitch.inference import predict
	from basic_pitch import ICASSP_2022_MODEL_PATH
	with tempfile.TemporaryDirectory(prefix='bb-poly2-') as work:
		wav=Path(work)/'excerpt.wav'
		extract_excerpt(a.input,a.start,a.seconds,wav)
		output,midi,notes=predict(wav,ICASSP_2022_MODEL_PATH,
			onset_threshold=a.onset_threshold,frame_threshold=a.frame_threshold,
			minimum_note_length=95,minimum_frequency=librosa.midi_to_hz(30),
			maximum_frequency=librosa.midi_to_hz(105))
		events=normalize_notes(notes,a.seconds)
		metric=chroma_proxy(wav,events,a.seconds)
		legacy_metric=None
		if a.legacy:
			legacy=json.loads(a.legacy.read_text())
			legacy_metric=chroma_proxy(wav,legacy['events'],a.seconds)
	report={'schemaVersion':2,'method':'Basic Pitch ICASSP 2022 TFLite',
		'role':a.role,'sourceStem':str(a.input),
		'sourceSizeBytes':a.input.stat().st_size,
		'excerptStartSeconds':a.start,'excerptSeconds':a.seconds,
		'modelPath':str(ICASSP_2022_MODEL_PATH),
		'thresholds':{'onset':a.onset_threshold,'frame':a.frame_threshold},
		'notesCount':len(events),'events':events,
		'diagnostic':{'candidate':metric,'previous':legacy_metric},
		'status':'unapproved transcription candidate; ear-check before promotion'}
	a.output.parent.mkdir(parents=True,exist_ok=True)
	a.output.write_text(json.dumps(report,indent=2)+'\n')
	print('BASIC_PITCH_V2',a.role,len(events),'chroma_proxy',metric,
		'previous',legacy_metric,'saved',a.output,flush=True)

if __name__=='__main__':
	main()
