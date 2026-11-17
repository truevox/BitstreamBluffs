#!/usr/bin/env python3
"""Render REAL separate full-song replacement recordings for 11 biome families.

Private work-in-progress: source-driven note resynthesis is approximate, NOT
artist-approved. Retains all six original source stems independently.
The drums and bass are entirely newly generated, as is the primary featured
Guitar/Piano/Other part. Every mountain voice is also independently rendered.
No time-stretching/filtering of source stems counts as a replacement.
"""
import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path

import numpy as np
import librosa
from scipy.signal import find_peaks, resample_poly
from scipy.ndimage import median_filter

import render_biome_orchestras_v2 as orchestra
from performance_v1 import read as read_performance, verify_origin, verify_melody_audit, to_legacy, STEMS

RATE=48000
SYNTH_RATE=24000
HOP=160
EXTRACT_RATE=16000
BIOMES=orchestra.BIOMES
ROLES=('featured','bass','drums','melody')

def sample_mono(path):
	cmd=['ffmpeg','-v','error','-nostdin','-i',str(path),'-ar',
		str(EXTRACT_RATE),'-ac','1','-f','f32le','pipe:1']
	p=subprocess.run(cmd,capture_output=True,check=True,timeout=210)
	return np.frombuffer(p.stdout,dtype='<f4').copy()

def extract_onsets(y, min_distance=2):
	"""Onset grid is 10ms, with only 20ms refractory period."""
	spec=np.abs(librosa.stft(y,n_fft=1024,hop_length=HOP))
	flux=np.maximum(0,np.diff(np.log1p(spec*20),axis=1))
	strength=np.mean(flux,axis=0)
	if len(strength)<10: raise ValueError('Silent/short stem')
	threshold=float(np.percentile(strength,65))
	peaks,_=find_peaks(strength,distance=min_distance,
		prominence=max(.004,threshold*.20))
	seconds=(peaks+1)*HOP/EXTRACT_RATE
	return seconds,strength,spec

def choose_feature_events(y):
	"""Source-derived polyphonic pitch hypotheses, from actual stem attacks.

	At every source transient, take a few strong independent spectral peaks,
	with overtone suppression. Never invent note events on a fixed beat grid.
	This is experimental; model/stem leakage and harmonics are unverified.
	"""
	onsets,flux,spec=extract_onsets(y)
	freq=np.fft.rfftfreq(1024,1/EXTRACT_RATE)
	events=[]
	for i,sec in enumerate(onsets):
		center=round(sec*EXTRACT_RATE/HOP)
		left=max(0,center)
		right=min(spec.shape[1],center+8)
		if right<=left:continue
		spectrum=np.mean(spec[:,left:right],axis=1)
		peaks,_=find_peaks(spectrum,distance=2)
		peaks=[int(v) for v in peaks if 90<freq[v]<1900]
		peaks=sorted(peaks,key=lambda q:spectrum[q],reverse=True)
		if not peaks: continue
		selected=[]
		for idx in peaks:
			midi=int(round(69+12*math.log2(freq[idx]/440)))
			if not 41<=midi<=91:continue
			if any(abs(midi-m)<3 for m in selected):continue
			# Overtone suppression: don't add the octave when a much
			# stronger fundamental has already been picked.
			if any(abs(midi-m-12)<=1 for m in selected):continue
			selected.append(midi)
			if len(selected)>=2:break
		if not selected:continue
		duration=min(.7,max(.095,(onsets[i+1]-sec)*.85)) if i+1<len(onsets) else .3
		for midi in selected:
			events.append({'midi':midi,'start':round(float(sec),4),
				'end':round(float(sec+duration),4),'confidence':.72,
				'expression':{'estimatedVelocity':83}})
	return events,{'sourceOnsets':len(onsets),'hypothesizedNotes':len(events),
		'minimumOnsetSpacingMs':round(float(np.min(np.diff(onsets))*1000),1)
			if len(onsets)>1 else None}

