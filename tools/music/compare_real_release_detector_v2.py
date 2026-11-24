#!/usr/bin/env python3
"""Real music detector-v2 *differential*, not unlabeled 'accuracy'.

Compare selected 30s source passages from all 4 actual FLAC song parts against
the immutable original release-v1 scores. Do not classify unmatched notes as
true/false without gold. Never write into public game packs or original scores.
"""
import argparse
import hashlib
import json
import math
import subprocess
from collections import Counter
from pathlib import Path

import numpy as np
from detector_candidate_v2 import accompaniment
from performance_v1 import read,STEMS,sha256_file

ROLE_NAMES=('guitar','piano','other')
PARTS=((14,30),(75,30))

def read_audio_window(source,start,duration):
	cmd=['ffmpeg','-nostdin','-hide_banner','-loglevel','error',
		'-ss',str(start),'-i',str(source),'-t',str(duration),
		'-ac','1','-ar','16000','-f','f32le','pipe:1']
	result=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
		timeout=95,check=True)
	out=np.frombuffer(result.stdout,dtype='<f4').copy()
	if len(out)<duration*16000*.95:raise ValueError('short source window')
	if not np.all(np.isfinite(out)):raise ValueError('non-finite source')
	return out

def stats(events,length_sec):
	midis=[e['midi'] for e in events]
	times=[e['start'] for e in events]
	ordered=all(x<=y for x,y in zip(times,times[1:]))
	# Chord notes may occur at same frame.
	same_pitch_repeats=0
	most_recent={}
	for e in events:
		prev=most_recent.get(e['midi'])
		if prev is not None and .075<=e['start']-prev<=.26:
			same_pitch_repeats+=1
		most_recent[e['midi']]=e['start']
	# Do not call this 'flams' without truth; only candidate event density.
	attacks=sorted(set(times))
	close=sum(a-b<.08 for a,b in zip(attacks[1:],attacks[:-1]))
	return {'events':len(events),'notesPerMinute':round(
		len(events)*60/length_sec,1),'possibleLow41to55':sum(
		p<=55 for p in midis),'uniqueLowPitches':sorted(set(
		p for p in midis if p<=55)),'uniquePitches':len(set(midis)),
		'uniqueAttacks':len(attacks),'attacksLessThan80msApart':close,
		'nearRepeatsSamePitch75to260ms':same_pitch_repeats,
		'sortedByOnset':ordered}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--master',required=True,type=Path)
	p.add_argument('--score-root',required=True,type=Path)
	p.add_argument('--catalog',required=True,type=Path)
	p.add_argument('--out',required=True,type=Path)
	p.add_argument('--only-song',action='append')
	a=p.parse_args()
	if a.out.exists():raise FileExistsError(a.out)
	roster=json.loads((a.master/'game-stems-manifest.json').read_text())
	catalog=json.loads((a.catalog/'catalog.json').read_text())
	reports=[]
	for song in catalog['tracks']:
		if a.only_song and song['id'] not in a.only_song:continue
		row=next(r for r in roster['tracks'] if r['id']==song['id'])
		stems=row['stem_files'] if row['slot']!=33 else row['grouped_6s']['stemFiles']
		score=read(a.score_root/Path(song['manifest']).parent/'performance.json')
		assert score['songId']==song['id']
		if score['quality']!='provisional-unreviewed':raise ValueError('Not original release')
		for role in ROLE_NAMES:
			source=a.master/stems[role]
			if sha256_file(source)!=score['provenance']['sourceStemSha256'][role]:
				raise ValueError('wrong source audio: '+role)
			for start,duration in PARTS:
				y=read_audio_window(source,start,duration)
				candidate,info=accompaniment(y)
				# Original release uses rounded 48kHz frame timestamps.
				old=[{'midi':e['pitch'],
					'start':round(e['startFrame']/48000-start,4)}
					for e in score['events'][role] if
					start*48000<=e['startFrame']<(start+duration)*48000]
				item={'song':song['id'],'role':role,
					'startSec':start,'durationSec':duration,
					'sourceStemSha256':score['provenance']['sourceStemSha256'][role],
					'decodedWindowSha256':hashlib.sha256(y.tobytes()).hexdigest(),
					'baseline':stats(old,duration),
					'candidate':stats(candidate,duration),
					'candidateDetector':info,
					'goldValidation':'NONE — cannot infer true/false positives from counts'}
				reports.append(item)
				print('REAL_SOURCE_UNLABELED',song['id'],role,start,
					'old',len(old),'new',len(candidate),
					'lowold',item['baseline']['possibleLow41to55'],
					'lownew',item['candidate']['possibleLow41to55'],
					'oldHighDensity',item['baseline']['attacksLessThan80msApart'],
					'newHighDensity',item['candidate']['attacksLessThan80msApart'],
					flush=True)
	report={'format':'bitstream-real-source-detector-audit-v1',
		'readOnly':True,'modelConfidenceCalibrated':False,
		'passages':reports,'claims':'descriptive event differences only; NO gold/music accuracy',
		'generatorSha256':sha256_file(Path(__file__)),
		'detectorSha256':sha256_file(Path(__file__).with_name(
			'detector_candidate_v2.py'))}
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('REAL_SOURCE_DIFFERENTIAL_COMPLETED',len(reports),'passages',flush=True)

if __name__=='__main__':
	main()
