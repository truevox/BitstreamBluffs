#!/usr/bin/env python3
"""Evaluate a *human verified* note/hit gold set against performance-v1.

No 125ms synthetic tolerance. One-to-one max-cardinality onset matching at
both 20ms and 50ms, with a secondary minimization of absolute timing error,
separately by role+pitch (drums by hit type). Reports signed bias, jitter,
false/missed events per minute. Never claims accuracy without verified gold.
"""
import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from performance_v1 import RATE,ROLES,read

GOLD_FORMAT='bitstream-performance-gold-v1'
TOLERANCES=(20,50)

def _better(a,b):
	"""More matches first, then less total absolute onset error."""
	if a[0]!=b[0]:return a[0]>b[0]
	return a[1]<b[1]

def match_events(predicted,gold,tolerance_frames):
	"""Monotonic max-cardinality, min-absolute-error matching.

	Musical onsets of the same pitch/class are temporally ordered; using
	DP avoids the many-to-one 'flam' matching that inflated old scores.
	"""
	n,m=len(predicted),len(gold)
	dp=[[(0,0) for j in range(m+1)] for i in range(n+1)]
	choices=[[None for j in range(m+1)] for i in range(n+1)]
	for i in range(n-1,-1,-1):
		for j in range(m-1,-1,-1):
			best=dp[i+1][j]
			move='skip-prediction'
			if _better(dp[i][j+1],best):
				best=dp[i][j+1];move='skip-gold'
			error=predicted[i]['startFrame']-gold[j]['startFrame']
			if abs(error)<=tolerance_frames:
				next_count,next_error=dp[i+1][j+1]
				option=(next_count+1,next_error+abs(error))
				if _better(option,best) or option==best:
					best=option;move='matched'
			dp[i][j]=best;choices[i][j]=move
	pairs=[]
	i=j=0
	while i<n and j<m:
		move=choices[i][j]
		if move=='matched':
			pairs.append((predicted[i],gold[j]))
			i+=1;j+=1
		elif move=='skip-prediction':i+=1
		else:j+=1
	return pairs

def _category(role,event):
	return event.get('class') if role=='drums' else event.get('pitch')

def validate_gold(gold,score):
	if not isinstance(gold,dict) or gold.get('format')!=GOLD_FORMAT or (
		gold.get('status')!='human-verified'):
		raise ValueError('Gold set is NOT verified')
	if gold.get('songId')!=score['songId'] or gold.get('baseScoreHash')!=score['scoreHash']:
		raise ValueError('Gold set does not reference this exact candidate score')
	if gold.get('sampleRate')!=RATE:
		raise ValueError('wrong gold reference sample rate')
	excerpts=gold.get('excerpts')
	if not isinstance(excerpts,list) or not excerpts:
		raise ValueError('missing gold excerpts')
	seen=set()
	for part in excerpts:
		id=part.get('id')
		if not isinstance(id,str) or not id or id in seen:raise ValueError('duplicate excerpt id')
		seen.add(id)
		a,b=part.get('startFrame'),part.get('endFrame')
		if not isinstance(a,int) or not isinstance(b,int) or not 0<=a<b<=score['frameCount']:
			raise ValueError('bad gold passage')
		if b-a>RATE*90:raise ValueError('gold excerpt longer than a single passage')
		annotations=part.get('annotations')
		if not isinstance(annotations,dict) or not annotations or (
			set(annotations)-set(ROLES)):
			raise ValueError('missing/invalid gold role annotations')
		for role,events in annotations.items():
			if not isinstance(events,list):raise ValueError('bad gold note list')
			for event in events:
				t=event.get('startFrame')
				if not isinstance(t,int) or not a<=t<b:
					raise ValueError('gold note outside excerpt')
				key=_category(role,event)
				if role=='drums':
					if key not in ('kick','snare','hat','tom','cymbal'):
						raise ValueError('bad gold drum class')
				elif not isinstance(key,int) or not 0<=key<=127:
					raise ValueError('bad gold pitch')
	return gold

