#!/usr/bin/env python3
"""Audio-only experimental POLYPHONIC guitar chord/riff transcription.
FFT harmonic dictionary + sparse nonnegative pursuit; no machine learning,
no external checkpoint weights, no game engine or MIDI source assumptions.
All outputs MUST receive ear validation; chord leakage/octaves are expected.
"""
import json,subprocess,sys
from pathlib import Path
import numpy as np

SAMPLE_RATE=11025
HOP=256
WINDOW=4096
MIN_MIDI=43
MAX_MIDI=88

def load(path,start=4.5,seconds=32):
	p=subprocess.run([
		'ffmpeg','-hide_banner','-loglevel','error','-nostdin',
		'-ss',str(start),'-i',str(path),'-t',str(seconds),
		'-ac','1','-ar',str(SAMPLE_RATE),'-f','f32le','pipe:1'
	],capture_output=True,check=True)
	audio=np.frombuffer(p.stdout,dtype='<f4')
	if len(audio)<SAMPLE_RATE*seconds:
		audio=np.pad(audio,(0,SAMPLE_RATE*seconds-len(audio)))
	return audio

def dictionary():
	freqs=np.fft.rfftfreq(WINDOW,1/SAMPLE_RATE)
	templates=[]
	for midi in range(MIN_MIDI,MAX_MIDI+1):
		f0=440*2**((midi-69)/12)
		t=np.zeros(len(freqs),dtype=np.float64)
		for harmonic in range(1,11):
			at=f0*harmonic
			if at>=SAMPLE_RATE/2:break
			weight=1/harmonic**1.1
			width=max(2.4,at*.012)
			t+=weight*np.exp(-.5*((freqs-at)/width)**2)
		# Whiten note templates at high frequency, suppress root harmonics.
		t/=np.sqrt(np.sum(t*t)+1e-12)
		templates.append(t)
	return np.stack(templates,axis=1)

def spectrogram(audio):
	audio=np.pad(audio,(WINDOW//2,WINDOW//2))
	steps=(len(audio)-WINDOW)//HOP+1
	s=np.empty((WINDOW//2+1,steps),dtype=np.float32)
	win=np.hanning(WINDOW).astype(np.float32)
	for i in range(steps):
		frame=audio[i*HOP:i*HOP+WINDOW]
		s[:,i]=np.abs(np.fft.rfft(frame*win))
	return s

def decode(audio):
	spect=spectrogram(audio)
	# Temporal source-adaptive whitening avoids choosing louder fundamentals
	# just because they have strong pure-sine energy.
	average=np.maximum(np.percentile(spect,62,axis=1),.005)
	weight=1/np.sqrt(average+.009)
	weight[:38]=0
	templates=dictionary()*weight[:,None]
	templates/=np.maximum(np.sqrt((templates*templates).sum(axis=0)),1e-5)[None,:]
	observed=(spect*weight[:,None])
	observed/=np.maximum(np.sqrt((observed*observed).sum(axis=0)),1e-5)[None,:]
	score=templates.T@observed
	gram=templates.T@templates
	# Nonnegative pursuit in a strongly correlated harmonic dictionary.
	weights=np.maximum(score-.24,0)
	for _ in range(24):
		weights*=np.maximum(score-.085,0)/(gram@weights+.018+1e-7)
		weights=np.minimum(weights,3.)
	# prune 3 max concurrent pitches, robust to note competition
	energy=np.sqrt(np.mean(spect*spect,axis=0))
	mask=np.zeros_like(weights,dtype=bool)
	for i in range(weights.shape[1]):
		if energy[i]<max(.005, np.percentile(energy,35)*.55):continue
		v=weights[:,i]
		best=float(v.max())
		if best<.13:continue
		indices=np.argsort(v)[-4:]
		for j in indices:
			if v[j]>.16 and v[j]>best*.27:
				mask[j,i]=True
	# suppress incomplete one or two-frame transients and join tiny gaps
	for j in range(len(mask)):
		row=mask[j]
		for i in range(1,len(row)-2):
			if row[i-1] and not row[i] and row[i+1]:
				row[i]=True
		start=None
		for i in range(len(row)+1):
			on=(i<len(row) and row[i])
			if on and start is None:start=i
			if not on and start is not None:
				if (i-start)*HOP/SAMPLE_RATE<.11:
					row[start:i]=False
				start=None
	events=[]
	for idx,row in enumerate(mask):
		start=None
		for i in range(len(row)+1):
			on=(i<len(row) and row[i])
			if on and start is None:start=i
			if not on and start is not None:
				onset=round(max(0,start*HOP/SAMPLE_RATE-.018),3)
				offset=round(min(32,i*HOP/SAMPLE_RATE-.018),3)
				if offset-onset>.10:
					events.append({'midi':MIN_MIDI+idx,
						'start':onset,'end':offset,
						'confidence':round(float(np.mean(weights[idx,start:i])),3)})
				start=None
	events.sort(key=lambda e:e['start'])
	return {
		'rate':SAMPLE_RATE,
		'source':'experimental sparse spectral transcription of separated guitar stem',
		'minMidi':MIN_MIDI,'maxMidi':MAX_MIDI,
		'events':events,
		'coveredSeconds':round(float(np.any(mask,axis=0).sum()*HOP/SAMPLE_RATE),2),
		'notesCount':len(events),
		'polyphonyMax':int(np.max(mask.sum(axis=0))),
	}

def main():
	import argparse
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('input',type=Path,help='Original separated source stem')
	p.add_argument('output',type=Path,help='Private note-event JSON')
	p.add_argument('--start',type=float,default=4.5,help='Excerpt offset in full song')
	p.add_argument('--seconds',type=int,default=32)
	a=p.parse_args()
	infile=a.input
	outfile=a.output
	assert infile.is_file()
	assert a.seconds==32,'Currently 32-second passages only'
	notes=decode(load(infile,a.start,a.seconds))
	notes['excerptStartSeconds']=a.start
	notes['sourceStem']=str(infile)
	outfile.write_text(json.dumps(notes,indent=2)+'\n')
	print('EXTRACTED',notes['notesCount'],'events',notes['coveredSeconds'],'seconds',
		'peak_polyphony',notes['polyphonyMax'],flush=True)
	print('SAMPLE',notes['events'][:24],flush=True)

if __name__=='__main__':main()
