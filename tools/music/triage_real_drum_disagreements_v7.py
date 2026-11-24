#!/usr/bin/env python3
"""Source-hash-pinned, UNLABELED drum-event review triage.

Finds contentious attacks in actual drum FLACs. No 'false positive' labels:
the original release score is provisional and not independent ground truth.
Does not write in-game Music Lab data, score files, or audio assets.
"""
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from audit_cross_band_v6 import attack_bands, attack_features, source_predictions
from audit_real_drums_v6 import (KINDS, RATE, SOURCE_PATHS, STATUS,
	event_rows, read_pcm, verify_master)
from detector_candidate_v6 import cross_band_veto, MIN_FAMILY_SHARE
from evaluate_performance_v1 import match_events

CATEGORIES=('vetoed-but-release-agrees','retained-but-release-disagrees',
	'cross-family-coincidence','short-same-family-restrike',
	'vetoed-and-release-disagrees')
REVIEW_STATUS='machine-only-review-priority, NOT human gold, NOT a confirmed error'


def attach_release_matches(candidates, released, tolerance_ms):
	"""Match same-family events one-to-one; record release sample frames."""
	matches={}
	for family in KINDS:
		p=sorted([e for e in candidates if e['type']==family],
			key=lambda x:(x['startFrame'],x['index']))
		g=sorted([e for e in released if e['type']==family],
			key=lambda x:x['startFrame'])
		for pred,ref in match_events(p,g,round(tolerance_ms*RATE/1000)):
			matches[pred['index']]=ref['startFrame']
	return matches

def describe_candidate(event, siblings, v6_remaining, match20, match50, bands,
	start_frame, end_frame):
	kind=event['type']
	frame=event['startFrame']
	key=(frame,kind)
	preserved=v6_remaining[key]>0
	if preserved:v6_remaining[key]-=1
	t=event['relativeSec']
	rise=attack_features(bands,t)
	total=sum(rise.values())
	share=rise[kind]/max(1e-10,total)
	nearest_other=min((abs(frame-x['startFrame']) for x in siblings
		if x['index']!=event['index'] and x['type']!=kind),default=None)
	nearest_same=min((abs(frame-x['startFrame']) for x in siblings
		if x['index']!=event['index'] and x['type']==kind),default=None)
	near_cross=nearest_other is not None and nearest_other<=round(.025*RATE)
	quick_strike=nearest_same is not None and (
		round(.050*RATE)<=nearest_same<=round(.180*RATE))
	boundary=frame-start_frame<round(.200*RATE) or (
		end_frame-frame<round(.200*RATE))
	concordant=event['index'] in match20
	reasons=[]
	if not preserved:
		reasons.append('vetoed-but-release-agrees' if concordant
			else 'vetoed-and-release-disagrees')
	elif not concordant:
		reasons.append('retained-but-release-disagrees')
	if near_cross:reasons.append('cross-family-coincidence')
	if quick_strike:reasons.append('short-same-family-restrike')
	# Never convert V1 release agreement into positive/negative accuracy labels.
	return {'class':kind,'startFrame':frame,
		'startSeconds':round(frame/RATE,5),'windowRelativeMs':round(t*1000,2),
		'v6Retained':preserved,'v6OwnBandShare':round(share,5),
		'v6Threshold':MIN_FAMILY_SHARE[kind],
		'attackEnergyRise':{k:round(float(v),8) for k,v in rise.items()},
		'strongestBand':max(rise,key=rise.get),
		'within20msOfProvisionalRelease':concordant,
		'matchedProvisionalReleaseFrame20ms':match20.get(event['index']),
		'matchedProvisionalReleaseFrame50ms':match50.get(event['index']),
		'nearestOtherFamilyMs':round(nearest_other*1000/RATE,2)
			if nearest_other is not None else None,
		'nearestSameFamilyMs':round(nearest_same*1000/RATE,2)
			if nearest_same is not None else None,
		'withinWindowBoundary200ms':boundary,
		'machineReasons':reasons,
		'status':REVIEW_STATUS}

def triage_window(song,score,part,source_hash):
	start,end=part['startFrame'],part['endFrame']
	if not 0<=start<end<=score['frameCount'] or end-start>20*RATE:
		raise ValueError('Untrusted or overlength window')
	wave=read_pcm(song,start,end)
	before_hash=hashlib.sha256(wave.tobytes()).hexdigest()
	v5=source_predictions(wave)
	v6,diagnostics=cross_band_veto(wave)
	after_hash=hashlib.sha256(wave.tobytes()).hexdigest()
	if before_hash!=after_hash:raise ValueError('Mutated source PCM')
	rows=[{**e,'relativeSec':v5[i]['t'],'index':i}
		for i,e in enumerate(event_rows(v5,start))]
	# Event rows sort independently of V5 order; recover positions by
	# startFrame/class rather than assuming detector ordering is stable.
	position=defaultdict(list)
	for e in v5:
		position[(start+round(e['t']*RATE),e['type'])].append(e['t'])
	for e in rows:
		instances=position[(e['startFrame'],e['type'])]
		if not instances:raise ValueError('Unmatched proposal identity')
		e['relativeSec']=instances.pop(0)
	if any(position.values()):raise ValueError('Unconsumed proposal identities')
	released=event_rows([r for r in score['events']['drums'] if
		start<=r['startFrame']<end and r['class'] in KINDS],start,True)
	match20=attach_release_matches(rows,released,20)
	match50=attach_release_matches(rows,released,50)
	remain=Counter((e['startFrame'],e['type']) for e in event_rows(v6,start))
	bands=attack_bands(wave)
	annotated=[describe_candidate(e,rows,remain,match20,match50,
		bands,start,end) for e in rows]
	if any(remain.values()):raise ValueError('V6 emitted an unknown onset')
	if sum(e['v6Retained'] for e in annotated)!=len(v6):
		raise ValueError('Event matching count mismatch')
	return {'songId':song,'sourceStemSha256':source_hash,
		'baselineScoreHash':score['scoreHash'],
		'windowId':part['id'],'startFrame':start,'endFrame':end,
		'decodedPcmSha256':before_hash,'decodedPcmSamples16k':len(wave),
		'provisionalReleaseCount':len(released),'v5Count':len(v5),
		'v6Count':len(v6),'v6SuppressedCount':diagnostics['input']-len(v6),
		'events':annotated,'status':REVIEW_STATUS}
