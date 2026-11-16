#!/usr/bin/env python3
"""Non-destructive integrity/loudness regression comparison for private audio.
Reports changed, missing, added assets and short-window loudness differences.
Does not infer musical approval or normalize/mutate any audio.
"""
import argparse
import json
from pathlib import Path

def compare(baseline,candidate,rms_limit_db=3):
	if baseline['mode']!=candidate['mode']:
		raise ValueError('Incompatible manifest modes')
	if baseline['root']!=candidate['root']:
		raise ValueError('Different source roots: explicit relocation unsupported')
	root=Path(baseline['root'])
	def index(manifest):
		return {str(Path(item['file']).relative_to(root)):item for item in
			manifest['files']}
	old=index(baseline);new=index(candidate)
	added=sorted(set(new)-set(old))
	missing=sorted(set(old)-set(new))
	changed=[];loudness=[];duration=[]
	for name in sorted(set(old)&set(new)):
		a=old[name];b=new[name]
		if a['sha256']!=b['sha256']:
			changed.append(name)
		delta=round(float(b['sampleRmsDb'])-float(a['sampleRmsDb']),3)
		if abs(delta)>rms_limit_db:
			loudness.append({'file':name,'rmsDifferenceDb':delta})
		duration_delta=round(float(b['seconds'])-float(a['seconds']),4)
		if abs(duration_delta)>.02:
			duration.append({'file':name,'differenceSeconds':duration_delta})
	warnings=[{'file':str(Path(row['file']).relative_to(root)),
		'flags':row['flags']} for row in candidate['files'] if row['flags']]
	return {'kind':'read-only audio manifest regression','root':str(root),
		'mode':baseline['mode'],'baselineCount':len(old),
		'candidateCount':len(new),'added':added,'missing':missing,
		'byteChanged':changed,'largeLoudnessChanges':loudness,
		'durationRegressions':duration,'candidateWarnings':warnings,
		'preserved':not(missing or changed or duration),
		'limitations':['RMS comparison uses 1.5s decoded samples, not integrated LUFS.',
			'Lossy Ogg can exceed 0dBFS as decoded float without proving source clipping.',
			'Audio gain matching is measured only; no edits or auto-promotion.']}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--baseline',type=Path,required=True)
	p.add_argument('--candidate',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--strict',action='store_true')
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Do not overwrite a previous regression result')
	a_doc=json.loads(a.baseline.read_text())
	b_doc=json.loads(a.candidate.read_text())
	result=compare(a_doc,b_doc)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('ASSET_REGRESSION','preserved',result['preserved'],
		'missing',len(result['missing']),'changed',len(result['byteChanged']),
		'loudnessShifts',len(result['largeLoudnessChanges']),
		'peakFlags',len(result['candidateWarnings']),flush=True)
	if a.strict and not result['preserved']:
		raise SystemExit(2)

if __name__=='__main__':
	main()
