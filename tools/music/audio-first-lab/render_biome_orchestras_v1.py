#!/usr/bin/env python3
"""PRIVATE, additive 11-biome orchestra audition renderer, two scored songs.

Renders an *integrated arrangement*, never a shallow one-patch solo:
- owner-approved original voice file by biome (Pyramid untouched in source)
- two UNSELECTED original accompaniment stem recordings in full
- musical featured re-performance from source-derived note evidence
  with new procedural modal/FM/resonator synthesis + optional sampled glue
- biome bass with optional new procedural low synthesizer
- original drums (ground) or distinct airborne sampled kit + new foley
- optional original Maxi vocals on a separately controlled listening layer.

Media/masters never mutated; target output must not exist.
Sound choices are ARTISTIC CANDIDATES, not user-approved renditions.
"""
import argparse
import hashlib
import json
import math
import shutil
import subprocess
from pathlib import Path

import numpy as np
from scipy.signal import find_peaks, resample_poly

RATE=48000
SYNTH_RATE=24000
SECONDS=32
FRAMES=RATE*SECONDS
SYNTH_FRAMES=SYNTH_RATE*SECONDS
BIOMES=(
	'debumont','garbage-dump-glacier','pyramid-peak',
	'underwater-mountain','crystal-cavern','space-mountain',
	'candy-cane-canyon','sky-jellyfish-mountain','steampunk-slopes',
	'micro-mountain','vertigo-vents'
)
SONGS={
	'pope':{'featured':'other','notes':'other',
		'title':'Pope Leo Wants the AI Root Password',
		'description':'Other-source featured accompaniment',
		'start':150},
	'one-more-run':{'featured':'piano','notes':'piano',
		'title':'One More Run (The Ballad of Bitstream Bluffs)',
		'description':'Piano-source featured accompaniment',
		'start':92},
}
CHARACTERS={
	'debumont':('Cabin Resonance','hammered warm wood and cabin-string reflections',
		'dulcimer','wood','rounded'),
	'garbage-dump-glacier':('Junkyard Orchestra','tuned scrapyard metal, fractured circuits, cold mechanical grit',
		'scrap','scrap','saw'),
	'pyramid-peak':('Desert Strings','plucked qanun-like wires, dust shakers and deep brass foundations',
		'qanun','sistrum','brass'),
	'underwater-mountain':('Hydroglass Choir','submerged glass bowls, waterphone swells and drifting hydro pulses',
		'hydroglass','bubble','liquid'),
	'crystal-cavern':('Prismatic Holopad','luminous sustained harmonic cushion beneath ringing crystal lead',
		'holopad','glass','sineglass'),
	'space-mountain':('Telemetry Sonata','navigation FM plucks, solar echoes and warm orbital bass',
		'telemetry','telemetry','analog'),
	'candy-cane-canyon':('Candy Counterpoint','toy accordion, rubber-band pizzicato and sharp sugary snaps',
		'toyaccordion','wrapper','taffy'),
	'sky-jellyfish-mountain':('Aeolian Skyloom','wind-harp filaments, suspended chords and breathing sub currents',
		'windharp','rain','breath'),
	'steampunk-slopes':('Clockwork Engine','copper banjo plucks, piston sub-bass and gearwork accents',
		'clockwork','gear','piston'),
	'micro-mountain':('Miniature Mechanism','wind-up kalimba, pocket-chip low notes and thimble rattles',
		'kalimba','thimble','pocket'),
	'vertigo-vents':('Iron Underworld','bowed steel, subterranean sub pulses and volcanic rumbles',
		'bowedsteel','steam','volcanic'),
}

def stable_seed(*values):
	return int(hashlib.sha256('|'.join(map(str,values)).encode()).hexdigest()[:8],16)

def rms(audio):
	return float(np.sqrt(np.mean(np.square(audio.astype('float64')))))

def loudness_match(audio,target,limit=4):
	actual=rms(audio)
	if actual<=1e-8:
		return np.zeros_like(audio)
	return audio * min(limit,target/actual)