def shortlist(windows,per_song=8):
	"""Diversify songs/classes/reasons; never mark judgments as accurate."""
	by_song=defaultdict(list)
	for part in windows:
		for e in part['events']:
			if e['withinWindowBoundary200ms'] or not e['machineReasons']:
				continue
			best=min((CATEGORIES.index(r) for r in e['machineReasons']))
			by_song[part['songId']].append({
				'songId':part['songId'],'windowId':part['windowId'],
				'startFrame':e['startFrame'],'startSeconds':e['startSeconds'],
				'class':e['class'],'rankBucket':best,
				'v6Retained':e['v6Retained'],
				'v6OwnBandShare':e['v6OwnBandShare'],
				'machineReasons':e['machineReasons'],
				'sourceStemSha256':part['sourceStemSha256'],
				'baselineScoreHash':part['baselineScoreHash'],
				'status':REVIEW_STATUS})
	out=[]
	for song in sorted(by_song):
		options=sorted(by_song[song],key=lambda x:(x['rankBucket'],
			abs(x['v6OwnBandShare']-.1),x['startFrame'],x['class']))
		chosen=[]
		reasons_seen=set()
		# One representative per available reason bucket first.
		for reason in range(len(CATEGORIES)):
			for row in options:
				if row['rankBucket']==reason and all(
					abs(row['startFrame']-seen['startFrame'])>RATE//3
					for seen in chosen):
					chosen.append(row)
					reasons_seen.add(reason)
					break
		for row in options:
			if len(chosen)>=per_song:break
			if row not in chosen and all(
				abs(row['startFrame']-seen['startFrame'])>RATE//3
				for seen in chosen):chosen.append(row)
		out.extend(chosen[:per_song])
	return sorted(out,key=lambda x:(x['songId'],x['rankBucket'],
		x['startFrame'],x['class']))
def load_source_windows(root):
	songs={}
	for item in sorted(root.glob('*/performance.json')):
		score=json.loads(item.read_text())
		song=score['songId']
		if song not in SOURCE_PATHS:continue
		queue=json.loads((item.parent/'review-queue-v1.json').read_text())
		if queue.get('songId')!=song or queue.get('baselineScoreHash')!=score.get('scoreHash'):
			raise ValueError('Review queue source/score mismatch')
		if queue.get('status')!='machine-ranked-disagreement-not-human-verified':
			raise ValueError('Review queue is not marked unverified')
		hash_verified=verify_master(song,score)
		parts=[{**x,'id':x['id']} for x in queue['excerpts']
			if x['role']=='drums']
		for start in (14,75):
			a=start*RATE
			b=min(a+8*RATE,score['frameCount'])
			parts.append({'id':f'fixed-{start}s','startFrame':a,'endFrame':b})
		songs[song]=(score,parts,hash_verified)
	if set(songs)!=set(SOURCE_PATHS):
		raise ValueError('Four source FLAC hashes not verified')
	return songs


def run(root):
	windows=[]
	for song,(score,parts,source_hash) in load_source_windows(root).items():
		for part in parts:
			window=triage_window(song,score,part,source_hash)
			windows.append(window)
			print('REVIEW_TRIAGE',song,part['id'],len(window['events']),
				'preserved',window['v6Count'],flush=True)
	picks=shortlist(windows)
	return {'format':'bitstream-real-drum-machine-review-triage-v7',
		'status':REVIEW_STATUS,'humanVerified':False,'approvedForAudio':False,
		'source':STATUS,'timebaseHz':RATE,
		'modelAgreementIsNotTruth':True,'windows':windows,
		'shortlist':picks,'shortlistCategoryOrder':list(CATEGORIES),
		'detectorSourceSha256':{n:hashlib.sha256((Path(__file__).parent/n)
			.read_bytes()).hexdigest() for n in (
			'detector_candidate_v2.py','detector_candidate_v4.py',
			'detector_candidate_v6.py')}}
def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--score-root',type=Path,default=Path('public/music/packs'))
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise FileExistsError(a.out)
	report=run(a.score_root)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('UNVERIFIED REVIEW PRIORITIES',len(report['shortlist']),
		'FROM',len(report['windows']),'real-source windows',flush=True)
	print('EVIDENCE',a.out,flush=True)


if __name__=='__main__':
	main()
