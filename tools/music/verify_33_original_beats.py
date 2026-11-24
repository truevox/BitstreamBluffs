#!/usr/bin/env python3
"""Independent source fingerprint / timing / fail-closed audit of 33 beat maps."""
import argparse
import hashlib
import json
import math
from pathlib import Path

RATE=48000

def sha(p):
	h=hashlib.sha256()
	with p.open('rb') as handle:
		for part in iter(lambda:handle.read(4<<20),b''):
			h.update(part)
	return h.hexdigest()

def verify(master,results):
	roster=json.loads((master/'game-stems-manifest.json').read_text())['tracks']
	assert len(roster)==33 and len({x['id'] for x in roster})==33
	summary=[]
	for track in roster:
		name=f'{int(track["slot"]):02d}_{track["id"]}'
		path=results/(name+'.json')
		assert path.is_file(),f'Missing source beat map {name}'
		report=json.loads(path.read_text())
		assert report['trackId']==track['id'] and int(report['slot'])==int(track['slot'])
		assert report['status']=='UNVERIFIED_SOURCE_BEAT_CANDIDATES'
		assert report['beatOne']=='UNVERIFIED' and report['meter']=='UNVERIFIED'
		assert report['tempoDrift']=='UNVERIFIED'
		assert report['sourceSampleRate']==11025 and report['outputFrameRate']==RATE
		assert 60<=report['sourceSeconds']<=600
		paths=report['sourceStemPaths']
		assert set(paths)=={'drums','bass'}
		for key,relative in paths.items():
			p=(master/relative).resolve()
			assert master.resolve() in p.parents
			assert sha(p)==report['sourceStemSha256'][key],f'Original fingerprint mismatch {name}/{key}'
		paths=report['candidateBeatPaths']
		assert len(paths)==2,(name,len(paths))
		for q in paths:
			assert q['priorBpm'] in (105.,165.)
			assert 48<q['algorithmEstimatedBpm']<250
			assert len(q['hypothetical4BeatMeterOffsets'])==4
			assert {e['hypotheticalFirstBeatIndexMod4'] for e in q['hypothetical4BeatMeterOffsets']}=={0,1,2,3}
			beats=q['beatsSourceFrames48k']
			assert len(beats)>12
			assert all(isinstance(b,int) and 0<=b<math.ceil(report['sourceSeconds']*RATE)+RATE for b in beats)
			assert all(a<b for a,b in zip(beats,beats[1:]))
			assert all(.0<=q[k]<=1. for k in ('drumOnsetSupportNotConfidence','bassOnsetSupportNotConfidence','jointDrumBassSupportNotConfidence'))
		assert 0<len(report['localDrumPeriodicityWindows'])<150
		assert 0<len(report['localBassPeriodicityWindows'])<150
		for key in ('localDrumPeriodicityWindows','localBassPeriodicityWindows'):
			assert all(69<x['bpmPeriodicityHypothesis']<218 for x in report[key])
		summary.append({'slot':track['slot'],'id':track['id'],'title':track['title'],
			'sourceSeconds':report['sourceSeconds'],
			'bpmHypotheses':[q['algorithmEstimatedBpm'] for q in paths],
			'beatCounts':[len(q['beatsSourceFrames48k']) for q in paths],
			'onsetSupportDrums':[q['drumOnsetSupportNotConfidence'] for q in paths],
			'onsetSupportBass':[q['bassOnsetSupportNotConfidence'] for q in paths],
			'sha256':sha(path)})
	return summary

if __name__=='__main__':
	p=argparse.ArgumentParser()
	p.add_argument('--master',type=Path,default=Path('/root/bitstream-maxi/launch33'))
	p.add_argument('--beat-results',required=True,type=Path)
	p.add_argument('--summary',required=True,type=Path)
	a=p.parse_args()
	results=verify(a.master,a.beat_results)
	ambiguous=sum(abs(x['bpmHypotheses'][0]-x['bpmHypotheses'][1])>15 for x in results)
	artifact={'format':'bitstream-original-33-beat-research-summary-v1',
		'status':'ALL_33_SOURCE_BOUND_BUT_UNVERIFIED',
		'meaning':'Candidates only. Bar one, actual quarter-note, meter, section timing and tempo drift not independently verified. Do not use as production Gym/World Dance grid.',
		'songs':results,'sourceFilesVerified':len(results)*2,
		'differentPriorBpmDisagreementOver15':ambiguous}
	if a.summary.exists():raise FileExistsError(a.summary)
	a.summary.write_text(json.dumps(artifact,indent=2)+'\n')
	print('BEAT33_SOURCE_VERIFICATION_PASS',len(results),'source FLAC files',len(results)*2,
		'15+BPM disagreements',ambiguous,flush=True)