def read_audio(path):
	if not path.is_file():
		raise FileNotFoundError(path)
	result=subprocess.run(['ffmpeg','-v','error','-nostdin','-i',str(path),
		'-t',str(SECONDS),'-f','f32le','-ar',str(RATE),
		'-ac','2','pipe:1'],capture_output=True,timeout=110,check=True)
	data=np.frombuffer(result.stdout,dtype='<f4').copy()
	if len(data)%2:
		raise ValueError('Odd stereo sample count: '+str(path))
	data=data.reshape(-1,2)
	if len(data)<FRAMES-1200:
		raise ValueError('Truncated soundtrack: '+str(path))
	if len(data)<FRAMES:
		data=np.pad(data,((0,FRAMES-len(data)),(0,0)))
	return data[:FRAMES]

def write_ogg(path,audio):
	if path.exists():
		raise FileExistsError('Refusing overwrite '+str(path))
	path.parent.mkdir(parents=True,exist_ok=True)
	data=np.asarray(audio,dtype='<f4')
	if data.shape!=(FRAMES,2) or not np.all(np.isfinite(data)):
		raise ValueError('Bad audio shape/values: '+str(path))
	cmd=['ffmpeg','-v','error','-y','-nostdin','-f','f32le',
		'-ar',str(RATE),'-ac','2','-i','pipe:0','-c:a','libopus',
		'-b:a','160k','-vbr','on','-application','audio',str(path)]
	subprocess.run(cmd,input=data.tobytes(),capture_output=True,
		timeout=110,check=True)
	if path.stat().st_size<10000:
		raise ValueError('Suspiciously short audio file: '+str(path))
	return {'bytes':path.stat().st_size,'rms':round(rms(data),5),
		'peak':round(float(np.max(np.abs(data))),5)}

def midi_frequency(note):
	return float(440.0*(2.0**((int(note)-69)/12.0)))

def envelope(times,duration,attack,release):
	attack=max(.003,attack);release=max(.03,release)
	# Let soft instruments breathe even for short detected notes.
	real_end=max(duration,attack+.04)
	growth=np.minimum(1,np.maximum(0,times)/attack)
	decay=np.clip((real_end+release-times)/release,0,1)
	return growth*np.sqrt(decay)

