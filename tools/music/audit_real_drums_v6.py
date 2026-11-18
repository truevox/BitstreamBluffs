#!/usr/bin/env python3
"""Read-only source-FLAC drum audit: V5/V6 versus release UNLABELED events.

Runs ffmpeg inside CT211 through its authorized Proxmox host, streams only
short 16kHz mono float PCM windows, and checks FULL source SHA-256 first.
No source is modified, no media copied to repo, no scores treated as gold.
"""
import argparse
import hashlib
import json
import math
import shlex
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from audit_cross_band_v6 import source_predictions
from detector_candidate_v6 import cross_band_veto
from evaluate_performance_v1 import match_events

SOURCE_PATHS={
	'FEsxYVStla4':'/root/bitstream-maxi/launch33/stems/htdemucs_6s/01_FEsxYVStla4/drums.flac',
	'WRBGQUqD54U':'/root/bitstream-maxi/launch33/stems/htdemucs_6s/03_WRBGQUqD54U/drums.flac',
	'FYImnz5-hXs':'/root/bitstream-maxi/launch33/stems/htdemucs_6s/31_FYImnz5-hXs/drums.flac',
	'local-one-more-run-bitstream-bluffs':'/root/bitstream-maxi/launch33/stems/grouped_6s/33_one_more_run/drums.flac',
}
RATE=48000
KINDS=('kick','snare','hat')
STATUS='real source audio but NO human gold; disagreements are NOT confirmed errors'

def proxmox(args,timeout=90):
	command=['ssh','-F','/dev/null','-T','-o','BatchMode=yes',
		'-o','ConnectTimeout=7','root@ursa-major',
		shlex.join(['pct','exec','211','--',*args])]
	return subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
		check=True,timeout=timeout)


def verify_master(song,score):
	if song not in SOURCE_PATHS:raise ValueError('Unknown approved source stem')
	if score['songId']!=song or score.get('quality')!='provisional-unreviewed':
		raise ValueError('Wrong or nonprovisional source score')
	expected=score['provenance']['sourceStemSha256']['drums']
	actual=proxmox(['sha256sum',SOURCE_PATHS[song]],timeout=90).stdout
	decoded=actual.decode('ascii').strip().split()
	if len(decoded)!=2 or decoded[0]!=expected or decoded[1]!=SOURCE_PATHS[song]:
		raise ValueError('Source stem hash/path mismatch: '+song)
	return expected


def read_pcm(song,start_frame,end_frame):
	if not 0<=start_frame<end_frame or end_frame-start_frame>RATE*20:
		raise ValueError('Window must be positive and at most 20s')
	start=start_frame/RATE
	duration=(end_frame-start_frame)/RATE
	cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error',
		'-ss',format(start,'.8f'),'-i',SOURCE_PATHS[song],
		'-t',format(duration,'.8f'),'-ac','1','-ar','16000',
		'-f','f32le','pipe:1']
	pcm=proxmox(cmd).stdout
	if len(pcm)%4:raise ValueError('Invalid remote PCM alignment')
	wave=np.frombuffer(pcm,dtype='<f4').copy()
	expected=duration*16000
	if abs(len(wave)-expected)>320 or not np.all(np.isfinite(wave)):
		raise ValueError('Short or non-finite remote PCM')
	return wave

def event_rows(events,start_frame,release=False):
	if release:
		return sorted(({'startFrame':int(e['startFrame']),'type':e['class']}
			for e in events),key=lambda e:(e['startFrame'],e['type']))
	return sorted(({'startFrame':start_frame+round(e['t']*RATE),
		'type':e['type']} for e in events),
		key=lambda e:(e['startFrame'],e['type']))


def compare_to_release(candidate,baseline,tolerance_ms):
	counts={}
	for kind in KINDS:
		c=sorted((e for e in candidate if e['type']==kind),
			key=lambda e:e['startFrame'])
		b=sorted((e for e in baseline if e['type']==kind),
			key=lambda e:e['startFrame'])
		pairs=match_events(c,b,round(tolerance_ms*RATE/1000))
		counts[kind]={'releaseCount':len(b),'candidateCount':len(c),
			'pairedWithRelease':len(pairs),
			'candidateUnpairedWithRelease':len(c)-len(pairs),
			'releaseUnpairedWithCandidate':len(b)-len(pairs)}
	return counts


def count_by_family(events):
	c=Counter(e['type'] for e in events)
	return {k:c[k] for k in KINDS}


