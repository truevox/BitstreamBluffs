#!/usr/bin/env python3
"""V5 research-only classwise V2/V4 selectors; never playable music.

The family recipes are fixed before the alternate-seed validation. Synthetic
holdouts test stability, NOT real-song quality or an independent gold corpus.
"""
import argparse
import hashlib
import json
from pathlib import Path

from benchmark_drums_v4 import make_cases, fixtures
from detector_candidate_v2 import drum_simultaneous
from detector_candidate_v4 import drum_echo_similarity_probe

FAMILIES=('kick','snare','hat')
RECIPES={
	'v2Ratio':('v2','v2','v2'),
	'v4Texture':('v4','v4','v4'),
	'v5SnareOnly':('v2','v4','v2'),
	'v5SnareKick':('v4','v4','v2'),
	'v5SnareHat':('v2','v4','v4'),
	'v5KickOnly':('v4','v2','v2'),
}
DEFAULT_DEVELOPMENT=(559103,71,337,1097)
DEFAULT_VALIDATION=(17,41,809,2027)


def select_families(v2,v4,recipe):
	"""Select candidate event families without modifying either input."""
	if len(recipe)!=len(FAMILIES) or any(s not in ('v2','v4') for s in recipe):
		raise ValueError('Invalid class selector recipe')
	if any(x.get('type') not in FAMILIES for x in [*v2,*v4]):
		raise ValueError('Unrecognized synthetic drum family')
	out=[dict(event) for family,source in zip(FAMILIES,recipe)
		for event in (v2 if source=='v2' else v4)
		if event['type']==family]
	return sorted(out,key=lambda e:(e['t'],e['type']))


def test_case(name,gold,wave,seed,cohort):
	v2,_=drum_simultaneous(wave,echo_guard='ratio-only')
	v4,_=drum_echo_similarity_probe(wave)
	method_results={}
	for label,recipe in RECIPES.items():
		selected=select_families(v2,v4,recipe)
		method_results[label]={str(tol)+'ms':fixtures.compare(selected,gold,tol)
			for tol in (20,50)}
	return {'scenario':name,'seed':seed,'cohort':cohort,
		'audioSha256':hashlib.sha256(wave.tobytes()).hexdigest(),
		'goldCountSynthetic':len(gold),'metrics':method_results}


def summarize(rows):
	report={}
	for cohort in sorted({row['cohort'] for row in rows}):
		selected=[row for row in rows if row['cohort']==cohort]
		report[cohort]={}
		for tol in (20,50):
			key=str(tol)+'ms'
			report[cohort][key]={name:{
				'macroF1':round(sum(row['metrics'][name][key]['f1']
					for row in selected)/len(selected),4),
				'falsePositive':sum(row['metrics'][name][key]['falsePositive']
					for row in selected),
				'falseNegative':sum(row['metrics'][name][key]['falseNegative']
					for row in selected)} for name in RECIPES}
	return report


def run(development=DEFAULT_DEVELOPMENT,validation=DEFAULT_VALIDATION):
	if not development or not validation or len(set((*development,*validation)))!=len(development)+len(validation):
		raise ValueError('Development and validation seeds must be distinct')
	if len(development)>12 or len(validation)>12:
		raise ValueError('At most twelve seeds per split')
	output={}
	for split,seeds in (('development',development),('alternate-seed-validation',validation)):
		rows=[]
		for seed in seeds:
			for name,gold,wave,cohort in make_cases(seed):
				rows.append(test_case(name,gold,wave,seed,cohort))
				print(split,seed,name,flush=True)
		output[split]={'seeds':list(seeds),'summary':summarize(rows),
			'cases':rows}
	return {'format':'bitstream-synthetic-drum-family-gating-research-v5',
		'status':'SYNTHETIC RESEARCH ONLY; not gold; not for playback',
		'recipes':{name:dict(zip(FAMILIES,recipe))
			for name,recipe in RECIPES.items()},
		'sourceSha256':{name:hashlib.sha256((Path(__file__).parent/name)
			.read_bytes()).hexdigest() for name in
			('detector_candidate_v2.py','detector_candidate_v4.py')},
		'splits':output,'humanVerified':False,'approvedForPlayback':False}


def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',required=True,type=Path)
	a=p.parse_args()
	if a.out.exists():
		raise FileExistsError(a.out)
	result=run()
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	for split,data in result['splits'].items():
		print('SUMMARY',split,json.dumps(data['summary'],sort_keys=True),flush=True)
	print('EVIDENCE',a.out,flush=True)

if __name__=='__main__':
	main()
