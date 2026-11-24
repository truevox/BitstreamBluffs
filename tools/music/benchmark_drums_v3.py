#!/usr/bin/env python3
"""Controlled comparison of independent drum streams and anchored fusion.

Never mistake these generated notes for real-song human gold. Includes all
adversarial quiet/echo cases, and reports BOTH event F1 and absolute counts.
"""
import argparse
import hashlib
import json
from pathlib import Path

from benchmark_drums_candidate_v2 import hits, synth, compare
from stress_detector_candidate_v2 import drum_fixture, scaled_drum_audio
from render_full_dynamic_orchestra_v1 import choose_drum_events
from detector_candidate_v2 import drum_simultaneous
from detector_candidate_v3 import drum_anchor_fusion


def run():
	scenarios=[]
	for name in ('isolated','cohits','hats-roll','echoed-cohits'):
		gold=hits(name)
		scenarios.append((name,gold,synth(gold,echo=name=='echoed-cohits')))
	for name in ('quiet-ghost-snare-120ms','quiet-ghost-kick-120ms',
		'real-snare-double-80ms','real-snare-double-155ms',
		'original-snare-echo-80ms'):
		gold,echo=drum_fixture(name)
		gold.sort(key=lambda item:item['t'])
		scenarios.append((name,gold,scaled_drum_audio(gold,echo)))
	results=[]
	for name,gold,wave in scenarios:
		original,_=choose_drum_events(wave)
		ratio,_=drum_simultaneous(wave,echo_guard='ratio-only')
		uncut,_=drum_simultaneous(wave,echo_guard='none')
		fused0,_=drum_anchor_fusion(wave,candidate_echo_guard='none')
		fused1,_=drum_anchor_fusion(wave,candidate_echo_guard='ratio-only')
		metrics={
			'baseline':compare(original,gold,20),
			'v2Ratio':compare(ratio,gold,20),
			'v2None':compare(uncut,gold,20),
			'v3AnchorNone':compare(fused0,gold,20),
			'v3AnchorRatio':compare(fused1,gold,20)}
		results.append({'scenario':name,'gold':len(gold),
			'audioSha256':hashlib.sha256(wave.tobytes()).hexdigest(),
			'metrics':metrics})
		print(name,'gold',len(gold), ' '.join(
			k+'='+str(round(v['f1'],3))+'('+str(v['falsePositive'])+
			'fp,'+str(v['falseNegative'])+'fn)'
			for k,v in metrics.items()),flush=True)
	return {'format':'bitstream-drums-fusion-synthetic-research-v1',
		'status':'synthetic only; not source gold; no release approval',
		'results':results,
		'summary':{key:round(sum(x['metrics'][key]['f1'] for x in results)/
			len(results),4) for key in
			('baseline','v2Ratio','v2None','v3AnchorNone','v3AnchorRatio')}}

if __name__=='__main__':
	p=argparse.ArgumentParser()
	p.add_argument('--out',type=Path,required=True)
	args=p.parse_args()
	if args.out.exists():raise FileExistsError(args.out)
	report=run()
	args.out.parent.mkdir(parents=True,exist_ok=True)
	args.out.write_text(json.dumps(report,indent=2)+'\n')
	print('MACRO_F1_BY_CASE_SYNTHETIC_NOT_REAL',report['summary'],flush=True)