def modal_note(midi,length,velocity,mode,rng):
	rate=SYNTH_RATE
	freq=midi_frequency(midi)
	# All octave movements are intentional voice COLOR, not a claimed
	# change in source harmony; retain pitch class and harmonic role.
	if mode in ('kalimba','telemetry'):
		freq*=2 if freq<220 else 1
	if mode in ('bowedsteel','holopad','hydroglass','windharp') and freq>1100:
		freq/=2
	n=max(2,int(rate*length))
	t=np.arange(n,dtype='float64')/rate
	phase=2*np.pi*freq*t
	if mode=='dulcimer':
		s=(.70*np.sin(phase)+.33*np.sin(2*phase)+.15*np.sin(3*phase))
		s*=np.exp(-t/1.12)
		s+=.07*rng.standard_normal(n)*np.exp(-t/.015)
		env=envelope(t,length-.14,.006,.12)
	elif mode=='scrap':
		s=(.62*np.sin(phase)+.27*np.sin(phase*2.29)+
			.17*np.sin(phase*3.87)+.11*np.sin(phase*5.11))
		s*=np.exp(-t/.61)
		s+=.12*rng.standard_normal(n)*np.exp(-t/.016)
		s*=1+.09*np.sin(2*np.pi*11.7*t)
		env=envelope(t,length-.12,.004,.12)
	elif mode=='qanun':
		s=.75*np.sin(phase)+.33*np.sin(2*phase)+.19*np.sin(3*phase)
		s+=.13*np.sin(phase*1.002)
		s*=np.exp(-t/.84)
		s+=.027*rng.standard_normal(n)*np.exp(-t/.009)
		env=envelope(t,length-.14,.004,.14)
	elif mode=='hydroglass':
		warble=1+.003*np.sin(2*np.pi*2.3*t)
		arg=np.cumsum(freq*warble)/rate*2*np.pi
		s=.68*np.sin(arg)+.23*np.sin(arg*2.02)+.10*np.sin(arg*3.5)
		s+=.10*np.sin(arg*.50)
		env=envelope(t,length-.16,.17,.44)
	elif mode=='holopad':
		s=.60*np.sin(phase)+.22*np.sin(phase*2.002)+.16*np.sin(phase*3)
		s+=.34*np.sin(phase*.5003)
		s*=1+.10*np.sin(2*np.pi*.31*t)
		env=envelope(t,length-.15,.19,.52)
	elif mode=='telemetry':
		index=3.0*np.exp(-t/.17)
		arg=phase+index*np.sin(phase*2.001)
		s=.75*np.sin(arg)+.24*np.sin(phase*.999)
		s*=np.exp(-t/.5)
		env=envelope(t,length-.1,.008,.19)
	elif mode=='toyaccordion':
		s=.62*np.sin(phase)+.24*np.sin(2*phase)+.19*np.sin(3*phase)
		s+=.13*np.sin(phase*1.003)
		s*=1+.09*np.sin(2*np.pi*5.4*t)
		env=envelope(t,length-.07,.045,.12)
	elif mode=='windharp':
		s=.58*np.sin(phase)+.33*np.sin(phase*2.002)+.15*np.sin(phase*3.001)
		s+=.09*rng.standard_normal(n)*np.exp(-t/.1)
		s*=1+.11*np.sin(2*np.pi*.77*t)
		env=envelope(t,length-.2,.25,.50)
	elif mode=='clockwork':
		s=.69*np.sin(phase)+.29*np.sin(phase*2)+.20*np.sin(phase*3)
		s+=.14*np.sin(phase*4.002)
		s*=np.exp(-t/.75)
		s+=.07*rng.standard_normal(n)*np.exp(-t/.011)
		env=envelope(t,length-.1,.006,.17)
	elif mode=='kalimba':
		s=.72*np.sin(phase)+.18*np.sin(phase*2.01)+.13*np.sin(phase*3.002)
		s*=np.exp(-t/.65)
		s+=.05*rng.standard_normal(n)*np.exp(-t/.006)
		env=envelope(t,length-.12,.003,.10)
	elif mode=='bowedsteel':
		arg=phase*(1+.0009*np.sin(2*np.pi*.9*t))
		s=.57*np.sin(arg)+.15*np.sin(arg*2.08)+.09*np.sin(arg*3.24)
		s+=.17*np.sin(phase*.5)
		s*=1+.08*np.sin(2*np.pi*2.1*t)
		env=envelope(t,length-.12,.16,.36)
	else:
		raise ValueError('Unknown instrument: '+mode)
	return (s*env*(velocity/100)*.55).astype('float32')

def render_featured_notes(events,biome):
	_,_,mode,_,_=CHARACTERS[biome]
	out=np.zeros((SYNTH_FRAMES,2),dtype='float32')
	count=0
	rng=np.random.default_rng(stable_seed('featured',biome))
	for i,note in enumerate(events):
		if float(note.get('confidence',1)) < .32:
			continue
		midi=int(note['midi'])
		if midi<37 or midi>98:
			continue
		start=float(note['start'])
		end=float(note['end'])
		if not 0<=start<SECONDS or end-start<.085:
			continue
		attack=round(start*SYNTH_RATE)
		if attack>=SYNTH_FRAMES:continue
		# Sonically rich tails, duration bounded to avoid unmusical smearing.
		duration=min(1.2,max(.14,end-start)+
			(.44 if mode in ('holopad','hydroglass','windharp','bowedsteel') else .20))
		velocity=int(note.get('expression',{}).get('estimatedVelocity',85))
		voice=modal_note(midi,duration,velocity,mode,rng)
		n=min(len(voice),SYNTH_FRAMES-attack)
		pan=float(np.clip(.19+.62*((i*7+int(midi))%11)/10,.1,.9))
		out[attack:attack+n,0]+=voice[:n]*math.cos(pan*math.pi/2)
		out[attack:attack+n,1]+=voice[:n]*math.sin(pan*math.pi/2)
		count+=1
	# Biome-specific acoustic spaces, deliberately modest; never replace pitch.
	if mode in ('holopad','hydroglass','windharp','telemetry'):
		d=int(.18*SYNTH_RATE)
		out[d:,0]+=.18*out[:-d,1].copy()
		out[d:,1]+=.14*out[:-d,0].copy()
	elif mode in ('scrap','clockwork','bowedsteel'):
		d=int(.09*SYNTH_RATE)
		out[d:,1]+=.13*out[:-d,0].copy()
	return resample_poly(out,2,1,axis=0).astype('float32'),count

