#!/usr/bin/env python3
"""Offline-only cross-band audit of drum-family confusion, NOT real-song gold.

Each proposal uses pre/post bandpassed RMS attack evidence; labels derive
solely from synthetic fixture generation. No classifier is shipped or trained.
"""
import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfiltfilt
from benchmark_drums_v4 import make_cases
from benchmark_drum_family_gate_v5 import select_families
from detector_candidate_v2 import drum_simultaneous, RATE
from detector_candidate_v4 import drum_echo_similarity_probe
from evaluate_performance_v1 import match_events

FAMILIES={'kick':(45,180),'snare':(350,3500),'hat':(4400,7500)}
SECONDS_PER_CLIP=12


def attack_bands(wave):
	"""Pre-filter once per fixture; don't touch input arrays."""
	wave=np.asarray(wave,dtype='float32')
	return {kind:sosfiltfilt(butter(4,[lo,hi],btype='bandpass',
		fs=RATE,output='sos'),wave).astype('float32')
		for kind,(lo,hi) in FAMILIES.items()}


def attack_features(bands,t):
	"""Local 12ms pre/12ms post energy increase in each family band."""
	center=round(t*RATE)
	out={}
	for kind,band in bands.items():
		left=band[max(0,center-192):max(0,center)]
		right=band[max(0,center+48):min(len(band),center+240)]
		before=float(np.sqrt(np.mean(left**2))) if len(left) else 0.
		after=float(np.sqrt(np.mean(right**2))) if len(right) else 0.
		out[kind]=max(0.,after-before)
	return out


def source_predictions(wave):
	v2,_=drum_simultaneous(wave,echo_guard='ratio-only')
	v4,_=drum_echo_similarity_probe(wave)
	return select_families(v2,v4,('v2','v4','v2'))


def classify_predictions(predicted,gold):
	"""One-to-one exact-class 20ms matching; never count near other class."""
	matched=set()
	for kind in FAMILIES:
		p=sorted(({'startFrame':round(hit['t']*48000),'id':i}
			for i,hit in enumerate(predicted) if hit['type']==kind),
			key=lambda v:(v['startFrame'],v['id']))
		g=sorted(({'startFrame':round(hit['t']*48000),'id':i}
			for i,hit in enumerate(gold) if hit['type']==kind),
			key=lambda v:(v['startFrame'],v['id']))
		matched.update(a['id'] for a,b in match_events(p,g,960))
	return matched


def audit_case(name,gold,wave,seed,cohort):
	proposals=source_predictions(wave)
	matched=classify_predictions(proposals,gold)
	bands=attack_bands(wave)
	rows=[]
	for i,hit in enumerate(proposals):
		strength=attack_features(bands,hit['t'])
		kind=hit['type']
		total=sum(strength.values())
		dominance=strength[kind]/max(1e-10,total)
		strongest=max(strength,key=strength.get)
		rows.append({'type':kind,'timeSec':hit['t'],'matchedSyntheticHit':i in matched,
			'dominance':round(dominance,6),'strongestAttackBand':strongest,
			'attackRise':{key:round(value,8) for key,value in strength.items()}})
	return {'scenario':name,'seed':seed,'cohort':cohort,
		'audioSha256':hashlib.sha256(wave.tobytes()).hexdigest(),
		'syntheticTruthCount':len(gold),'predictions':rows}


def summarize(rows):
	result={}
	for kind in FAMILIES:
		result[kind]={}
		for label in (True,False):
			vals=[hit for row in rows for hit in row['predictions']
				if hit['type']==kind and hit['matchedSyntheticHit']==label]
			fractions=sorted(hit['dominance'] for hit in vals)
			def quantile(q):
				return round(fractions[int(q*(len(fractions)-1))],4) if fractions else None
			result[kind]['matched' if label else 'falsePositive']={
				'count':len(vals),'dominanceP10':quantile(.1),
				'dominanceMedian':quantile(.5),'dominanceP90':quantile(.9),
				'strongestOwnBand':sum(hit['strongestAttackBand']==kind for hit in vals)}
	return result


def run(seeds):
	if not seeds or len(seeds)!=len(set(seeds)) or len(seeds)>12:
		raise ValueError('Require 1-12 unique synthetic seeds')
	cases=[]
	for seed in seeds:
		for name,gold,wave,cohort in make_cases(seed):
			cases.append(audit_case(name,gold,wave,seed,cohort))
			print('AUDIT',seed,name,flush=True)
	return {'format':'bitstream-cross-band-drum-diagnostic-v6',
		'status':'synthetic fixture audit ONLY; no human-reviewed labels or source gold',
		'candidate':'V5 snare-only family selector, unapproved',
		'seeds':seeds,'summary':summarize(cases),'cases':cases,
		'sourceHashes':{name:hashlib.sha256((Path(__file__).parent/name)
			.read_bytes()).hexdigest() for name in
			('detector_candidate_v2.py','detector_candidate_v4.py')},
		'approvedForAudio':False,'humanVerified':False}


def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',required=True,type=Path)
	p.add_argument('--seeds',default='559103,71,337,1097')
	a=p.parse_args()
	if a.out.exists():raise FileExistsError(a.out)
	report=run([int(x) for x in a.seeds.split(',')])
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('SUMMARY',json.dumps(report['summary'],sort_keys=True),flush=True)
	print('EVIDENCE',a.out,flush=True)

if __name__=='__main__':
	main()
