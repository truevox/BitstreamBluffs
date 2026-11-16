#!/usr/bin/env python3
"""PRIVATE 4-family audio auditions. Reuse source recordings without changing game engine.
Changes timbres via source-preserving spectral/dynamic processing, NOT new polyphonic
MIDI or true instrument sample replacement. Originals + all variants for honest A/B.
"""
from __future__ import annotations
import json,math,subprocess,sys,time
from pathlib import Path
import numpy as np

RATE=48000
DURATION=32
SPECS={
				'pope':{
								'title':'Pope Leo Wants the AI Root Password',
								'start':150,
								'featured':'other',
								'base':Path('/root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4'),
								'voices':Path('/root/bitstream-maxi/transcription-lab-20261115/full-song-pope/full-palette'),
								'activity':{'guitar':.126,'piano':0.0,'other':.221},
				},
				'one-more-run':{
								'title':'One More Run (The Ballad of Bitstream Bluffs)',
								'start':92,
								'featured':'piano',
								'base':Path('/root/bitstream-maxi/launch33/stems/grouped_6s/33_one_more_run'),
								'voices':Path('/root/bitstream-maxi/transcription-lab-20261115/full-song-one-more-run/full-palette'),
								'activity':{'guitar':.547,'piano':.556,'other':.504},
				},
}
BIOMES=[
	('bitstream-bluffs','Home Signal','Original stem / existing melody'),
	('debumont','Debumont','Warm reed, retro console pulse, brushed air'),
	('garbage-dump-glacier','Garbage Dump Glacier','Corrupt datastream, fractured circuitry'),
	('pyramid-peak','Pyramid Peak','Regal brass-weighted lows, desert air'),
	('underwater-mountain','Underwater Mountain','Submerged hydro pulses, liquid diffusion'),
	('crystal-cavern','Crystal Cavern','Crystal subglass, holopad, shimmering clicks'),
	('space-mountain','Space Mountain','Analog orbital synth, cosmic delays'),
	('candy-cane-canyon','Candy Cane Canyon','Elastic bubblegum, fizzy pop clicks'),
	('sky-jellyfish-mountain','Sky Jellyfish Mountain','Weightless choir fog, airy membrane'),
	('steampunk-slopes','Steampunk Slopes','Gearwork steam, machine resonance'),
	('micro-mountain','Micro Mountain','8-bit miniature synth / toy air'),
	('vertigo-vents','Vertigo Vents','Pipe organ pedals, volcanic low drone'),
]
# DSP values are *per-family*; palette is an individual accent, not a
# clone of the previously approved 12 melody instruments.
PALETTES={
	'debumont':       dict(lo=70,hi=5600,drive=1.4,crush=0,chorus=.10,trem=.06,delay=.07,air=.25,tone='reed'),
	'garbage-dump-glacier':dict(lo=80,hi=4800,drive=3.2,crush=11,chorus=.02,trem=.34,delay=.11,air=.12,tone='broken digital'),
	'pyramid-peak':   dict(lo=50,hi=6100,drive=2.15,crush=0,chorus=.06,trem=.02,delay=.065,air=.14,tone='brass/stone'),
	'underwater-mountain':dict(lo=35,hi=2000,drive=1.2,crush=0,chorus=.35,trem=.17,delay=.28,air=.42,tone='liquid'),
	'crystal-cavern': dict(lo=65,hi=11500,drive=1.0,crush=0,chorus=.49,trem=.07,delay=.20,air=.60,tone='holopad/glass'),
	'space-mountain': dict(lo=30,hi=8500,drive=1.45,crush=0,chorus=.50,trem=.11,delay=.37,air=.48,tone='orbital'),
	'candy-cane-canyon':dict(lo=70,hi=10100,drive=2.1,crush=7,chorus=.08,trem=.43,delay=.065,air=.24,tone='bouncy candy'),
	'sky-jellyfish-mountain':dict(lo=45,hi=7300,drive=1.0,crush=0,chorus=.42,trem=.13,delay=.30,air=.75,tone='choir/wind'),
	'steampunk-slopes':dict(lo=55,hi=5500,drive=2.8,crush=12,chorus=.06,trem=.25,delay=.11,air=.28,tone='mechanical steam'),
	'micro-mountain': dict(lo=90,hi=7400,drive=1.85,crush=6,chorus=.01,trem=.27,delay=.075,air=.18,tone='miniature arcade'),
	'vertigo-vents':  dict(lo=25,hi=6700,drive=2.9,crush=0,chorus=.26,trem=.09,delay=.27,air=.42,tone='organ/volcanic'),
}
def ff(*args,input=None):
	p=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',*map(str,args)],
		input=input,capture_output=True)
	if p.returncode:raise RuntimeError('FFMPEG '+str(args)[:230]+': '+p.stderr.decode(errors='replace')[-1500:])
	return p.stdout