def render_bass_notes(notes,biome):
	bass_mode=CHARACTERS[biome][4]
	out=np.zeros((SYNTH_FRAMES,2),dtype='float32')
	if bass_mode=='rounded':
		return out
	for entry in notes:
		midi=int(entry.get('midi',36))
		start=float(entry['start'])
		end=float(entry['end'])
		if start>=SECONDS or end<=start or midi<20 or midi>70:
			continue
		attack=max(0,int(start*SYNTH_RATE))
		duration=min(2.6,max(.11,end-start))
		n=min(int(duration*SYNTH_RATE),SYNTH_FRAMES-attack)
		if n<=0:continue
		t=np.arange(n,dtype='float32')/SYNTH_RATE
		f=midi_frequency(midi)
		if f<38:f*=2
		if f>180:f/=2
		arg=2*np.pi*f*t
		env=np.minimum(1,t/.025)*np.clip((duration-t)/.11,0,1)
		if bass_mode in ('breath','sineglass','liquid'):
			s=np.sin(arg)*(1+.08*np.sin(2*np.pi*.72*t))
			s+=.14*np.sin(arg*2.01)
		elif bass_mode in ('piston','volcanic','saw'):
			s=(.75*np.sin(arg)+.19*np.sin(arg*2)+.08*np.sin(arg*3))
			s*=1-.09*np.cos(2*np.pi*4*t)
			if bass_mode=='volcanic':s=np.tanh(s*1.75)
		elif bass_mode in ('taffy','pocket','analog'):
			s=.73*np.sin(arg)+.17*np.sin(arg*2+.9*np.sin(arg/7))
		elif bass_mode=='brass':
			s=.83*np.sin(arg)+.21*np.sin(arg*2)
		else:
			s=np.sin(arg)
		out[attack:attack+n,:]+=(s*env*.31)[:,None]
	return resample_poly(out,2,1,axis=0).astype('float32')