def choose_bass_events(y):
	"""Estimate bass note fundamentals continuously, without a beat grid."""
	hop=320
	f0=librosa.yin(y.astype('float64'),fmin=38,fmax=320,
		sr=EXTRACT_RATE,hop_length=hop,frame_length=2048,center=True)
	rms=librosa.feature.rms(y=y,hop_length=hop,frame_length=2048)[0]
	n=min(len(f0),len(rms))
	f0=f0[:n];rms=rms[:n]
	threshold=max(.001,float(np.percentile(rms,82))*.15)
	notes=np.rint(librosa.hz_to_midi(np.clip(f0,38,320))).astype('int16')
	notes=median_filter(notes,size=5)
	notes[(rms<threshold)|~np.isfinite(f0)]=-1
	events=[]
	start=None;last=None
	for i,midi in enumerate(np.append(notes,-100)):
		if i<n and midi==last:continue
		if start is not None and last>=0:
			a=start*hop/EXTRACT_RATE
			b=i*hop/EXTRACT_RATE
			if b-a>=.08:events.append({'midi':int(last),
				'start':round(a,4),'end':round(b,4)})
		start=i;last=int(midi)
	return events,{'bassNotes':len(events),'minimumEnergy':round(threshold,6)}

def choose_drum_events(y):
	onsets,flux,spec=extract_onsets(y,min_distance=2)
	freq=np.fft.rfftfreq(1024,1/EXTRACT_RATE)
	out=[]
	for time in onsets:
		i=round(time*EXTRACT_RATE/HOP)
		window=spec[:,i:min(i+5,spec.shape[1])]
		if not window.size:continue
		pow=np.mean(window,axis=1)
		low=float(pow[freq<180].sum())
		mid=float(pow[(freq>=180)&(freq<1900)].sum())
		high=float(pow[freq>=1900].sum())
		kind='kick' if low>mid*1.05 else 'hat' if high>mid*1.2 else 'snare'
		out.append({'t':round(float(time),4),'type':kind})
	return out,{'drumHits':len(out),
		'minimumInterHitMs':round(float(np.min(np.diff(onsets))*1000),2)
			if len(onsets)>1 else None}

def render_notes(events,biome,frames,kind):
	"""Actual separately synthesized notes using the lab's individual
	physical-instrument models; not a filtered original recording."""
	mode=orchestra.CHARACTERS[biome][2]
	out=np.zeros((frames,2),dtype='float32')
	last_bong=-3.
	for index,note in enumerate(events):
		start=float(note['start'])
		end=float(note['end'])
		midi=int(note['midi'])
		if start>=frames/RATE or end<start+.075 or not 35<=midi<=98:
			continue
		pos=round(start*RATE)
		if pos>=frames:continue
		hold=min(2.0,max(.09,end-start))
		rng=np.random.default_rng(orchestra.stable_seed('full-v1',biome,
			kind,index,midi,round(start,3)))
		velocity=87 if kind=='melody' else 73
		voice=orchestra.corrected_note(midi,hold,velocity,mode,rng,'orchestral')
		voice=resample_poly(voice.astype('float32'),2,1)
		n=min(frames-pos,len(voice))
		pan=.5 if kind=='melody' else .28+.44*(index%7)/6
		left=math.cos(pan*math.pi/2)
		right=math.sin(pan*math.pi/2)
		amplitude=.25 if kind=='melody' else .20
		out[pos:pos+n,0]+=voice[:n]*left*amplitude
		out[pos:pos+n,1]+=voice[:n]*right*amplitude
		if kind=='melody' and mode=='holopad' and midi<=80 and start-last_bong>=1.45:
			bong=orchestra.crystal_bong(midi,velocity,rng)
			bong=resample_poly(bong,2,1)
			n=min(len(bong),frames-pos)
			out[pos:pos+n,:]+=bong[:n,None]*.045
			last_bong=start
	return out

