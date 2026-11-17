#!/usr/bin/env python3
"""PRIVATE, ADDITIVE stock-vs-aligned accompaniment control; same V3 drums and leads.

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
from scipy.signal import find_peaks, resample_poly, lfilter

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


# V2 note engine: the detected source onset remains exactly as detected.
# The ADSR no longer consumes the entire 200-ms note in a slow attack
# or truncates a sustaining note while it's still loud.
NOTE_RELEASE={
	'dulcimer':.17,'scrap':.23,'qanun':.21,'hydroglass':.54,
	'holopad':.64,'telemetry':.25,'toyaccordion':.19,'windharp':.66,
	'clockwork':.19,'kalimba':.14,'bowedsteel':.57,
}
SLOW_LEGACY={
	'hydroglass':.17,'holopad':.19,
	'windharp':.25,'bowedsteel':.16,
}
def corrected_envelope(hold,release,frames):
	t=np.arange(frames,dtype='float32')/SYNTH_RATE
	# Audibly begin the note on the detected onset (6ms fade avoids clicks).
	# A slower acoustic evolution may occur INSIDE the body, not instead
	# of a recognizable onset.
	attack=np.clip(hold*.085,.004,.012)
	grow=np.minimum(1,t/max(.003,float(attack)))
	tail=np.clip((t-hold)/release,0,1)
	fade=np.cos(.5*np.pi*tail)**2
	gain=grow*fade
	gain[-1]=0
	return gain.astype('float32')

def waveguide(freq,n,rng,brightness=.5,decay=.991):
	# Excited delay-line string. Unlike a GM patch, timbre depends on
	# string period, attack spectra and dissipating high harmonics.
	period=max(8,min(750,int(round(SYNTH_RATE/max(35,freq)))))
	y=np.zeros(n,dtype='float32')
	pluck=rng.standard_normal(period).astype('float32')
	pluck=np.convolve(pluck,[.2,.6,.2],mode='same')
	pluck=pluck/max(.01,float(np.sqrt(np.mean(pluck*pluck))))
	damp=.988-(1-brightness)*.020
	iterations=0
	for at in range(0,n,period):
		nleft=min(period,n-at)
		y[at:at+nleft]=pluck[:nleft]
		pluck=(pluck+np.roll(pluck,1))*.5*damp
		if iterations%6==0:pluck*=decay
		iterations+=1
	return y

def diverse_character(midi,hold,release,mode,rng):
	n=max(2,int((hold+release)*SYNTH_RATE))
	t=np.arange(n,dtype='float32')/SYNTH_RATE
	freq=midi_frequency(midi)
	freq=min(1300,freq)
	p=2*np.pi*freq*t
	white=rng.standard_normal(n).astype('float32')
	if mode=='dulcimer':
		# Velvet wood, hammer + a real feedback-string impulse.
		s=.62*waveguide(freq,n,rng,.13,.976)
		s+=.35*np.sin(p)*np.exp(-t/1.1)+.09*white*np.exp(-t/.009)
		s*=np.exp(-t/1.1)
	elif mode=='scrap':
		# Inharmonic pipes and chaotic attack, not a conventionally tuned synth.
		s=.55*np.sin(p)*np.exp(-t/.74)
		for k,level,sec in [(2.313,.34,.48),(3.923,.25,.21),(5.411,.15,.13)]:
			s+=level*np.sin(p*k+.1*k)*np.exp(-t/sec)
		s=np.tanh(s*2.2)+.24*white*np.exp(-t/.021)
	elif mode=='qanun':
		# Bright asymmetric double wire / tremolo overtones.
		string=waveguide(freq,n,rng,.8,.998)
		string2=waveguide(freq*1.004,n,rng,.7,.996)
		s=.66*string+.28*string2+.16*np.sin(p*2)*np.exp(-t/.30)
		s+=.03*white*np.exp(-t/.008)
		s*=np.exp(-t/1.6)
	elif mode=='hydroglass':
		# Slowly beating glass with fluid pitch bend and inharmonic wash.
		q=np.cumsum(1+.006*np.sin(2*np.pi*1.2*t))/SYNTH_RATE
		w=2*np.pi*freq*q
		s=.56*np.sin(w)*np.exp(-t/1.8)
		s+=.35*np.sin(w*2.67)*np.exp(-t/.65)
		s+=.18*np.sin(w*4.21)*np.exp(-t/.24)
		s+=.17*white*np.exp(-t/.016)
		s=np.tanh(s*1.4)
	elif mode=='holopad':
		# Playable struck crystal/hollow bell with a substantial BOOOONG
		# fundamental and slow inharmonic metallic partials.
		fund=freq*(.5 if freq>400 else 1.0)
		w=2*np.pi*fund*t
		s=.77*np.sin(w)*np.exp(-t/2.4)
		s+=.46*np.sin(2*w*1.003)*np.exp(-t/1.4)
		s+=.28*np.sin(2.754*w)*np.exp(-t/.9)
		s+=.18*np.sin(4.073*w)*np.exp(-t/.49)
		s+=.11*white*np.exp(-t/.007)
	elif mode=='telemetry':
		# Chirping frequency modulation, with electronic sidebands.
		mod=(4.5*np.exp(-t/.13)+.65)
		s=.64*np.sin(p+mod*np.sin(2.03*p))
		s+=.27*np.sin(.5*p+.11*np.sin(6.6*t))*np.exp(-t/.4)
		s*=np.exp(-t/.35)
		s+=.09*white*np.exp(-t/.004)
	elif mode=='toyaccordion':
		# Multiple beating reed pipes: unlike a plucked toy or FM synth.
		s=(.49*np.sin(p)+.30*np.sin(p*3)+.22*np.sin(p*5)
			+.14*np.sin(p*7))
		s+=.21*np.sin(p*1.003)
		s*=1+.14*np.sin(2*np.pi*4.8*t)
		s+=.10*white*np.exp(-t/.018)
	elif mode=='windharp':
		# Airy harmonic strings with fine bow/air noise; audible short onset.
		phase=p*(1+.0015*np.sin(2*np.pi*.33*t))
		s=.47*np.sin(phase)+.31*np.sin(2.003*phase)
		s+=.15*np.sin(3.012*phase)+.13*np.sin(.5*phase)
		colored=lfilter([1],[1,-.94],white).astype('float32')
		colored/=max(.01,float(np.std(colored)))
		s+=.17*colored
		s*=.72+.27*np.sin(2*np.pi*.37*t)**2
	elif mode=='clockwork':
		# Metallic picked wire plus brittle gear-click excitation.
		string=waveguide(freq,n,rng,.97,.995)
		s=.57*string+.28*np.sin(p*2.006)*np.exp(-t/.33)
		s+=.19*np.sin(p*4.30)*np.exp(-t/.085)
		s+=.14*white*np.exp(-t/.005)
		s*=np.exp(-t/.60)
	elif mode=='kalimba':
		# Tiny overoctave tines. Crisp, dry, not a slow synth pad.
		fund=freq*(2 if freq<330 else 1)
		w=2*np.pi*fund*t
		s=.67*np.sin(w)*np.exp(-t/.39)
		s+=.37*np.sin(2.79*w)*np.exp(-t/.18)
		s+=.18*np.sin(5.61*w)*np.exp(-t/.08)
		s+=.12*white*np.exp(-t/.003)
	elif mode=='bowedsteel':
		# Keep the recognizable Vents bowed steel; add abrasive
		# subharmonic resonance and rough bow noise.
		arg=p*(1+.0014*np.sin(2*np.pi*1.17*t))
		s=.55*np.sin(arg)+.28*np.sin(arg*.501)
		s+=.23*np.sin(arg*2.08)+.16*np.sin(arg*3.24)
		bow=lfilter([1],[1,-.87],white).astype('float32')
		bow/=max(.01,float(np.std(bow)))
		s+=.13*bow
		s=np.tanh(s*1.32)*(1+.09*np.sin(2*np.pi*3.0*t))
	else:
		raise ValueError('No unique physical-instrument model: '+mode)
	return s.astype('float32')

def corrected_note(midi,hold,velocity,mode,rng,revision):
	hold=float(np.clip(hold,.09,2.4))
	release=NOTE_RELEASE[mode]
	n=max(2,int((hold+release)*SYNTH_RATE))
	if revision=='articulation':
		# Retain the SAME underlying V1 timbre, but compensate the
		# explicitly slow envelope with a lookahead into that same note's
		# own waveform. This does NOT change the transcription onsets.
		advance=min(.20,SLOW_LEGACY.get(mode,0)*.9)
		extra=int(round(advance*SYNTH_RATE))
		source=modal_note(midi,hold+release+advance+.18,velocity,mode,rng)
		s=source[extra:extra+n]
		if len(s)<n:s=np.pad(s,(0,n-len(s)))
	else:
		s=diverse_character(midi,hold,release,mode,rng)
	# Fade to actual SILENCE at the end rather than truncate a loud note.
	envelope=corrected_envelope(hold,release,n)
	return (s[:n]*envelope*(velocity/95 if revision!='articulation' else 1)).astype('float32')


def crystal_bong(midi,velocity,rng):
	# Extra low bell, not added melody pitches; keeps root pitch class
	# in a lower octave and lets the bell genuinely resonate.
	duration=1.8
	t=np.arange(int(duration*SYNTH_RATE),dtype='float32')/SYNTH_RATE
	freq=midi_frequency(midi)
	if freq>320:freq*=.5
	p=2*np.pi*freq*t
	s=.88*np.sin(p)*np.exp(-t/1.22)
	s+=.53*np.sin(2.755*p)*np.exp(-t/.73)
	s+=.31*np.sin(4.075*p)*np.exp(-t/.36)
	s+=.055*rng.standard_normal(len(t))*np.exp(-t/.007)
	attack=np.minimum(1,t/.004)
	tail=np.cos(.5*np.pi*np.clip((t-1.24)/.56,0,1))**2
	return (s*attack*tail*(velocity/110)).astype('float32')

def render_featured_notes(events,biome,revision):
	_,_,mode,_,_=CHARACTERS[biome]
	out=np.zeros((SYNTH_FRAMES,2),dtype='float32')
	count=0
	rng=np.random.default_rng(stable_seed('featured',biome))
	last_bong=-2.
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
		voice=corrected_note(midi,max(.09,end-start),velocity,mode,rng,revision)
		n=min(len(voice),SYNTH_FRAMES-attack)
		pan=float(np.clip(.19+.62*((i*7+int(midi))%11)/10,.1,.9))
		out[attack:attack+n,0]+=voice[:n]*math.cos(pan*math.pi/2)
		out[attack:attack+n,1]+=voice[:n]*math.sin(pan*math.pi/2)
		count+=1
		if revision in ('orchestral','rhythm') and mode=='holopad' and midi<=79:
			# A separate long struck crystal-bell layer, only when the
			# phrase has left some room. Keep pitch class and beat.
			if start-last_bong>=1.45:
				bong=crystal_bong(midi,velocity,rng)
				size=min(len(bong),SYNTH_FRAMES-attack)
				out[attack:attack+size,0]+=bong[:size]*.39
				out[attack:attack+size,1]+=bong[:size]*.48
				last_bong=start
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

def render_foley(source_drums,biome,drum_events):
	# Derive source attack times, NOT arbitrary independent rhythm;
	# soft-source false onset tests remain an audition prerequisite.
	_,_,_,mode,_=CHARACTERS[biome]
	# A source-derived onset score shared with the GM sampled kit.
	# No secondary 160ms refractory or arbitrary cap at 125 events.
	# Co-hit events receive one foley accent per physical onset, not
	# one accent per kick/snare/hat voice sounding at that same instant.
	attacks={}
	for event in drum_events:
		frame=int(round(float(event['t'])*SYNTH_RATE))
		if not 0<=frame<SYNTH_FRAMES:continue
		velocity=float(event.get('velocity',80))
		strength=velocity/108
		attacks[frame]=max(attacks.get(frame,0.),strength)
	peaks=sorted(attacks.items())
	rng=np.random.default_rng(stable_seed('foley',biome))
	out=np.zeros((SYNTH_FRAMES,2),dtype='float32')
	for index,(start,amp) in enumerate(peaks):
		if start>=SYNTH_FRAMES:continue
		dur=.085 if mode in ('wood','thimble','wrapper','gear','telemetry') else .21
		dur=.39 if mode in ('rain','bubble','steam') else dur
		size=min(round(dur*SYNTH_RATE),SYNTH_FRAMES-start)
		t=np.arange(size,dtype='float32')/SYNTH_RATE
		noise=rng.standard_normal(size).astype('float32')
		amp=float(np.clip(amp,.15,1.4))
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
	p.add_argument('--drums-v3-root',type=Path,required=True)
	p.add_argument('--drum-events-root',type=Path,required=True)
	p.add_argument('--revision',choices=('rhythm',),required=True)
	p.add_argument('--accompaniment-style',choices=('stock','aligned'),required=True)
	p.add_argument('--aligned-events',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():
		raise SystemExit('REFUSING to overwrite another audition: '+str(a.out))
	a.out.mkdir(parents=True,exist_ok=False)
	catalog={'format':'bitstream-orchestra-auditions-v1',
		'created':'2026-11-16',
		'status':'unapproved '+a.accompaniment_style+' Guitar/Piano/Other comparison; V3 drums and lead preserved',
		'frames':FRAMES,'sampleRate':RATE,'seconds':SECONDS,
		'revision':a.revision,
		'accompanimentStyle':a.accompaniment_style,
		'limits':['Melodic source note transcription and 5.8ms-per-hop drum onset events are NOT ear-verified',
			'No real BSOD-distance automation; atmosphere is a fixed audition',
			'Airborne drum option is manually auditioned, not game-telemetry-driven',
			'Pyramid approved lead sample retained without edits',
			'Footnote: Drums V3 global refractory ~17.4ms, F0 instrument notes unchanged',
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
		if a.accompaniment_style=='aligned':
			correction=json.loads((a.aligned_events/(conf['notes']+'-aligned.json')).read_text())
			assert correction['sourceNoteCount']==len(notes)
			assert correction['excerptStartSeconds']==conf['start']
			notes=correction['events']
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
			drum_sample=read_audio(a.drums_v3_root/song/(biome+'.ogg'))
			feature_sample=read_audio(folder/'featured-sampled'/(biome+'.ogg'))
			if a.accompaniment_style=='stock':
				custom=np.zeros((FRAMES,2),dtype='float32')
				transcribed=0
			else:
				custom,transcribed=render_featured_notes(notes,biome,a.revision)
			bass_overlay=render_bass_notes(bass_doc['notes'],biome)
			drum_events=json.loads((a.drum_events_root/(song+'-drums-v3.json')).read_text())['events']
			foley,foley_hits=render_foley(original['drums'],biome,drum_events)

			# Two other source recordings are ALWAYS present at unity.
			fixed=original[unchanged[0]]+original[unchanged[1]]
			# A small portion of the original featured musical activity
			# acts as a safety scaffold until notes are ear-verified.
			if a.revision=='articulation':
				f=original_feature*.17 + loudness_match(feature_sample,feature_target)*.23
				f+=loudness_match(custom,feature_target)*.78
			else:
				# Stock trio means the actual original Guitar/Piano/Other,
				# while the new melody, bass and selected ground/air kit remain.
				# All other source recordings are unchanged, so this A/B
				# isolates the re-performance of ONE chosen featured stem.
				if a.accompaniment_style=='stock':
					f=original_feature.copy()
				else:
					target=max(.048,min(.070,rms(original_feature)*1.75))
					f=original_feature*.07 + loudness_match(feature_sample,target)*.07
					f+=loudness_match(custom,target)*1.22
			# Low-end is anchored by an actual source-aligned bass, not
			# made artificially thin just because a biome is 'tiny'.
			if a.revision=='articulation':
				bass=original['bass']*.11+bass_sample*.82
				if rms(bass_overlay)>.0001:
					bass+=loudness_match(bass_overlay,max(.01,rms(original['bass'])*.74))*.28
			else:
				bass=original['bass']*.06+bass_sample*.65
				if rms(bass_overlay)>.0001:
					bass+=loudness_match(bass_overlay,max(.02,rms(original['bass'])*.81))*.50
			lead=loudness_match(melody,
				max(.066,min(.092,rms(original['vocals'])*.73)),limit=1.7)
			# Full source key/melody relationship maintained by unchanged
			# accompaniment + new featured, not only by percussion tricks.
			bed=(fixed + f + bass + lead).astype('float32')
			ground=finalize(bed+original['drums']*.91)
			# Source-driven airborne kit + biome foley.
			airdrums=loudness_match(drum_sample,
				max(.073,min(.133,rms(original['drums'])*.81)),limit=4.3)
			if a.revision=='articulation':
				airdrums+=loudness_match(foley,max(.006,rms(original['drums'])*.073))*.72
			else:
				# Biome-specific source-attack foley becomes audible, distinct
				# orchestral percussion rather than an almost invisible garnish.
				airdrums*=.66
				airdrums+=loudness_match(foley,max(.023,rms(original['drums'])*.32))*.94
			air=finalize(bed+airdrums)
			ground_stats=write_ogg(dest/(biome+'-ground.ogg'),ground)
			air_stats=write_ogg(dest/(biome+'-air.ogg'),air)
			song_row['variants'][biome]={
				'ground':biome+'-ground.ogg',
				'air':biome+'-air.ogg',
				'featureNotes':transcribed,'foleyEvents':foley_hits,
				'featuredVoice':CHARACTERS[biome][2],
				'revision':a.revision,
				'accompanimentStyle':a.accompaniment_style,
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
