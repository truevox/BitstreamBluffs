#!/usr/bin/env python3
"""Sine Timing Reference, a PRIVATE LAB-only diagnostic pseudo-biome.

Play all note EVENT CLOCKS plainly, not the source recordings or 11 custom
instrument voices. The research model's notes may be wrong; these make
their positions audible with NO artistic attack, decay, effects or foley.
Includes original SheetSage2 lead melody, source F0 bass, featured
BasicPitch note hypotheses, and high-resolution V3 drum hit timestamps.
Source stems and the game itself are never opened or modified.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np

import render_reattack_comparisons_v1 as base
import render_controlled_accompaniment_v1 as controlled

RATE=base.RATE
FRAMES=base.FRAMES
SECONDS=base.SECONDS
STYLES=('new','aligned','reattacks')

def event_window(event,offset=0):
	start=float(event['start'])-offset
	end=float(event['end'])-offset
	if not math.isfinite(start) or not math.isfinite(end) or end<=start:
		return None
	if end<=0 or start>=SECONDS:
		return None
	return max(0.,start),min(SECONDS,end)

def flat_sine(buffer,events,volume,pan,offset=0,bass_octave=False,mark_onsets=False):
	"""Gate a zero-phase sine at the exact scored times with 1ms click safety.
	No ADSR, pitch bending, reverb, distortion, note velocity, or randomization.
	"""
	left=math.cos(pan*math.pi/2)
	right=math.sin(pan*math.pi/2)
	count=0
	starts=[]
	for event in events:
		clip=event_window(event,offset)
		if clip is None:
			continue
		begin,end=clip
		midi=int(event['midi'])
		if not 20<=midi<=105 or end-begin<.008:
			continue
		if bass_octave and midi<43:
			midi+=12  # audible register only; MIDI timestamps unchanged
		freq=440*2**((midi-69)/12)
		i0=int(round(begin*RATE))
		i1=min(FRAMES,int(round(end*RATE)))
		n=i1-i0
		if n<3:
			continue
		t=np.arange(n,dtype=np.float64)/RATE
		signal=np.sin(2*np.pi*freq*t)*volume
		# A 1ms safety ramp prevents digital pops, NOT musical articulation.
		edge=min(48,n//4)
		if edge:
			signal[:edge]*=np.linspace(0,1,edge,endpoint=True)
			signal[-edge:]*=np.linspace(1,0,edge,endpoint=True)
		buffer[i0:i1,0]+=signal*left
		buffer[i0:i1,1]+=signal*right
		if mark_onsets and begin>.003:
			# A tiny, dry, high-pitched *onset marker*, NOT a reverb tail.
			# Makes repeats and same-pitch rearticulations unmistakable.
			span=min(FRAMES-i0,round(.002*RATE))
			if span>3:
				x=np.arange(span,dtype=np.float64)/RATE
				click=.038*np.sin(2*np.pi*2700*x)*(1-x/.002)
				buffer[i0:i0+span,1]+=click
		count+=1
		starts.append(round(begin,5))
	return {'count':count,'first':starts[:10],'last':starts[-10:]}

def drum_clicks(buffer,events):
	"""Precisely placed, unquantized 3–10ms dry electronic ticks."""
	summary={}
	stamps=[]
	for event in events:
		t=float(event['t'])
		if not 0<=t<SECONDS:
			continue
		kind=event['type']
		freq,duration,vol={
			'kick':(180,.010,.22),'snare':(1150,.008,.13),
			'hat':(3100,.004,.13),'tom':(570,.009,.13),
		}.get(kind,(2050,.005,.13))
		i0=round(t*RATE)
		n=min(FRAMES-i0,round(duration*RATE))
		if n<2:
			continue
		x=np.arange(n,dtype=np.float64)/RATE
		pulse=np.sin(2*np.pi*freq*x)*vol
		# Fixed finite click, with no simulated drum envelope or room.
		pulse*=np.minimum(1.,x/.0005)
		pulse*=np.minimum(1.,(duration-x)/.0005)
		buffer[i0:i0+n,0]+=pulse*.72
		buffer[i0:i0+n,1]+=pulse*.72
		summary[kind]=summary.get(kind,0)+1
		stamps.append(t)
	diff=np.diff(sorted(stamps)) if len(stamps)>1 else []
	return {'count':len(stamps),'kinds':summary,
		'minInterhitMs':round(float(np.min(diff))*1000,2) if len(diff) else None,
		'first':stamps[:12]}

def render(a):
	if a.out.exists():
		raise FileExistsError('Refusing to replace diagnostic output: '+str(a.out))
	a.out.mkdir(parents=True)
	report={'format':'bitstream-diagnostic-sine-v1',
		'status':'lab-only; NOT a biome in the game; research note timing is unverified',
		'notes':'Hard-gated steady sine, 1ms safety edge; no actual source instruments or recordings',
		'styles':list(STYLES),'songs':{}}
	for song,conf in base.SONGS.items():
		scores=controlled.prepare_scores(song,conf,a)
		melody_path=a.melody_pope if song=='pope' else a.melody_one_more_run
		melody_doc=json.loads(melody_path.read_text())
		bass_doc=json.loads((a.bass_note_root/(song+'-bass-extracted-notes-v1.json')).read_text())
		drums_doc=json.loads((a.drums_v3_root/(song+'-drums-v3.json')).read_text())
		assert drums_doc['startSeconds']==conf['start']
		assert melody_doc['notes'] and bass_doc['notes'] and drums_doc['events']
		backing=np.zeros((FRAMES,2),dtype=np.float32)
		lead=flat_sine(backing,melody_doc['notes'],.105,.18,offset=conf['start'])
		bass=flat_sine(backing,bass_doc['notes'],.082,.50,bass_octave=True)
		percussion=drum_clicks(backing,drums_doc['events'])
		voices={}
		stats={}
		for style in STYLES:
			if song!='pope' and style=='reattacks':
				continue
			v=np.zeros((FRAMES,2),dtype=np.float32)
			stats[style]=flat_sine(v,scores[style],.088,.78,mark_onsets=True)
			voices[style]=v
		raws={style:backing+voice for style,voice in voices.items()}
		maxpeak=max(float(np.max(np.abs(y))) for y in raws.values())
		gain=min(1.0,.76/maxpeak)
		stats['unchangedBackingSha256']=__import__('hashlib').sha256(backing.tobytes()).hexdigest()
		stats['sharedMasterGain']=round(gain,9)
		for style,mix in raws.items():
			# No per-style normalization: this is a literal, valid note A/B.
			difference=mix-raws['new']-(voices[style]-voices['new'])
			assert float(np.max(np.abs(difference)))<3e-6
			mix*=gain
			assert np.isfinite(mix).all()
			assert float(np.max(np.abs(mix)))<.77
			out=a.out/song/(style+'.ogg')
			meta=base.write_ogg(out,mix)
			print('SINE_DIAGNOSTIC',song,style,'featuredNotes',
				stats[style]['count'],'drumClicks',percussion['count'],
				'peak',meta['peak'],flush=True)
		report['songs'][song]={
			'excerptStartSeconds':conf['start'],'featuredStem':conf['featured'],
			'leadNotes':lead,'bassNotes':bass,'drumClicks':percussion,
			'featured':stats,'availableStyles':list(voices)}
	(a.out/'qa.json').write_text(json.dumps(report,indent=2)+'\n')
	print('LAB_DIAGNOSTIC_COMPLETE',a.out,flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',required=True,type=Path)
	p.add_argument('--expression',required=True,type=Path)
	p.add_argument('--aligned-events',required=True,type=Path)
	p.add_argument('--reattack-events',required=True,type=Path)
	p.add_argument('--bass-note-root',required=True,type=Path)
	p.add_argument('--drums-v3-root',required=True,type=Path)
	p.add_argument('--melody-pope',required=True,type=Path)
	p.add_argument('--melody-one-more-run',required=True,type=Path)
	render(p.parse_args())
