#!/usr/bin/env python3
"""Three source-grounded comparative drum count-ins for Marvin.

Research clips ONLY. Uses actual local One More Run OGG stems unchanged.
One recorded MIDI event sequence is also saved as a standard format-0 SMF.
No modifications to original assets, score, music engine, or main.
"""
from pathlib import Path
import os
from subprocess import run
from hashlib import sha256
import json
import math
import struct
import wave
import numpy as np
from scipy import signal

REPO=Path(__file__).resolve().parents[2]
ROOT=Path(os.environ.get('BITSTREAM_MUSIC_SOURCE_DIR',str(REPO/'public/music/packs/33_local-one-more-run-bitstream-bluffs')))
OUT=Path(os.environ.get('BITSTREAM_DRUM_PREVIEW_OUTPUT',str(REPO/'docs/music-review/drum-countin-ab-20261119')))
OUT.mkdir(parents=True,exist_ok=True)
RATE=48000
BPM=160
BEAT=60/BPM
CRASH_AT=.9
DRUMS_AT=CRASH_AT+.205+2*BEAT
BAND_AT=DRUMS_AT+4*BEAT
DURATION=BAND_AT+2.4
START=61.8
COUNT=int(round(DURATION*RATE))
SOURCE_START=int(round((START-60)*RATE))
STEMS={'drums':'drums','bass':'bass','guitar':'guitar','piano':'piano','other':'other','melody':'voice-home'}
LEVELS={'drums':1.,'bass':.84,'guitar':.9,'piano':.8,'other':.72,'melody':.72}
RNG=np.random.default_rng(20261119)

def decode(path):
	cmd=['ffmpeg','-v','error','-i',str(path),'-ar',str(RATE),'-ac','2','-f','f32le','pipe:1']
	p=run(cmd,capture_output=True,check=True,timeout=25)
	return np.frombuffer(p.stdout,dtype='<f4').reshape(-1,2).copy()

sources={}
for role,name in STEMS.items():
	f=ROOT/f'0005-{name}.ogg'
	assert f.exists(),f
	a=decode(f)
	assert len(a)>SOURCE_START+COUNT,(f,len(a),SOURCE_START+COUNT)
	sources[role]=a
	print('ORIGINAL_AUDIO',role,sha256(f.read_bytes()).hexdigest()[:20], 'frames',len(a))

# Continuous source soundtrack position remains identical across A/B/C.
# The same original audio's exact pre-crash and post-count-in remains audible.
context=np.zeros((COUNT,2),np.float64)
for role,volume in LEVELS.items():
	context+=volume*sources[role][SOURCE_START:SOURCE_START+COUNT]
# Band disappears while evaluating the count-in; short click-free ramps.
env=np.zeros(COUNT,dtype=np.float64)
pre=int(CRASH_AT*RATE)
post=int(BAND_AT*RATE)
env[:pre]=1.
fade=round(.014*RATE)
env[pre-fade:pre]=np.linspace(1,0,fade)
env[post:]=1.
env[post:post+fade]=np.linspace(0,1,fade)

# Natural version: ONLY original drums, exactly their continuous segment.
audio_natural=np.zeros((COUNT,2),np.float64)
audio_natural[int(DRUMS_AT*RATE):int(BAND_AT*RATE)]=sources['drums'][SOURCE_START+int(DRUMS_AT*RATE):SOURCE_START+int(BAND_AT*RATE)]
fade10=round(.008*RATE)
start=int(DRUMS_AT*RATE)
end=int(BAND_AT*RATE)
audio_natural[start:start+fade10]*=np.linspace(0,1,fade10)[:,None]
audio_natural[end-fade10:end]*=np.linspace(1,0,fade10)[:,None]

# MIDI file: humanized but explicitly authored FOUR-BEAT sample-kit performance.
# Standard percussion MIDI channel 10, 160 BPM, meaningful drum note/velocity.
# The render is a freshly synthesized original kit, not MIDI decoded from stem.
notes=[
	(0.,36,114,.17),(0.,42,80,.07),
	(.5,42,41,.055),
	(1.,38,114,.14),(1.,42,84,.07),
	(1.5,42,47,.055),
	(2.,36,118,.18),(2.,42,92,.075),
	(2.5,38,39,.09),(2.5,42,56,.055),
	(3.,38,124,.15),(3.,36,91,.15),(3.,46,80,.19),
]
# Event sequence with integer ticks, tempo meta event, end of track.
def vlq(v):
	v=int(v);b=[v&0x7f];v>>=7
	while v:b.insert(0,(v&0x7f)|0x80);v>>=7
	return bytes(b)

events=[(0,0,b'\xff\x51\x03'+(375000).to_bytes(3,'big'))]
for beat,note,velocity,length in notes:
	on=int(round(beat*480));off=int(round((beat+length/BEAT)*480))
	events.append((on,2,bytes((0x99,note,velocity))))
	events.append((off,1,bytes((0x89,note,0))))
events.sort(key=lambda x:(x[0],x[1]))
track=bytearray();previous=0
for tick,_,message in events:
	track.extend(vlq(tick-previous));track.extend(message);previous=tick
track.extend(b'\x00\xff\x2f\x00')
mid=(b'MThd'+struct.pack('>IHHH',6,0,1,480)+b'MTrk'+struct.pack('>I',len(track))+track)
(OUT/'B_recorded-midi-drum-performance_160bpm.mid').write_bytes(mid)

