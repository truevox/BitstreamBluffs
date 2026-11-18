#!/usr/bin/env python3
"""V6 20/50ms synthetic holdout, never human-source gold or playback."""
import argparse
import hashlib
import json
from pathlib import Path
from benchmark_drums_v4 import make_cases, fixtures
from audit_cross_band_v6 import source_predictions, classify_predictions
from detector_candidate_v6 import cross_band_veto, MIN_FAMILY_SHARE

DEVELOPMENT=(559103,71,337,1097)
VALIDATION=(17,41,809,2027)


def run():
	all_splits={}
	for split,seeds in (('development',DEVELOPMENT),('alternate-seed-validation',VALIDATION)):
		rows=[]
		for seed in seeds:
			for name,gold,wave,cohort in make_cases(seed):
				base=source_predictions(wave)
				new,details=cross_band_veto(wave)
				metrics={key:{str(tol)+'ms':fixtures.compare(events,gold,tol)
					for tol in (20,50)} for key,events in
					(('v5SnareOnly',base),('v6CrossBandVeto',new))}
				rows.append({'seed':seed,'scenario':name,'cohort':cohort,
					'audioSha256':hashlib.sha256(wave.tobytes()).hexdigest(),
					'goldCountSynthetic':len(gold),'details':details,'metrics':metrics})
				print(split,seed,name,flush=True)
		summary={}
		for cohort in sorted({r['cohort'] for r in rows}):
			part=[r for r in rows if r['cohort']==cohort]
			summary[cohort]={key:{name:{
				'macroF1':round(sum(r['metrics'][name][key]['f1'] for r in part)/len(part),4),
				'falsePositive':sum(r['metrics'][name][key]['falsePositive'] for r in part),
				'falseNegative':sum(r['metrics'][name][key]['falseNegative'] for r in part)}
				for name in ('v5SnareOnly','v6CrossBandVeto')} for key in ('20ms','50ms')}
		all_splits[split]={'seeds':seeds,'summary':summary,'cases':rows}
	return {'format':'bitstream-cross-band-drum-v6-synthetic-holdout-v1',
		'status':'SYNTHETIC ONLY; no real-source gold; not for playback',
		'fixedThresholds':MIN_FAMILY_SHARE,'splits':all_splits,
		'candidateSourceSha256':hashlib.sha256((Path(__file__).parent/
			'detector_candidate_v6.py').read_bytes()).hexdigest(),
		'humanVerified':False,'approvedForPlayback':False}


def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise FileExistsError(a.out)
	report=run()
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	for split,result in report['splits'].items():
		print('SUMMARY',split,json.dumps(result['summary'],sort_keys=True),flush=True)
	print('EVIDENCE',a.out,flush=True)

if __name__=='__main__':
	main()