def render_bass(events,biome,frames):
	mode=orchestra.CHARACTERS[biome][4]
	out=np.zeros((frames,2),dtype='float32')
	for note in events:
		start=float(note['start']);end=float(note['end'])
		pos=round(start*RATE)
		if pos>=frames or end-start<.06:continue
		freq=440*2**((int(note['midi'])-69)/12)
		if freq>165:freq/=2
		if freq<43:freq*=2
		n=min(round(min(1.5,end-start)*RATE),frames-pos)
		if n<=0:continue
		t=np.arange(n,dtype='float64')/RATE
		p=2*np.pi*freq*t
		s=.8*np.sin(p)
		if mode in ('saw','piston','volcanic','brass'):s+=.3*np.sin(2*p)+.16*np.sin(3*p)
		if mode in ('taffy','analog','pocket'):s+=.2*np.sin(2.01*p)
		if mode in ('liquid','breath','sineglass'):s+=.12*np.sin(.5*p)
		g=np.minimum(1,t/.012)*np.minimum(1,(n/RATE-t)/.12)
		s=(s*g*.135).astype('float32')
		out[pos:pos+n,0]+=s*.74
		out[pos:pos+n,1]+=s*.74
	return out

def render_drums(events,biome,frames):
	"""Entirely newly excited kick/snare/hat/tom sound sources,
	independently synthesized for each biome. 10ms source event grid.
	Original drum recording never enters this function."""
	_,_,_,foley,_=orchestra.CHARACTERS[biome]
	seed=orchestra.stable_seed('drums-full-v1',biome)
	rng=np.random.default_rng(seed)
	out=np.zeros((frames,2),dtype='float32')
	timbre={
		'wood':.35,'scrap':.87,'sistrum':.72,'bubble':.28,'glass':.74,
		'telemetry':.64,'wrapper':.83,'rain':.25,'gear':.9,
		'thimble':.76,'steam':.62,
	}.get(foley,.5)
	for event in events:
		pos=round(float(event['t'])*RATE)
		if not 0<=pos<frames:continue
		kind=event['type']
		duration={'kick':.14,'snare':.105,'hat':.052}.get(kind,.085)
		n=min(frames-pos,round(duration*RATE))
		t=np.arange(n,dtype='float64')/RATE
		if kind=='kick':
			freq=95*(1+t*25)**-.60
			s=np.sin(2*np.pi*np.cumsum(freq)/RATE)*np.exp(-t/0.055)
			s+=.10*rng.standard_normal(n)*np.exp(-t/.003)
			s*=.4
		else:
			noise=rng.standard_normal(n)
			tone=390+1250*timbre if kind=='snare' else 2400+2800*timbre
			s=(noise*(.24+.5*timbre)+
				np.sin(2*np.pi*tone*t)*(.8-.25*timbre))
			s*=np.exp(-t/(.026 if kind=='hat' else .048))*.11
		s*=np.minimum(1,t/.0007)
		out[pos:pos+n,0]+=(s*.80).astype('float32')
		out[pos:pos+n,1]+=(s*.72).astype('float32')
	return out

def encode_segments(audio,dest,stem_name,segments):
	"""Sample-exact independent Opus files, never ffmpeg segment muxer.

	Each file starts a NEW encoder so Opus pre-skip and end-granule trimming
	apply to its own exact source frames. Real decoded PCM count MUST match
	the corresponding pack.json segment length, including a partial tail.
	"""
	from opus_exact_segments import encode_exact_segments
	return encode_exact_segments(audio,dest,stem_name,segments,rate=RATE,bitrate='52k')


