#!/usr/bin/env python3
"""Monophonic source-bass F0 / onset extraction for proof only (NOT final notes)."""
import numpy as np,json,subprocess,sys
from pathlib import Path
RATE=16000
HOP=160
WIN=2048
FFT=4096
def source(path,start,duration=32):
	p=subprocess.run(['ffmpeg','-v','error','-i',str(path),'-ss',str(start),'-t',str(duration),
																			'-ac','1','-ar',str(RATE),'-f','f32le','-'],
																	capture_output=True,check=True)
	x=np.frombuffer(p.stdout,dtype='<f4')
	return np.pad(x,(WIN,WIN))
def analyze(file,start):
	x=source(file,start)
	n=round(32*RATE/HOP)
	spectra=np.empty(n,dtype=np.float32)
	pitches=np.full(n,np.nan,dtype=np.float32)
	activity=np.zeros(n,dtype=bool)
	for i in range(n):
		mid=WIN+i*HOP
		frame=x[mid-WIN//2:mid+WIN//2].astype(np.float64)
		rms=float(np.sqrt(np.mean(frame*frame)))
		spectra[i]=rms
		if rms<.003:continue
		frame=frame*np.hanning(WIN)
		fft=np.fft.rfft(frame,n=FFT)
		ac=np.fft.irfft(np.abs(fft)**2,n=FFT)[:WIN]
		# Bass F0: 42–260 Hz.
		minLag=int(RATE/260)
		maxLag=min(WIN-2,int(RATE/42))
		segment=ac[minLag:maxLag]
		lag=int(np.argmax(segment))+minLag
		goodness=ac[lag]/max(ac[0],1e-10)
		if goodness<.25:continue
		# Prefer coherent lower fundamental if octave below correlation strong.
		if lag*2<maxLag and ac[lag*2]/max(ac[0],1e-10)>.83*goodness:lag*=2
		hz=RATE/lag
		pitches[i]=69+12*np.log2(hz/440)
		activity[i]=True
	# Smooth isolated pitch estimates with short median (no scipy).
	valid=pitches.copy()
	for i in range(4,n-4):
		local=pitches[i-4:i+5]
		local=local[np.isfinite(local)]
		if len(local)>=5:valid[i]=np.median(local)
	notes=[]
	current=None
	# Use 30-ms minimum onset / 90-ms pitch change debounce.
	quantized=np.round(valid)
	i=0
	while i<n:
		if not activity[i] or not np.isfinite(quantized[i]) or spectra[i]<.006:
			if current is not None and i-current['begin']>=8:
				notes.append({'start':current['begin']*.01,'end':i*.01,'midi':int(current['midi'])})
			current=None;i+=1;continue
		note=int(np.clip(quantized[i],28,72))
		if current is None:
			current={'midi':note,'begin':i}
		elif abs(note-current['midi'])>=1:
			upcoming=quantized[i:min(n,i+9)]
			support=np.sum(upcoming==note)
			if support>=6:
				if i-current['begin']>=8:notes.append({'start':current['begin']*.01,'end':i*.01,'midi':int(current['midi'])})
				current={'midi':note,'begin':i}
		i+=1
	if current and n-current['begin']>=8:notes.append({'start':current['begin']*.01,'end':n*.01,'midi':int(current['midi'])})
	# Merge same adjacent notes across tiny gaps.
	merged=[]
	for item in notes:
		if merged and merged[-1]['midi']==item['midi'] and item['start']-merged[-1]['end']<.09:
			merged[-1]['end']=item['end']
		else:merged.append(item)
	return {'notes':merged,'coverage':round(sum(z['end']-z['start'] for z in merged)/32,3),
		'f0MedianMIDI':float(np.nanmedian(valid)),'voiced':int(np.isfinite(valid).sum()),
		'rmsMedian':float(np.median(spectra))}
if __name__=='__main__':
	opts=[
	('pope','/root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4/bass.flac',150),
	('one-more-run','/root/bitstream-maxi/launch33/stems/grouped_6s/33_one_more_run/bass.flac',92)]
	for slug,path,start in opts:
		out=analyze(path,start)
		print(slug,'coverage',out['coverage'],'events',len(out['notes']),'median midi',out['f0MedianMIDI'],'voiced',out['voiced'])
		print('first notes',out['notes'][:20])
		target=Path('/root/bitstream-maxi')/(slug+'-bass-extracted-notes-v1.json')
		target.write_text(json.dumps(out,indent=2))