def metrics(pairs,total_pred,total_gold,duration_frames):
	tp=len(pairs);fp=total_pred-tp;fn=total_gold-tp
	precision=tp/total_pred if total_pred else 1.0 if not total_gold else 0.
	recall=tp/total_gold if total_gold else 1.
	f1=(2*precision*recall/(precision+recall)) if precision+recall else 0.
	err=[(pred['startFrame']-gold['startFrame'])*1000/RATE
		for pred,gold in pairs]
	avg=sum(err)/len(err) if err else None
	sd=(math.sqrt(sum((v-avg)**2 for v in err)/len(err))) if err else None
	slope=None
	if len(pairs)>=3:
		x=[gold['startFrame']/RATE/60 for _,gold in pairs]
		mean_x=sum(x)/len(x)
		var=sum((v-mean_x)**2 for v in x)
		if var>1e-9:
			slope=sum((v-mean_x)*(e-avg) for v,e in zip(x,err))/var
	minutes=duration_frames/RATE/60
	return {
		'truePositive':tp,'falsePositive':fp,'falseNegative':fn,
		'precision':round(precision,6),'recall':round(recall,6),
		'f1':round(f1,6),
		'signedBiasMs':round(avg,3) if avg is not None else None,
		'jitterSdMs':round(sd,3) if sd is not None else None,
		'driftMsPerMinute':round(slope,3) if slope is not None else None,
		'falseEventsPerMinute':round(fp/minutes,3) if minutes else None,
		'missedEventsPerMinute':round(fn/minutes,3) if minutes else None,
	}

def evaluate(score,gold):
	validate_gold(gold,score)
	report={'format':'bitstream-performance-evaluation-v1',
		'songId':score['songId'],'candidateScoreHash':score['scoreHash'],
		'goldStatus':'human-verified','tolerancesMs':list(TOLERANCES),
		'excerpts':[],'aggregate':{}}
	total_duration=0
	all_groups={tol:{'pred':0,'gold':0,'pairs':[]} for tol in TOLERANCES}
	for excerpt in gold['excerpts']:
		a,b=excerpt['startFrame'],excerpt['endFrame']
		total_duration+=b-a
		item={'id':excerpt['id'],'startFrame':a,'endFrame':b,'roles':{},'metrics':{}}
		for role,human in excerpt['annotations'].items():
			candidates=[e for e in score['events'][role]
				if a<=e['startFrame']<b]
			item['roles'][role]={'predicted':len(candidates),'gold':len(human)}
		for tolerance in TOLERANCES:
			pairs=[]
			n_pred=n_gold=0
			for role,human in excerpt['annotations'].items():
				candidates=[e for e in score['events'][role] if a<=e['startFrame']<b]
				n_pred+=len(candidates);n_gold+=len(human)
				cat_pred=defaultdict(list);cat_human=defaultdict(list)
				for row in candidates:cat_pred[_category(role,row)].append(row)
				for row in human:cat_human[_category(role,row)].append(row)
				for category in cat_pred.keys()|cat_human.keys():
					h=sorted(cat_human[category],key=lambda row:row['startFrame'])
					p=sorted(cat_pred[category],key=lambda row:row['startFrame'])
					pairs.extend(match_events(p,h,round(tolerance*RATE/1000)))
			agg=all_groups[tolerance]
			agg['pred']+=n_pred;agg['gold']+=n_gold;agg['pairs'].extend(pairs)
			item['metrics'][str(tolerance)+'ms']=metrics(pairs,n_pred,n_gold,b-a)
		report['excerpts'].append(item)
	for tolerance,agg in all_groups.items():
		report['aggregate'][str(tolerance)+'ms']=metrics(agg['pairs'],
			agg['pred'],agg['gold'],total_duration)
	return report

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--performance',required=True,type=Path)
	p.add_argument('--gold',required=True,type=Path)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise FileExistsError('Never overwrite an evaluation report')
	score=read(a.performance)
	gold=json.loads(a.gold.read_text())
	report=evaluate(score,gold)
	a.out.write_text(json.dumps(report,indent=2)+'\n')
	print('MANUALLY_VERIFIED_GOLD_EVALUATION',a.out,
		json.dumps(report['aggregate'],sort_keys=True))

if __name__=='__main__':
	main()