def render_foley(source_drums,biome):
	# Derive source attack times, NOT arbitrary independent rhythm;
	# soft-source false onset tests remain an audition prerequisite.
	_,_,_,mode,_=CHARACTERS[biome]
	mono=np.mean(source_drums[::2],axis=1)
	frame=240
	n=len(mono)//frame
	power=np.sqrt(np.mean(mono[:n*frame].reshape(n,frame)**2,axis=1)+1e-12)
	smooth=np.convolve(power,[.15,.35,.35,.15],mode='same')
	prom=max(.003,float(np.percentile(smooth,65))*.14)
	peaks,_=find_peaks(smooth,distance=16,prominence=prom)
	if len(peaks)>125:
		peaks=peaks[np.argsort(smooth[peaks])[-125:]]
	peaks=np.sort(peaks)
	rng=np.random.default_rng(stable_seed('foley',biome))
	out=np.zeros((SYNTH_FRAMES,2),dtype='float32')
	for index,peak in enumerate(peaks):
		start=int(peak*frame)
		if start>=SYNTH_FRAMES:continue
		dur=.085 if mode in ('wood','thimble','wrapper','gear','telemetry') else .21
		dur=.39 if mode in ('rain','bubble','steam') else dur
		size=min(round(dur*SYNTH_RATE),SYNTH_FRAMES-start)
		t=np.arange(size,dtype='float32')/SYNTH_RATE
		noise=rng.standard_normal(size).astype('float32')
		amp=float(np.clip(smooth[peak]/max(np.percentile(smooth,90),.001),.15,1.4))
		if mode=='wood':
			s=.6*np.sin(2*np.pi*240*t)+.3*noise
			s*=np.exp(-t/.021)
		elif mode in ('scrap','gear','sistrum','glass','thimble'):
			f={'scrap':350,'gear':460,'sistrum':1100,'glass':1500,'thimble':920}[mode]
			s=.55*np.sin(2*np.pi*f*t)+.25*np.sin(2*np.pi*f*2.42*t)
			s+=.14*noise
			s*=np.exp(-t/(.025 if mode=='thimble' else .08))
		elif mode=='telemetry':
			s=np.sin(2*np.pi*(840*t+450*t*t))*.55
			s*=np.exp(-t/.038)
		elif mode=='wrapper':
			s=.54*noise+.32*np.sin(2*np.pi*440*t)
			s*=np.exp(-t/.012)
		elif mode in ('bubble','rain'):
			f=250 if mode=='bubble' else 1300
			s=.5*np.sin(2*np.pi*(f*t+170*t*t))+.15*noise
			s*=np.exp(-t/.092)
		elif mode=='steam':
			s=.7*noise*np.exp(-t/.07)
			s+=.25*np.sin(2*np.pi*180*t)*np.exp(-t/.15)
		else:
			s=.5*noise*np.exp(-t/.03)
		pan=.2+.6*((index*3)%7)/6
		out[start:start+size,0]+=(amp*s*math.cos(math.pi/2*pan)).astype('float32')
		out[start:start+size,1]+=(amp*s*math.sin(math.pi/2*pan)).astype('float32')
	return resample_poly(out,2,1,axis=0).astype('float32'),len(peaks)

