#!/usr/bin/env python3
"""Research-only: attribute V2/V4 synthetic drum errors by class and cause.

This is *not* source-recording accuracy or a human gold corpus. Reuses the
project's one-to-one performance onset matcher with real 20/50ms gates.
Does not change scores, audio or the game; refuses to overwrite evidence.
"""
import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from benchmark_drums_v4 import make_cases, fixtures
from detector_candidate_v2 import drum_simultaneous
from detector_candidate_v4 import drum_echo_similarity_probe
from evaluate_performance_v1 import match_events, metrics

FRAMES_PER_SECOND=48000
KINDS=('kick','snare','hat')
METHODS=('v2Ratio','v4Texture')
TOLERANCES=(20,50)


def aligned_error_details(predicted,gold,kind,tolerance_ms):
	"""Class-aware one-to-one matching; includes exact unmatched events."""
	to_rows=lambda events:sorted(({'startFrame':round(e['t']*FRAMES_PER_SECOND),
		'type':e['type'],'id':index} for index,e in enumerate(events)
		if e['type']==kind),key=lambda row:(row['startFrame'],row['id']))
	p=to_rows(predicted)
	g=to_rows(gold)
	pairs=match_events(p,g,tolerance_ms*FRAMES_PER_SECOND//1000)
	p_ids={a['id'] for a,b in pairs}
	g_ids={b['id'] for a,b in pairs}
	return {'metrics':metrics(pairs,len(p),len(g),12*FRAMES_PER_SECOND),
		'falsePositiveFrames':[x['startFrame'] for x in p if x['id'] not in p_ids],
		'falseNegativeFrames':[x['startFrame'] for x in g if x['id'] not in g_ids]}


def categorize_suppression(rejections,gold,tolerance_ms=20):
	"""Near synthetic truth is an observation, not causal accuracy attribution."""
	near,away=0,0
	for row in rejections:
		if not row['rejected']:
			continue
		matches=any(g['type']==row['type'] and
			abs(g['t']-row['t'])*1000<=tolerance_ms for g in gold)
		if matches:near+=1
		else:away+=1
	return {'nearKnownSyntheticHit':near,'awayFromKnownSyntheticHits':away,
		'interpretation':'proximity only, not a verified causal suppression label'}


def audit_case(name,gold,wave,seed,cohort):
	old,_=drum_simultaneous(wave,echo_guard='ratio-only')
	new,diag=drum_echo_similarity_probe(wave)
	methods={'v2Ratio':old,'v4Texture':new}
	by_method={}
	for key,events in methods.items():
		by_method[key]={str(tol)+'ms':{
			kind:aligned_error_details(events,gold,kind,tol) for kind in KINDS}
			for tol in TOLERANCES}
	return {'scenario':name,'seed':seed,'cohort':cohort,
		'audioSha256':hashlib.sha256(wave.tobytes()).hexdigest(),
		'goldEvents':len(gold),'methods':by_method,
		'v4Suppression':categorize_suppression(diag['suspects'],gold)}


def summarize(rows):
	"""Micro-score all known synthetic events; avoid averaging empty classes."""
	result={}
	for cohort in sorted({row['cohort'] for row in rows}):
		subset=[row for row in rows if row['cohort']==cohort]
		result[cohort]={}
		for tol in TOLERANCES:
			key=str(tol)+'ms'
			result[cohort][key]={}
			for method in METHODS:
				result[cohort][key][method]={}
				for kind in KINDS:
					base=[row['methods'][method][key][kind]['metrics'] for row in subset]
					tp=sum(m['truePositive'] for m in base)
					fp=sum(m['falsePositive'] for m in base)
					fn=sum(m['falseNegative'] for m in base)
					precision=tp/(tp+fp) if tp+fp else 1. if not fn else 0.
					recall=tp/(tp+fn) if tp+fn else 1.
					f1=2*precision*recall/(precision+recall) if precision+recall else 0.
					result[cohort][key][method][kind]={
						'tp':tp,'fp':fp,'fn':fn,'precision':round(precision,4),
						'recall':round(recall,4),'f1':round(f1,4)}
	return result


def run(seeds):
	if not seeds or len(set(seeds))!=len(seeds) or len(seeds)>12:
		raise ValueError('Require 1–12 distinct seeds')
	rows=[]
	for seed in seeds:
		for name,gold,wave,cohort in make_cases(seed):
			rows.append(audit_case(name,gold,wave,seed,cohort))
			print('AUDITED',seed,name,flush=True)
	return {'format':'bitstream-drum-v4-synthetic-error-attribution-v1',
		'status':'SYNTHETIC ONLY; not human-verified source gold; not playable',
		'seeds':seeds,'methodSourceHashes':{
			'v2':hashlib.sha256((Path(__file__).parent/'detector_candidate_v2.py')
				.read_bytes()).hexdigest(),
			'v4':hashlib.sha256((Path(__file__).parent/'detector_candidate_v4.py')
				.read_bytes()).hexdigest()},
		'summaryMicroByClass':summarize(rows),'cases':rows,
		'approvedForAudio':False,'humanVerified':False}


def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',required=True,type=Path)
	p.add_argument('--seeds',default='559103,71,337,1097')
	a=p.parse_args()
	if a.out.exists():
		raise FileExistsError(a.out)
	report=run([int(s) for s in a.seeds.split(',')])
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('MICRO_F1_SYNTHETIC',json.dumps(report['summaryMicroByClass'],
		sort_keys=True),flush=True)
	print('EVIDENCE',a.out,flush=True)

if __name__=='__main__':
	main()