def note_kit(note,vel):
	# Fully original synthesized test kit, using note/velocity information
	# from MIDI events (kick GM36, snare 38, hats 42/46).
	sec={36:.27,38:.24,42:.105,46:.22}[note]
	t=np.arange(int(sec*RATE),dtype=np.float64)/RATE
	seed=int(note*20000+vel*101)
	rng=np.random.default_rng(seed)
	noise=rng.normal(0,1,len(t))
	if note==36:
		freq=47+75*np.exp(-t*31)
		phase=2*np.pi*np.cumsum(freq)/RATE
		body=np.sin(phase)*np.exp(-t*21)
		click=signal.sosfilt(signal.butter(2,1500,btype='highpass',fs=RATE,output='sos'),noise)*np.exp(-t*195)
		return (.84*body+.13*click)*(vel/127)**1.2
	if note==38:
		band=signal.sosfilt(signal.butter(2,[750,9000],btype='bandpass',fs=RATE,output='sos'),noise)
		body=np.sin(2*np.pi*203*t)*np.exp(-t*32)
		return (.32*body+.35*band*np.exp(-t*17))*(vel/127)**1.3
	band=signal.sosfilt(signal.butter(3,5000,btype='highpass',fs=RATE,output='sos'),noise)
	env=np.exp(-t*(47 if note==42 else 21))
	return .22*band*env*(vel/127)**1.15

midi_render=np.zeros((COUNT,2),np.float64)
for beat,note,velocity,length in notes:
	at=int(round((DRUMS_AT+beat*BEAT)*RATE))
	part=note_kit(note,velocity)
	usable=min(len(part),COUNT-at)
	midi_render[at:at+usable,0]+=part[:usable]
	midi_render[at:at+usable,1]+=part[:usable]*.96

# Different original drum hits: 4 UNIQUE actual OGG-transient excerpts,
# with no identical source offset among the four.
# These source times are documented as audition guesses, NOT verified beat grid.
clip_source_times=[60.76,61.44,63.68,65.54]
varied=np.zeros((COUNT,2),np.float64)
for beat_idx,src_sec in enumerate(clip_source_times):
	at=int(round((DRUMS_AT+beat_idx*BEAT)*RATE))
	src=int(round((src_sec-60-.014)*RATE))
	length=int(.19*RATE)
	part=sources['drums'][src:src+length].copy()
	assert len(part)==length
	ramp=int(.008*RATE)
	part[:ramp]*=np.linspace(0,1,ramp)[:,None]
	part[-ramp:]*=np.linspace(1,0,ramp)[:,None]
	varied[at:at+length]+=part

# Level-match just DRUMS during the four-beat section for fair comparison.
lo=int(DRUMS_AT*RATE);hi=int(BAND_AT*RATE)
def rms(x):return float(np.sqrt(np.mean(x*x)))
target=rms(audio_natural[lo:hi])
for key,drums in [('B',midi_render),('C',varied)]:
	current=rms(drums[lo:hi]);factor=float(np.clip(target/max(1e-6,current),.45,2.4))
	drums*=factor
	print('DRUM_MATCH',key,'targetRms',round(target,5),'rms',round(rms(drums[lo:hi]),5),'factor',round(factor,3))

# Identical soundtrack prelude, identical silence/no-scratch, identical
# original-band return at the same original source position in ALL versions.
common=context*env[:,None]
rendered={
	'A_original-natural-drum-stem': common+audio_natural,
	'B_recorded-midi-drum-kit': common+midi_render,
	'C_four-varied-original-drum-hits': common+varied,
}
# Shared fixed factor only; never independently compress/normalize variants.
maxpeak=max(float(np.max(np.abs(v))) for v in rendered.values())
gain=min(.95, .82/maxpeak)
print('GLOBAL_SINGLE_GAIN',gain,'peak',maxpeak)
paths=[]
for name,samples in rendered.items():
	pcm=np.int16(np.clip(samples*gain,-.999,.999)*32767)
	wav=OUT/(name+'.wav')
	with wave.open(str(wav),'wb') as w:
		w.setnchannels(2);w.setsampwidth(2);w.setframerate(RATE)
		w.writeframes(pcm.tobytes())
	mp3=OUT/(name+'.mp3')
	res=run(['ffmpeg','-nostdin','-v','error','-y','-i',str(wav),'-codec:a','libmp3lame','-q:a','4',str(mp3)],capture_output=True)
	if res.returncode!=0:raise RuntimeError(res.stderr.decode()[:300])
	wav.unlink()
	paths.append({'file':mp3.name,'bytes':mp3.stat().st_size,'sha256':sha256(mp3.read_bytes()).hexdigest(),
		'drumRms':round(rms(samples[lo:hi])*gain,5),'peak':round(float(np.max(np.abs(samples))*gain),4)})
	print('EXPORTED',mp3.name,mp3.stat().st_size)

metadata={'song':'One More Run','promptBpm':160,'releaseBeatVerification':'NOT VERIFIED','researchBeatSeconds':BEAT,
 'originalSourceSegment':'0005', 'originalSourceStartSeconds':START,
 'originalSourceStemHashesSha256':{role:sha256((ROOT/f'0005-{name}.ogg').read_bytes()).hexdigest() for role,name in STEMS.items()},
 'testCrashAtClipSeconds':CRASH_AT,'countInStartAtClipSeconds':DRUMS_AT,
 'fullBandReturnsAtClipSeconds':BAND_AT,'clipDurationSeconds':DURATION,
 'scratch':'INTENTIONALLY OMITTED in all 3: compare drum treatment without existing artificial scratch',
 'drumKitB':'MIDI SMF0, GM channel 10, original synthesized kit, kick/snare/hats, humanized velocity',
 'differentOriginalHitsC':clip_source_times,'outputs':paths}
(OUT/'metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
print('META',json.dumps(metadata,indent=2))
