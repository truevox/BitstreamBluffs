#!/usr/bin/env python3
"""Controlled SoundFont instrument-to-Demucs-bucket probe.
Generate sequential solo performances with known GM instrument programs,
then measure which of the 6 Demucs output buckets contains most energy.
This measures synthetic-domain routing, not real-song instrument identity.
Run after separately invoking htdemucs_6s on generated input.wav.
All media remains private outside Git.
"""
import argparse
import ctypes as ct
import json
import math
import wave
from pathlib import Path
import numpy as np
from scipy.signal import resample_poly
from sf2_melody_v2 import Synth,RATE

OUTPUT_RATE=44100
SEGMENT=3.2
SETUP=[
	('nylon_guitar',24,57,False),
	('acoustic_piano',0,63,False),
	('square_synth',80,69,False),
	('orchestral_strings',48,60,False),
	('church_organ',19,64,False),
	('vibraphone',11,72,False),
	('orchestral_harp',46,67,False),
	('trumpet_brass',56,65,False),
	('choir_aahs',52,61,False),
	('picked_bass',33,43,False),
	('snare_kick_hat',0,36,True),
]
ROLES=('vocals','drums','bass','guitar','piano','other')

def solo(program,base,drum=False):
	frames=int(SEGMENT*RATE)
	synth=Synth(0 if drum else program)
	if drum:
		p=ct.c_void_p;i=ct.c_int
		select=synth.lib.fluid_synth_program_select
		select.restype=i;select.argtypes=[p,i,i,i,i]
		if select(synth.ptr,9,1,128,program)!=0:
			raise ValueError('Percussion patch unavailable')
	notes=[]
	for k,seconds in enumerate((.25,.69,1.13,1.61,2.08,2.54)):
		note=([36,42,38,42,36,46][k] if drum else
			base+[0,4,7,2,9,5][k])
		channel=9 if drum else 0
		notes.extend([(round(seconds*RATE),1,note,channel),
			(round((seconds+(.09 if drum else .34))*RATE),0,note,channel)])
	notes.sort(key=lambda x:(x[0],x[1]))
	y=np.zeros(frames,dtype=np.float32)
	cursor=0
	try:
		for begin in range(0,frames,480):
			while cursor<len(notes) and notes[cursor][0]<=begin:
				_,on,note,ch=notes[cursor]
				if on:synth.note_on(synth.ptr,ch,note,87)
				else:synth.note_off(synth.ptr,ch,note)
				cursor+=1
			num=min(480,frames-begin)
			y[begin:begin+num]=synth.render(num)
	finally:
		synth.close()
	return y

def prepare(out):
	if out.exists():
		raise FileExistsError('Refuse existing output: '+str(out))
	out.mkdir(parents=True,exist_ok=False)
	clips=[]
	for name,program,base,drum in SETUP:
		wav=solo(program,base,drum)
		rms=float(np.sqrt(np.mean(wav.astype('float64')**2)))
		if rms<1e-6:raise ValueError('Silent instrument '+name)
		wav=wav*(.08/rms)
		clips.append(wav)
	frames=sum(len(x) for x in clips)
	combined=np.concatenate(clips)
	peak=float(np.max(np.abs(combined)))
	if peak>.90:combined*=.90/peak
	y=resample_poly(combined,147,160).astype(np.float32)
	stereo=np.stack((y,y),axis=1)
	infile=out/'known-instrument-probe.wav'
	with wave.open(str(infile),'wb') as writer:
		writer.setnchannels(2);writer.setsampwidth(2)
		writer.setframerate(OUTPUT_RATE)
		writer.writeframes((np.clip(stereo,-.97,.97)*32767).astype('<i2').tobytes())
	meta={'schemaVersion':1,'source':'original synthetic GM SoundFont notes',
		'input':str(infile),'sampleRate':OUTPUT_RATE,
		'segmentSeconds':SEGMENT,'segments':[
			{'name':name,'program':p,'baseMidi':base,
				'start':round(i*SEGMENT,3),'end':round((i+1)*SEGMENT,3)}
			for i,(name,p,base,drum) in enumerate(SETUP)],
		'warning':'Synthetic solo-per-instrument examples are not representative of full polyphonic commercial mixes.'}
	(out/'sources.json').write_text(json.dumps(meta,indent=2)+'\n')
	print('KNOWN_INSTRUMENT_PROBE',infile,len(meta['segments']),
		'segments','seconds',round(len(y)/OUTPUT_RATE,2),'peak',round(peak,4))
	return infile

def analyze(out,demucs):
	import soundfile as sf
	meta=json.loads((out/'sources.json').read_text())
	stems={}
	for role in ROLES:
		path=demucs/(role+'.wav')
		if not path.is_file():raise FileNotFoundError(path)
		y,rate=sf.read(str(path),dtype='float32')
		if rate!=OUTPUT_RATE:raise ValueError(f'Unexpected sample rate: {rate}')
		stems[role]=y.mean(axis=1) if y.ndim==2 else y
	results=[]
	for segment in meta['segments']:
		start=round((segment['start']+.18)*OUTPUT_RATE)
		end=round((segment['end']-.30)*OUTPUT_RATE)
		energies={role:float(np.mean(stems[role][start:end].astype('float64')**2))
			for role in ROLES}
		total=max(sum(energies.values()),1e-12)
		fractions={role:round(value/total,4) for role,value in energies.items()}
		winner=max(fractions,key=fractions.get)
		results.append({**segment,'dominantStem':winner,'energyFractions':fractions})
	doc={'schemaVersion':1,'model':'htdemucs_6s','source':'known synthetic GM SoundFont',
		'outputs':str(demucs),'segments':results,
		'limitations':[
			'Energy fractions are solo-input routing diagnostics, not clean separation measurements.',
			'Instrument energy may be spread over multiple buckets, and sums can overlap.',
			'Real songs contain blended instruments, processing, effects and phase relationships.',
			'Results do not prove that a specific real-song stem contains any particular instrument.']}
	target=out/'bucket-results.json'
	if target.exists():raise FileExistsError(target)
	target.write_text(json.dumps(doc,indent=2)+'\n')
	for row in results:
		top=sorted(row['energyFractions'].items(),key=lambda x:-x[1])[:3]
		print('KNOWN_BUCKET',row['name'],row['dominantStem'],top,flush=True)
	print('BUCKET_PROBE_COMPLETE',len(results),target,flush=True)

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--analyze',type=Path,help='Existing Demucs output song folder')
	a=p.parse_args()
	if a.analyze:analyze(a.out,a.analyze)
	else:prepare(a.out)

if __name__=='__main__':
	main()