def clip_audit(song,score,queue_row,window_label,source_hash):
	start=queue_row['startFrame']
	end=queue_row['endFrame']
	wave=read_pcm(song,start,end)
	v5=source_predictions(wave)
	v6,details=cross_band_veto(wave)
	release=[e for e in score['events']['drums'] if
		start<=e['startFrame']<end and e['class'] in KINDS]
	v5rows=event_rows(v5,start)
	v6rows=event_rows(v6,start)
	releaserows=event_rows(release,start,True)
	v5set=Counter((e['startFrame'],e['type']) for e in v5rows)
	v6set=Counter((e['startFrame'],e['type']) for e in v6rows)
	if v6set-v5set:raise ValueError('V6 added events outside V5 proposals')
	return {'song':song,'window':window_label,
		'startFrame':start,'endFrame':end,'sourceStemSha256':source_hash,
		'decodedPcmSha256':hashlib.sha256(wave.tobytes()).hexdigest(),
		'decodedPcmSamples16k':len(wave),'originalReleaseScoreHash':score['scoreHash'],
		'status':STATUS,'releaseCounts':count_by_family(releaserows),
		'v5Counts':count_by_family(v5rows),
		'v6Counts':count_by_family(v6rows),
		'v6RejectedCounts':details['removed'],
		'v6Retention':len(v6rows)/len(v5rows) if v5rows else None,
		'releaseComparisonsNotGold':{
			str(tol)+'ms':{
				'v5':compare_to_release(v5rows,releaserows,tol),
				'v6':compare_to_release(v6rows,releaserows,tol)}
			for tol in (20,50)}}

def main():
	parser=argparse.ArgumentParser(description=__doc__)
	parser.add_argument('--score-root',type=Path,default=Path('public/music/packs'))
	parser.add_argument('--out',type=Path,required=True)
	parser.add_argument('--include-fixed-windows',action='store_true')
	args=parser.parse_args()
	if args.out.exists():raise FileExistsError(args.out)
	scores={}
	queues={}
	sources={}
	# Fail closed on ANY master mismatch BEFORE producing candidate predictions.
	for package in sorted(args.score_root.glob('*/performance.json')):
		score=json.loads(package.read_text())
		song=score['songId']
		if song not in SOURCE_PATHS:continue
		queue=json.loads((package.parent/'review-queue-v1.json').read_text())
		if queue['songId']!=song or queue['baselineScoreHash']!=score['scoreHash'] or (
			queue['status']!='machine-ranked-disagreement-not-human-verified'):
			raise ValueError('Review queue does not match frozen source score: '+song)
		sources[song]=verify_master(song,score)
		scores[song]=score
		queues[song]=queue
	if set(scores)!=set(SOURCE_PATHS):
		raise ValueError('All four source-song packages must be verified')
	rows=[]
	for song in sorted(scores):
		score=scores[song]
		windows=[(x['id'],x) for x in queues[song]['excerpts']
			if x['role']=='drums']
		if args.include_fixed_windows:
			for start in (14,75):
				a=start*RATE
				b=min(a+8*RATE,score['frameCount'])
				windows.append((f'fixed-{start}s',{'startFrame':a,'endFrame':b}))
		for name,item in windows:
			if not 0<=item['startFrame']<item['endFrame']<=score['frameCount']:
				raise ValueError('Invalid source review excerpt bounds')
			row=clip_audit(song,score,item,name,sources[song])
			rows.append(row)
			print('REAL_SOURCE_UNLABELED',song,name,'released',row['releaseCounts'],
				'v5',row['v5Counts'],'v6',row['v6Counts'],flush=True)

	report={'format':'bitstream-v6-real-source-unlabeled-differential-v1',
		'status':STATUS,'humanVerified':False,'approvedForAudio':False,
		'readOnly':True,'sourceNode':'CT211 via Ursa Major pct exec',
		'fullSourceStemHashes':sources,
		'scoreSourceHashes':{song:score['scoreHash'] for song,score in scores.items()},
		'detectorCodeHashes':{n:hashlib.sha256((Path(__file__).parent/n).read_bytes())
			.hexdigest() for n in ('detector_candidate_v2.py',
				'detector_candidate_v4.py','detector_candidate_v6.py')},
		'windows':rows}
	args.out.parent.mkdir(parents=True,exist_ok=True)
	args.out.write_text(json.dumps(report,indent=2)+'\n')
	print('COMPLETED',len(rows),'real FLAC windows, NO accuracy claims',flush=True)
	print('EVIDENCE',args.out,flush=True)


if __name__=='__main__':
	main()
