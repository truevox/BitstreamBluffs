#!/usr/bin/env python3
"""Unapproved drum V4 echo-texture probe vs released/V2 on held-out SYNTH.

No real song labels or owner listening; metrics cannot authorize audio changes.
Standalone checkout may lack private biome synth used only by rendering,
so substitute its static BIOMES attribute while importing fixture utilities.
"""
import argparse
import hashlib
import json
import sys
import types
from pathlib import Path
import numpy as np

try:
	import render_biome_orchestras_v2
except ModuleNotFoundError as error:
	if error.name != 'render_biome_orchestras_v2':
		raise
	sys.modules['render_biome_orchestras_v2'] = types.SimpleNamespace(BIOMES=())

import benchmark_drums_candidate_v2 as fixtures
from stress_detector_candidate_v2 import drum_fixture
from detector_candidate_v2 import drum_simultaneous
from detector_candidate_v4 import drum_echo_similarity_probe
from render_full_dynamic_orchestra_v1 import choose_drum_events

ORIGINAL=('isolated', 'cohits', 'hats-roll', 'echoed-cohits',
	'quiet-ghost-snare-120ms', 'quiet-ghost-kick-120ms',
	'real-snare-double-80ms', 'real-snare-double-155ms',
	'original-snare-echo-80ms')


def make_cases(seed):
	fixtures.SEED=seed
	for name in ORIGINAL:
		if name in ('isolated','cohits','hats-roll','echoed-cohits'):
			gold=fixtures.hits(name)
			wave=fixtures.synth(gold,echo=name=='echoed-cohits')
		else:
			gold, echo=drum_fixture(name)
			gold.sort(key=lambda item:item['t'])
			wave=fixtures.synth(gold,echo=echo)
		yield name,gold,wave,'original fixture family'

	for stem,delay,velocity in (('snare',.095,.26),('kick',.145,.27)):
		name='quiet-ghost-'+stem+'-'+str(round(delay*1000))+'ms-holdout'
		base,_=drum_fixture('quiet-ghost-'+stem+'-120ms')
		gold=[]
		for item in base:
			item=item.copy()
			if item['velocity']<1:
				item['t']=round(item['t']+delay-.120,4)
				item['velocity']=velocity
			gold.append(item)
		gold.sort(key=lambda item:item['t'])
		yield name,gold,fixtures.synth(gold,echo=False),'withheld ghost offset'
	for stem,delay,amount in (('cohits',.11,.37),('snare',.065,.29)):
		name='echo-'+stem+'-'+str(round(delay*1000))+'ms-holdout'
		gold=fixtures.hits('cohits') if stem=='cohits' else \
			drum_fixture('original-snare-echo-80ms')[0]
		gold.sort(key=lambda item:item['t'])
		wave=fixtures.synth(gold,echo=False)
		shift=round(delay*fixtures.RATE)
		original=wave.copy()
		wave[shift:]+=original[:-shift]*amount
		yield name,gold,wave,'withheld echo offset'


def test_case(name,gold,wave,seed,cohort):
	methods={
		'releaseV1':choose_drum_events(wave)[0],
		'v2Ratio':drum_simultaneous(wave,echo_guard='ratio-only')[0],
		'v2None':drum_simultaneous(wave,echo_guard='none')[0],
		'v4Texture':drum_echo_similarity_probe(wave)[0],
	}
	metrics={method:fixtures.compare(events,gold,20) for method,events in
		methods.items()}
	return {'scenario':name,'seed':seed,'cohort':cohort,
		'audioSha256':hashlib.sha256(wave.tobytes()).hexdigest(),
		'goldCount':len(gold),'metrics':metrics}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',required=True,type=Path)
	p.add_argument('--seeds',default='559103,71,337,1097')
	a=p.parse_args()
	if a.out.exists():
		raise FileExistsError(a.out)
	seeds=[int(item) for item in a.seeds.split(',')]
	if len(seeds)!=len(set(seeds)) or not 1<=len(seeds)<=12:
		raise ValueError('Need 1-12 unique synthetic seeds')
	results=[]
	for seed in seeds:
		for name,gold,wave,cohort in make_cases(seed):
			item=test_case(name,gold,wave,seed,cohort)
			results.append(item)
			print(seed,name,'V2',round(item['metrics']['v2Ratio']['f1'],3),
				'V4',round(item['metrics']['v4Texture']['f1'],3),flush=True)
	summary={}
	for cohort in sorted(set(row['cohort'] for row in results)):
		rows=[row for row in results if row['cohort']==cohort]
		summary[cohort]={key:round(sum(row['metrics'][key]['f1'] for row
			in rows)/len(rows),4) for key in results[0]['metrics']}
	source=Path(__file__)
	report={'format':'bitstream-drum-v4-synthetic-blind-probe-v1',
		'status':'SYNTHETIC ONLY; not validated on real music; NOT FOR PLAYBACK',
		'candidateSourceSha256':hashlib.sha256(
			(source.parent/'detector_candidate_v4.py').read_bytes()).hexdigest(),
		'seeds':seeds,'summaryMacroF1':summary,'results':results,
		'approvedForPlayback':False,'goldIsHumanVerified':False}
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('SYNTHETIC_MACRO_ONLY',summary,flush=True)
	print('EVIDENCE',a.out,flush=True)

if __name__=='__main__':
	main()