def read_segment(path,start,duration=DURATION):
	assert path.is_file(),str(path)
	pcm=ff('-i',path,'-ss',start,'-t',duration,'-ac','2','-ar',RATE,'-f','f32le','-')
	data=np.frombuffer(pcm,dtype='<f4').reshape(-1,2).copy()
	expected=RATE*duration
	if len(data)<expected:
		data=np.pad(data,((0,expected-len(data)),(0,0)))
	assert len(data)==expected,(str(path),len(data))
	return data

def ogg(path,arr,bitrate='96k'):
	path.parent.mkdir(parents=True,exist_ok=True)
	arr=np.ascontiguousarray(np.clip(arr,-.965,.965),dtype='<f4')
	ff('-f','f32le','-ar',RATE,'-ac',2,'-i','pipe:0',
				'-c:a','libopus','-b:a',bitrate,'-application','audio','-f','ogg',path,input=arr.tobytes())

# Cached filter spectrum, per original source and role. Preserve original
# harmonic pitch centers and phrase rhythm; no invalid pitch estimates.
def shape_fft(src,lo,hi,peaks=()):
	n=len(src)
	freq=np.fft.rfftfreq(n,d=1/RATE)
	low=1/(1+np.power(np.maximum(freq,1)/max(lo,10),-2.3))
	high=1/(1+np.power(np.maximum(freq,1)/max(hi,100),4))
	gain=low*high
	for center,db,width in peaks:
		gain*=1+(10**(db/20)-1)*np.exp(-.5*(np.log2(np.maximum(freq,1)/center)/width)**2)
	transformed=[]
	for ch in range(2):
		spec=np.fft.rfft(src[:,ch].astype(np.float32))
		transformed.append(np.fft.irfft(spec*gain,n=n).astype(np.float32))
	return np.stack(transformed,axis=1)

def echo(x,delay,feedback=.18,stereo_delta=0):
	result=x.copy()
	for k in (1,2,3):
		for ch in (0,1):
			samples=int(RATE*(delay*(k)+(stereo_delta if ch else 0)))
			if samples<len(x):result[samples:,ch]+=x[:-samples,ch]*(feedback**k)
	return result

def flutter(y,depth,rate=5.6,phase=.4):
	if depth<.005:return y
	t=np.arange(len(y),dtype=np.float32)/RATE
	curve=1-depth*(.5+.5*np.sin(2*np.pi*rate*t+phase))
	return y*curve[:,None]

def saturate(x,amount=1.0):
	if amount<=1.01:return x
	return np.tanh(x*amount)/np.tanh(amount)

def crunch(x,bits):
	if bits<=0:return x
	levels=2**max(3,int(bits)-3)
	return np.round(x*levels)/levels

def detune_color(y,delay=.008,blend=.2):
	d=int(RATE*delay)
	if d<=0 or d>=len(y):return y
	z=y.copy()
	z[d:,0]+=blend*y[:-d,1]
	z[d:,1]+=blend*y[:-d,0]
	return z/(1+blend*.6)

