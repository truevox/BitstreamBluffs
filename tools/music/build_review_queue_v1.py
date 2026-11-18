#!/usr/bin/env python3
"""Build a SMALL and source-pinned in-game review shortlist from the existing
UNLABELED model-disagreement audit. No inferred errors are called true.

This is NOT a gold set and NOT a new transcription. The exported artifacts
never contain source audio and never modify a game sound or user profile.
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

from performance_v1 import read,ROLES

FORMAT='bitstream-music-review-queue-v1'
STATUS='machine-ranked-disagreement-not-human-verified'
SOURCE_FORMAT='bitstream-real-music-model-disagreement-queue-v1'


def make_queues(audit, music_root):
	if audit.get('format')!=SOURCE_FORMAT or audit.get('goldStatus')!=(
		'NONE — candidate AND baseline unverified'):
		raise ValueError('invalid original model-disagreement audit')
	selection=audit.get('proposedReviewExcerpts')
	if not isinstance(selection,list) or len(selection)!=20:
		raise ValueError('expected precisely the preserved 20 proposed excerpts')
	grouped=defaultdict(list)
	seen=set()
	for index,part in enumerate(selection):
		song=part['songId']
		role=part['role']
		start,end=part['startFrame'],part['endFrame']
		if role not in ROLES or role=='melody':
			raise ValueError('bad review role')
		if not all(type(v) is int for v in (start,end)) or not (
			0<=start<end and end-start<=8*48000):
			raise ValueError('invalid sample-frame range')
		key=(song,role,start,end)
		if key in seen:raise ValueError('duplicate selected excerpt')
		seen.add(key)
		row={
			'id':role+'-'+str(start),
			'role':role,
			'startFrame':start,
			'endFrame':end,
			'priorityOrder':index+1,
			'releaseCount':part['releaseCount'],
			'candidateCount':part['candidateCount'],
			'samePitchWithin50ms':part['samePitchWithin50ms'],
			'disagreementProxy':part['priorityProxy'],
		}
		if any(type(row[k]) is not int or row[k]<0 for k in (
			'releaseCount','candidateCount','samePitchWithin50ms','priorityOrder')):
			raise ValueError('invalid reference counts')
		if row['samePitchWithin50ms']>min(
			row['releaseCount'],row['candidateCount']):
			raise ValueError('impossible one-to-one agreement count')
		grouped[song].append(row)
	catalog=json.loads((music_root/'catalog.json').read_text())
	songs=catalog.get('tracks',[])
	if len(songs)!=4:raise ValueError('wrong song manifest count')
	output={}
	for song in songs:
		id=song['id']
		assert id in grouped,'song missing from manual-review shortlist'
		pack_path=music_root/song['manifest']
		pack=json.loads(pack_path.read_text())
		parent=read(pack_path.parent/'performance.json')
		candidate=read(pack_path.parent/'performance-candidate-v2.json')
		if parent['quality']!='provisional-unreviewed' or (
			candidate['quality']!='experimental-candidate-unreviewed'):
			raise ValueError('non-matching original score source')
		if candidate['provenance']['evidence']['parentScoreHash']!=parent['scoreHash']:
			raise ValueError('not a candidate descended from release score')
		if (parent['scoreHash']!=pack['performance']['scoreHash'] or
			candidate['scoreHash']!=pack['experimentalPerformance']['scoreHash']):
			raise ValueError('score hashes do not match pack')
		if candidate['provenance']['sourceStemSha256']!=parent['provenance']['sourceStemSha256']:
			raise ValueError('wrong original master audio')
		for row in grouped[id]:
			if row['endFrame']>parent['frameCount']:
				raise ValueError('review exceeds music duration')
		output[id]={
			'format':FORMAT,'songId':id,'status':STATUS,
			'baselineScoreHash':parent['scoreHash'],
			'experimentalScoreHash':candidate['scoreHash'],
			'selectionMethod':'machine ranking of pitch/class disagreements within 50ms, NOT correctness',
			'excerpts':grouped[id]}
		print('UNVERIFIED_REVIEW_SHORTLIST',id,len(grouped[id]),flush=True)
	return output


def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--audit',required=True,type=Path)
	p.add_argument('--music-root',required=True,type=Path)
	p.add_argument('--output-dir',required=True,type=Path)
	a=p.parse_args()
	audit=json.loads(a.audit.read_text())
	result=make_queues(audit,a.music_root)
	if a.output_dir.exists():
		raise FileExistsError('review queue output must be a fresh directory')
	# User-facing queue is small; no large original model audit is copied.
	a.output_dir.mkdir(parents=True)
	catalog=json.loads((a.music_root/'catalog.json').read_text())
	for song in catalog['tracks']:
		path=a.output_dir/Path(song['manifest']).parent/'review-queue-v1.json'
		path.parent.mkdir(parents=True,exist_ok=True)
		path.write_text(json.dumps(result[song['id']],indent=2)+'\n')
	assert sum(len(x['excerpts']) for x in result.values())==20
	print('TWENTY_SOURCE_PINNED_REVIEW_EXCERPTS_NOT_HUMAN_GOLD')

if __name__=='__main__':
	main()
