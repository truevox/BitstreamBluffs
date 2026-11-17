#!/usr/bin/env python3
"""Adversarial synthetic counterexamples for experimental drums and bass.

These are PRE-DECLARED edge cases, never release quality claims. Score
both true, quiet repeated hits and echo-only repeats; an echo-suppression
rule must not be assumed to discriminate perfectly. Bass repeated strikes
may be irregular (swing/ghost), not just straight mechanical sixteenths.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from benchmark_drums_candidate_v2 import synth as drum_synth, compare as drum_match
from benchmark_detector_candidate_v2 import generate as pitch_synth
from benchmark_detector_candidate_v2 import compare as pitch_match
from detector_candidate_v2 import drum_simultaneous, bass_replucks
from render_full_dynamic_orchestra_v1 import choose_drum_events, choose_bass_events

DRATE=16000
SECONDS=12

def drum_fixture(name):
	if name=='quiet-ghost-snare-120ms':
		return [{'t':round(.4+i*.42,4),'type':'snare','velocity':1}
			for i in range(25)]+[
				{'t':round(.52+i*.42,4),'type':'snare','velocity':.32}
					for i in range(25)],False
	if name=='quiet-ghost-kick-120ms':
		return [{'t':round(.4+i*.45,4),'type':'kick','velocity':1}
			for i in range(24)]+[
				{'t':round(.52+i*.45,4),'type':'kick','velocity':.30}
					for i in range(24)],False
	if name=='real-snare-double-80ms':
		return [{'t':round(.4+i*.46,4),'type':'snare','velocity':1.}
			for i in range(24)]+[
				{'t':round(.48+i*.46,4),'type':'snare','velocity':.6}
					for i in range(24)],False
	if name=='real-snare-double-155ms':
		return [{'t':round(.4+i*.49,4),'type':'snare','velocity':1.}
			for i in range(22)]+[
				{'t':round(.555+i*.49,4),'type':'snare','velocity':.42}
					for i in range(22)],False
	if name=='original-snare-echo-80ms':
		return [{'t':round(.4+i*.46,4),'type':'snare','velocity':1.}
			for i in range(24)],True
	raise ValueError(name)

def scaled_drum_audio(notes,echo=False):
	"""Independent seeded noise for each true struck hit, not copies.

	Previous stress prototype accidentally reran the sampler with the
	SAME random seed per note. That made genuine re-strikes perfectly
	correlated with echoes — an invalid synthetic discriminability test.
	The canonical synthetic drum mixer consumes RNG sequentially, so
	each separately struck hit has independently seeded attack texture.
	"""
	return drum_synth(notes,echo=echo)

def bass_fixture(name):
	if name=='swing-uneven-strikes':
		start=.3
		out=[]
		for block in range(14):
			pitch=44+(block%4)*5
			for delta in (0.,.115,.29,.405):
				out.append({'start':round(start+delta,4),'midi':pitch})
			start+=.52
		return out
	if name=='uneven-quiet-restrikes':
		start=.35
		out=[]
		for block in range(12):
			pitch=41+(block%4)*4
			for delta in (0.,.14,.27,.44):
				out.append({'start':round(start+delta,4),'midi':pitch})
			start+=.62
		return out
	raise ValueError(name)

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',required=True,type=Path)
	a=p.parse_args()
	if a.out.exists():raise FileExistsError(a.out)
	result={'format':'bitstream-detector-adversarial-stress-v1',
		'status':'SYNTHETIC ONLY — not real music gold',
		'cases':[]}
	for name in ('quiet-ghost-snare-120ms','quiet-ghost-kick-120ms',
		'real-snare-double-80ms','real-snare-double-155ms','original-snare-echo-80ms'):
		gold,echo=drum_fixture(name)
		gold.sort(key=lambda x:x['t'])
		audio=scaled_drum_audio(gold,echo=echo)
		old,_=choose_drum_events(audio)
		new,details=drum_simultaneous(audio)
		baseline=drum_match(old,gold,20)
		candidate=drum_match(new,gold,20)
		result['cases'].append({
			'name':name,'instrument':'drums','nGold':len(gold),
			'baseline':baseline,'candidate':candidate,
			'candidateEvents':len(new),'diagnostics':details,
			'audioSha256':hashlib.sha256(audio.tobytes()).hexdigest(),
		})
		print('ADVERSARIAL_DRUMS',name,'gold',len(gold),
			'old',baseline['f1'],'candidate',candidate['f1'],
			'newHits',len(new),'newRecall',candidate['recall'],flush=True)
	for name in ('swing-uneven-strikes','uneven-quiet-restrikes'):
		gold=bass_fixture(name)
		audio=pitch_synth(gold,echo=False)
		old,_=choose_bass_events(audio)
		new,details=bass_replucks(audio)
		baseline=pitch_match(old,gold,SECONDS,50)
		candidate=pitch_match(new,gold,SECONDS,50)
		result['cases'].append({'name':name,'instrument':'bass',
			'nGold':len(gold),'baseline':baseline,'candidate':candidate,
			'candidateEvents':len(new),'diagnostics':details,
			'audioSha256':hashlib.sha256(audio.tobytes()).hexdigest()})
		print('ADVERSARIAL_BASS',name,'gold',len(gold),
			'old',baseline['f1'],'candidate',candidate['f1'],
			'newHits',len(new),'newRecall',candidate['recall'],flush=True)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('ADVERSARIAL_RESULTS_RECORDED',a.out,flush=True)

if __name__=='__main__':
	main()