def render(src,role,biome):
	p=PALETTES[biome]
	# Different processing topologies for 3 different source roles;
	# does NOT claim to be actual resynthesis from accurate polyphonic notes.
	if role=='bass':
		lo=max(20,p['lo']*.37);hi=min(p['hi']*.55,3600)
		tone=shape_fft(src,lo,hi,[(92,2.3,.9),(450,3.4,.7)])
		tone=saturate(tone,p['drive']+(.65 if biome in ('pyramid-peak','vertigo-vents') else 0))
		if biome in ('garbage-dump-glacier','micro-mountain','candy-cane-canyon'):
			tone=crunch(tone,p['crush'])
		tone=flutter(tone,p['trem']*.30,rate={'candy-cane-canyon':8.5,'garbage-dump-glacier':13}.get(biome,3.7))
		if biome in ('space-mountain','crystal-cavern','sky-jellyfish-mountain'):
			tone=detune_color(tone,.006,.15+p['chorus']*.15)
		result=.76*tone+.22*src
	elif role=='drums':
		# Airy texture for use while airborne, leaving ground drums untouched.
		tone=shape_fft(src,max(210,p['lo']*5),p['hi'],[(2200,2.5,1.0),(4900,4*p['air'],.75)])
		tone=saturate(tone,1+p['drive']*.25)
		if p['crush']:tone=crunch(tone,p['crush'])
		tone=flutter(tone,min(.45,p['trem']*.54),rate=6.8)
		reflected=echo(tone,.065+p['delay']*.7,feedback=.21+p['air']*.30,stereo_delta=.007)
		result=(.28*src + .83*reflected)*(0.78+p['air']*.28)
		if biome in ('underwater-mountain','sky-jellyfish-mountain'):
			result=shape_fft(result,180,4500)
	elif role=='featured':
		# This *source preserving* pad/synth/texture treatment follows the
		# selected polyphonic original. No invented notes, no altered harmony.
		lo=p['lo'];hi=p['hi']
		peaks={
			'crystal-cavern':[(1400,6,.65),(4700,3,.8)],
			'space-mountain':[(320,3,1.1),(1700,-2,.7)],
			'candy-cane-canyon':[(3100,4,.6)],
			'underwater-mountain':[(550,3,.8)],
			'pyramid-peak':[(380,4,.8)],
		}.get(biome,[])
		tone=shape_fft(src,lo,hi,peaks)
		tone=saturate(tone,1+.42*(p['drive']-1))
		if p['crush']:tone=crunch(tone,p['crush'])
		tone=detune_color(tone,.009+p['chorus']*.03,min(.35,p['chorus']*.65))
		tone=flutter(tone,p['trem']*.55,rate=2.2 if biome.endswith('mountain') else 5.6)
		tone=echo(tone,p['delay'],feedback=.13+p['air']*.2,stereo_delta=.013)
		result=tone*.84+src*.19
	else:raise ValueError(role)
	# Equal power at the same level as source, NOT blindly making quiet stems
	# louder. Peak conservative and prevent out-of-phase A/B comparisons.
	origin=np.sqrt(np.mean(src.astype(np.float64)**2)+1e-14)
	power=np.sqrt(np.mean(result.astype(np.float64)**2)+1e-14)
	if origin<.000035:return np.zeros_like(src)
	result*=min(2.5,origin/max(power,1e-7))
	top=float(np.max(np.abs(result)))
	if top>.91:result*=.91/top
	return result.astype(np.float32)

def main():
	assert len(sys.argv)==2,'Usage: audio_first_render.py /absolute/new/output'
	out=Path(sys.argv[1]).resolve()
	assert not out.exists(),f'Output already exists: {out}'
	out.mkdir(parents=True)
	report={'format':'bitstream-audio-first-ab-v1','version':1,'excerptSeconds':DURATION,
		'sampleRate':RATE,'biomes':[{'id':x,'label':l,'description':d} for x,l,d in BIOMES],
		'songs':[],'note':'PRIVATE audio-timbre draft. Source-preserving DSP reinterpretations, NOT note-level polyphonic resynthesis. Originals preserved. BSOD simulated in browser only.'}
	for slug,spec in SPECS.items():
		songOut=out/slug
		songOut.mkdir()
		source={}
		for name in ('vocals','drums','bass','guitar','piano','other'):
			x=read_segment(spec['base']/(name+'.flac'),spec['start'])
			source[name]=x
			ogg(songOut/'original'/f'{name}.ogg',x,bitrate='96k')
			print('SOURCE',slug,name,'RMS',float(np.sqrt(np.mean(x*x))),flush=True)
		for biome,label,desc in BIOMES:
			if biome=='bitstream-bluffs':continue
			for role,originalName in [('bass','bass'),('drums','drums'),('featured',spec['featured'])]:
				rendered=render(source[originalName],role,biome)
				ogg(songOut/role/f'{biome}.ogg',rendered,bitrate='96k')
				print('RENDER',slug,biome,role,flush=True)
		for biome,label,desc in BIOMES:
			vo=spec['voices']/(biome+'-full.ogg')
			voice=read_segment(vo,spec['start'])
			ogg(songOut/'melody'/f'{biome}.ogg',voice,bitrate='96k')
		report['songs'].append({'id':slug,'label':spec['title'],
			'featured':spec['featured'],'activity':spec['activity'],
			'excerptStartSeconds':spec['start'],
			'durationSeconds':DURATION,
			'sourceDir':slug,
			'description':f'Original stems plus 11 bass, 11 airy drums, 11 {spec["featured"]}-derived featured timbres, and all 12 existing melody voices.'})
	(out/'catalog.json').write_text(json.dumps(report,indent=2)+'\n')
	print('READY_AUDIO_DRAFT',out,'FILES',len(list(out.rglob('*.ogg'))),flush=True)

if __name__=='__main__':main()