def run(a):
	if a.out.exists():raise FileExistsError(a.out)
	a.out.mkdir(parents=True)
	roster=json.loads((a.master/'game-stems-manifest.json').read_text())
	catalog=json.loads((a.source_packs/'catalog.json').read_text())
	report={'format':'bitstream-dynamic-orchestra-resynthesis-v1',
		'quality':'experimental, source onset/pitch hypotheses, NOT artist approved',
		'styles':'genuinely new independent biome instrumental recordings, not source FX',
		'songs':{}}
	for track in catalog['tracks']:
		source=next(x for x in roster['tracks'] if x['id']==track['id'])
		manifest=json.loads((a.source_packs/track['manifest']).read_text())
		frames=int(manifest['frameCount'])
		srcstem=source['stem_files'] if source['slot']!=33 else (
			source['grouped_6s']['stemFiles'])
		featured={'FEsxYVStla4':'other','local-one-more-run-bitstream-bluffs':'piano',
			'WRBGQUqD54U':'guitar','FYImnz5-hXs':'other'}[track['id']]
		performance=None
		if a.performance_root:
			performance=read_performance(a.performance_root/Path(track['manifest']).parent/
				'performance.json')
			verify_origin(performance,track['id'],frames,featured,{
				role:a.master/srcstem[role] for role in STEMS})
			verify_melody_audit(performance,
				a.melody_source/Path(track['manifest']).parent/
				'melody-audit-private.json')
			feature_notes=to_legacy(performance,featured)
			bass_notes=to_legacy(performance,'bass')
			drum_notes=to_legacy(performance,'drums')
			melody_notes=to_legacy(performance,'melody')
			fs=bs=ds={'method':'content-addressed-performance-v1'}
			print('LOCKED_SCORE',track['id'],performance['scoreHash'],flush=True)
		else:
			if not a.legacy_direct_extraction:
				raise ValueError('New releases require --performance-root; '
					'legacy direct extraction needs explicit --legacy-direct-extraction')
			print('LEGACY_UNVERSIONED_EXTRACTION',track['id'],flush=True)
			feature_notes,fs=choose_feature_events(sample_mono(a.master/srcstem[featured]))
			bass_notes,bs=choose_bass_events(sample_mono(a.master/srcstem['bass']))
			drum_notes,ds=choose_drum_events(sample_mono(a.master/srcstem['drums']))
			melody_notes=json.loads((a.melody_source/Path(track['manifest']).parent/
				'melody-audit-private.json').read_text())['notes']
		scores={'featured':feature_notes,'bass':bass_notes,'drums':drum_notes,
			'melody':melody_notes}
		relative=Path(track['manifest']).parent
		dest=a.out/relative/'adaptive'
		for biome in BIOMES:
			for role in ROLES:
				if role in ('featured','melody'):
					audio=render_notes(scores[role],biome,frames,role)
				elif role=='bass':
					audio=render_bass(scores[role],biome,frames)
				else:
					audio=render_drums(scores[role],biome,frames)
				names=encode_segments(audio,dest/biome,role,manifest['segments'])
				print('REPERFORM',track['id'],biome,role,
					len(names),'segments',flush=True)
		report['songs'][track['id']]={'featuredStem':featured,
			'noteCounts':{k:len(v) for k,v in scores.items()},
			'extraction':{'featured':fs,'bass':bs,'drums':ds},
			'scoreHash':performance['scoreHash'] if performance else None,
			'biomes':len(BIOMES)}
	(a.out/'private-audit.json').write_text(json.dumps(report,indent=2)+'\n')
	print('TRUE_FULL_SONG_ORCHESTRA_COMPLETE',flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--master',required=True,type=Path)
	p.add_argument('--source-packs',required=True,type=Path)
	p.add_argument('--melody-source',required=True,type=Path)
	p.add_argument('--out',required=True,type=Path)
	group=p.add_mutually_exclusive_group(required=True)
	group.add_argument('--performance-root',type=Path,
		help='Root of immutable versioned performance-v1 song scores')
	group.add_argument('--legacy-direct-extraction',action='store_true',
		help='Historical reproduction ONLY; bypasses canonical score capture')
	run(p.parse_args())