def finalize(audio,target=.145):
	# Matching integrated audition level prevents louder versions masquerading
	# as better. Limiter acts on the *new exported* mix, never source masters.
	# 0.76 headroom protects against up to ~0.24 sample overshoot
	# during lossy Opus encoding/decoding; audit verifies final assets.
	actual=rms(audio)
	if actual<.001:raise ValueError('Orchestra unexpectedly silent')
	limited=audio*(min(2.5,target/actual))
	peak=float(np.max(np.abs(limited)))
	if peak>.76:limited*=.76/peak
	return limited.astype('float32')

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--input',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--candidate',type=Path,required=True)
	p.add_argument('--expression',type=Path,required=True)
	p.add_argument('--bass-note-root',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():
		raise SystemExit('REFUSING to overwrite another audition: '+str(a.out))
	a.out.mkdir(parents=True,exist_ok=False)
	catalog={'format':'bitstream-orchestra-auditions-v1',
		'created':'2026-11-16',
		'status':'unapproved first-pass 11-biome integrated arrangement auditions',
		'frames':FRAMES,'sampleRate':RATE,'seconds':SECONDS,
		'limits':['Source note transcription not yet human-verified',
			'No real BSOD-distance automation; atmosphere is a fixed audition',
			'Airborne drum option is manually auditioned, not game-telemetry-driven',
			'Pyramid approved lead sample retained without edits',
			'Media synthesized from legally separate local sound-design tools'],
		'biomes':[{'id':b,'label':b.replace('-',' ').title(),
			'orchestra':CHARACTERS[b][0],
			'description':CHARACTERS[b][1],
			'featuredInstrument':CHARACTERS[b][2],
			'foleyFamily':CHARACTERS[b][3],
			'bassCharacter':CHARACTERS[b][4]} for b in BIOMES],
		'songs':[]}
	for song,conf in SONGS.items():
		folder=a.input/song
		dest=a.out/song
		dest.mkdir()
		original={name:read_audio(folder/'original'/(name+'.ogg')) for name in (
			'vocals','drums','bass','guitar','piano','other')}
		# No vocals by default; isolated Maxi voice separately toggleable
		instrumental=sum((audio for name,audio in original.items()
			if name!='vocals'),np.zeros((FRAMES,2),dtype='float32'))
		ref=finalize(instrumental,.15)
		ref_stats=write_ogg(dest/'original-instrumental.ogg',ref)
		voice_path=folder/'original/vocals.ogg'
		shutil.copyfile(voice_path,dest/'vocals.ogg')
		featured=conf['featured']
		unchanged=[name for name in ('guitar','piano','other') if name!=featured]
		original_feature=original[featured]
		feature_target=max(.020,min(.043,rms(original_feature)*1.22))
		notes_doc=json.loads((a.expression/(conf['notes']+'.json')).read_text())
		notes=notes_doc['events']
		bass_doc=json.loads((a.bass_note_root/(song+'-bass-extracted-notes-v1.json')).read_text())
		song_row={'id':song,'title':conf['title'],'featured':featured,
			'unselectedPreserved':unchanged,
			'excerptStartSeconds':conf['start'],
			'originalReference':'original-instrumental.ogg',
			'vocals':'vocals.ogg','referenceStats':ref_stats,
			'variants':{}}
		for biome in BIOMES:
			melodysource=(
				folder/'melody-candy-v3/candy-cane-canyon.ogg'
				if biome=='candy-cane-canyon' else
				folder/'melody'/(biome+'.ogg'))
			melody=read_audio(melodysource)
			bass_sample=read_audio(folder/'bass'/(biome+'.ogg'))
			drum_sample=read_audio(folder/'drums-sampled'/(biome+'.ogg'))
			feature_sample=read_audio(folder/'featured-sampled'/(biome+'.ogg'))
			custom,transcribed=render_featured_notes(notes,biome)
			bass_overlay=render_bass_notes(bass_doc['notes'],biome)
			foley,foley_hits=render_foley(original['drums'],biome)

			# Two other source recordings are ALWAYS present at unity.
			fixed=original[unchanged[0]]+original[unchanged[1]]
			# A small portion of the original featured musical activity
			# acts as a safety scaffold until notes are ear-verified.
			f=original_feature*.17 + loudness_match(feature_sample,feature_target)*.23
			f+=loudness_match(custom,feature_target)*.78
			# Low-end is anchored by an actual source-aligned bass, not
			# made artificially thin just because a biome is 'tiny'.
			bass=original['bass']*.11+bass_sample*.82
			if rms(bass_overlay)>.0001:
				bass+=loudness_match(bass_overlay,max(.01,rms(original['bass'])*.74))*.28
			lead=loudness_match(melody,
				max(.066,min(.092,rms(original['vocals'])*.73)),limit=1.7)
			# Full source key/melody relationship maintained by unchanged
			# accompaniment + new featured, not only by percussion tricks.
			bed=(fixed + f + bass + lead).astype('float32')
			ground=finalize(bed+original['drums']*.91)
			# Source-driven airborne kit + biome foley.
			airdrums=loudness_match(drum_sample,
				max(.073,min(.133,rms(original['drums'])*.81)),limit=4.3)
			airdrums+=loudness_match(foley,max(.006,rms(original['drums'])*.073))*.72
			air=finalize(bed+airdrums)
			ground_stats=write_ogg(dest/(biome+'-ground.ogg'),ground)
			air_stats=write_ogg(dest/(biome+'-air.ogg'),air)
			song_row['variants'][biome]={
				'ground':biome+'-ground.ogg',
				'air':biome+'-air.ogg',
				'featureNotes':transcribed,'foleyEvents':foley_hits,
				'featuredVoice':CHARACTERS[biome][2],
				'groundStats':ground_stats,'airStats':air_stats,
				'originalAccompanimentPreserved':unchanged}
			print('ORCHESTRA_RENDER',song,biome,'notes',transcribed,
				'foley',foley_hits,'ground_peak',ground_stats['peak'],
				'air_peak',air_stats['peak'],flush=True)
		catalog['songs'].append(song_row)
	(a.out/'catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
	print('ORCHESTRAS_COMPLETE',len(catalog['songs']),
		len(catalog['biomes']),len(list(a.out.rglob('*.ogg'))),
		'ogg_clips',a.out,flush=True)

if __name__=='__main__':
	main()
