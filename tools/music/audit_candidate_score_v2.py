#!/usr/bin/env python3
"""Comparative review queue for two source-pinned performance-v1 scores.

IMPORTANT: Neither score is ground truth. Matches/disagreements are only
*model-to-model agreement*, not precision, recall or a proof of accuracy.
Rank disagreements and conservative source-attack-density alarms for a
future human-annotated real-song gold set. No WAV/Opus outputs or game writes.
"""
import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

from performance_v1 import read, ROLES,STEMS
from evaluate_performance_v1 import match_events

RATE=48000
WINDOW_SEC=8
WINDOW=WINDOW_SEC*RATE
TOLERANCE_MS=50
TOLERANCE=round(RATE*TOLERANCE_MS/1000)
PRIORITY={'melody':5.,'bass':4.,'drums':3.5,'guitar':2.,'piano':2.5,'other':2.}
SONG_NAMES={
	'FEsxYVStla4':'Pope',
	'local-one-more-run-bitstream-bluffs':'One More Run',
	'WRBGQUqD54U':'Runs Out of Code',
	'FYImnz5-hXs':'Varmont',
}

def label(role,item):
	return item['class'] if role=='drums' else item['pitch']

def same_pitch_match(base,alternate,role,tolerance=TOLERANCE):
	a=defaultdict(list);b=defaultdict(list)
	for item in base:a[label(role,item)].append(item)
	for item in alternate:b[label(role,item)].append(item)
	matches=[]
	for key in a.keys()|b.keys():
		lhs=sorted(a[key],key=lambda e:e['startFrame'])
		rhs=sorted(b[key],key=lambda e:e['startFrame'])
		matches.extend(match_events(lhs,rhs,tolerance))
	return matches

def summarize_pair(old,new,role):
	pairs=same_pitch_match(old,new,role)
	deltas=[b['startFrame']-a['startFrame'] for a,b in pairs]
	agree=len(pairs)
	nold=len(old);nnew=len(new)
	return {
		'role':role,
		'oldEvents':nold,
		'candidateEvents':nnew,
		'samePitchWithin50ms':agree,
		'onlyOld':nold-agree,
		'onlyCandidate':nnew-agree,
		'agreementPerOld':round(agree/nold,4) if nold else None,
		'agreementPerCandidate':round(agree/nnew,4) if nnew else None,
		'medianCandidateMinusReleaseMs':round(
			float(sorted(deltas)[len(deltas)//2])*1000/RATE,2) if deltas else None,
		'labels':'model-to-model agreement ONLY, never accuracy',
	}

def audit(base,alternate):
	if base['songId']!=alternate['songId']:
		raise ValueError('score song mismatch')
	if base['quality']!='provisional-unreviewed':
		raise ValueError('baseline is not an unchanged shipped performance')
	if alternate['quality']!='experimental-candidate-unreviewed':
		raise ValueError('alternate must explicitly be experimental')
	if base['scoreHash']==alternate['scoreHash']:
		raise ValueError('candidate was not changed')
	for key in ('sampleRate','frameCount','featuredStem'):
		if base[key]!=alternate[key]:raise ValueError('score geometry mismatch')
	if base['provenance']['sourceStemSha256']!=alternate['provenance']['sourceStemSha256']:
		raise ValueError('SOURCE FINGERPRINT MISMATCH')
	if (alternate['provenance']['evidence'].get('parentScoreHash')
		!=base['scoreHash']):
		raise ValueError('candidate does not descend from this baseline')
	if alternate['events']['melody']!=base['events']['melody']:
		raise ValueError('candidate changed unchanged source melodic notes')
	durations=int(math.ceil(base['frameCount']/WINDOW))
	whole={role:summarize_pair(base['events'][role],alternate['events'][role],role)
		for role in ROLES}
	sections=[]
	for section in range(durations):
		low=section*WINDOW
		high=min(base['frameCount'],(section+1)*WINDOW)
		real_duration=(high-low)/RATE
		if real_duration<3:continue
		for role in ROLES:
			if role=='melody':continue
			prior=[e for e in base['events'][role] if low<=e['startFrame']<high]
			after=[e for e in alternate['events'][role] if low<=e['startFrame']<high]
			c=summarize_pair(prior,after,role)
			if not c['oldEvents'] and not c['candidateEvents']:continue
			disagree=c['onlyOld']+c['onlyCandidate']
			# Both excessive unmatched density and empty candidate output
			# indicate review priority, not an accuracy judgment.
			contribution=PRIORITY[role]*(disagree/max(1.,real_duration))
			density_new=c['candidateEvents']/real_duration
			density_old=c['oldEvents']/real_duration
			suspicion=round(contribution,3)
			sections.append({
				'songId':base['songId'],'song':SONG_NAMES.get(base['songId'],base['songId']),
				'role':role,'startFrame':low,'endFrame':high,
				'startSec':round(low/RATE,3),'endSec':round(high/RATE,3),
				'priorityProxy':suspicion,
				'disagreementsPerSec':round(disagree/real_duration,3),
				'candidateDensityPerSec':round(density_new,3),
				'releaseDensityPerSec':round(density_old,3),
				'releaseCount':c['oldEvents'],
				'candidateCount':c['candidateEvents'],
				'samePitchWithin50ms':c['samePitchWithin50ms'],
				'mismatchOld':c['onlyOld'],
				'mismatchCandidate':c['onlyCandidate'],
				'goldStatus':'UNVERIFIED — inspection priority only',
			})
	sections.sort(key=lambda row:(-row['priorityProxy'],row['startFrame'],row['role']))
	return {'songId':base['songId'],
		'originalHash':base['scoreHash'],'candidateHash':alternate['scoreHash'],
		'roleComparisons':whole,'priorityExcerpts':sections}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--baseline',required=True,type=Path)
	p.add_argument('--candidate',required=True,type=Path)
	p.add_argument('--out',required=True,type=Path)
	p.add_argument('--top',type=int,default=20)
	a=p.parse_args()
	if a.out.exists():raise FileExistsError('Never overwrite a previous review')
	if a.top<1 or a.top>300:raise ValueError('bad top count')
	old_root=a.baseline
	new_root=a.candidate
	originals=sorted(old_root.glob('packs/*/performance.json'))
	if len(originals)!=4:raise ValueError('must compare all four shipped scores')
	items=[]
	for old_file in originals:
		folder=old_file.parent.name
		new_file=new_root/'packs'/folder/'performance-candidate-v2.json'
		audit_result=audit(read(old_file),read(new_file))
		items.append(audit_result)
		print('REAL_SONG_DIFFERENTIAL',audit_result['songId'],flush=True)
		for role,result in audit_result['roleComparisons'].items():
			print(' ',role,'old',result['oldEvents'],
				'new',result['candidateEvents'],
				'pitch-onset-agreement',result['samePitchWithin50ms'],
				'unmatched',result['onlyOld']+result['onlyCandidate'],flush=True)
	ranked=sorted([row for item in items for row in item['priorityExcerpts']],
		key=lambda row:(-row['priorityProxy'],row['songId'],row['startFrame'],row['role']))
	# Diversify the earliest six gold excerpts across songs/roles so
	# manual QA doesn't only see one song or one bad detector family.
	selected=[]
	seen=set()
	for row in ranked:
		key=(row['songId'],row['role'])
		if key in seen:continue
		selected.append(row);seen.add(key)
		if len(selected)>=min(a.top,12):break
	for row in ranked:
		if len(selected)>=a.top:break
		if row not in selected:selected.append(row)
	report={'format':'bitstream-real-music-model-disagreement-queue-v1',
		'goldStatus':'NONE — candidate AND baseline unverified',
		'comparison':'one-to-one exact pitch/hit-class and ±50ms',
		'selectionNotGold':'PRIORITY PROXY ONLY; no onset accuracy claims',
		'fourSongs':items,'proposedReviewExcerpts':selected,
		'allRankedExcerpts':ranked}
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('REVIEW_QUEUE_SAVED',a.out,'RANKED',len(ranked),
		'SELECTED',len(selected),flush=True)

if __name__=='__main__':
	main()
