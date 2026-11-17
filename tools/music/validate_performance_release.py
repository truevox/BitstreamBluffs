#!/usr/bin/env python3
"""Fail-closed release gate: new score sidecars, ZERO changed audio bytes.

Checks the exact original 4745 Ogg sources and untouched gameplay pack
segments against the already-published previous main, *and* checks every
performance-v1 event and hash. Separate score artifact only; no claim of
musical accuracy or corrected note events.
"""
import argparse
import hashlib
import json
from pathlib import Path

from performance_v1 import ROLES,read,sha256_file

EXPECTED_COUNTS={
	'FEsxYVStla4':{'bass':209,'drums':1743,'guitar':1216,
		'melody':716,'other':2228,'piano':1256},
	'local-one-more-run-bitstream-bluffs':{
		'bass':301,'drums':1860,'guitar':2028,'melody':464,
		'other':3548,'piano':2896},
	'WRBGQUqD54U':{'bass':202,'drums':1787,'guitar':2214,
		'melody':576,'other':1952,'piano':1716},
	'FYImnz5-hXs':{'bass':143,'drums':1600,'guitar':834,
		'melody':595,'other':2004,'piano':1664},
}

def run(current,baseline):
	current=Path(current)
	baseline=Path(baseline)
	cat=json.loads((current/'catalog.json').read_text())
	oldcat=json.loads((baseline/'catalog.json').read_text())
	assert cat==oldcat
	assert len(cat['tracks'])==4
	ogg_count=0
	scores={}
	for song in cat['tracks']:
		id=song['id']
		new_path=current/song['manifest']
		old_path=baseline/song['manifest']
		pack=json.loads(new_path.read_text())
		old_pack=json.loads(old_path.read_text())
		meta=pack.pop('performance')
		# The JSON *contents* other than the new score pointer must be
		# identical. No source, DSP, timbre or instrument selector changed.
		assert pack==old_pack,'SHIPPING_AUDIO_MANIFEST_WAS_MODIFIED '+id
		assert meta['path']=='performance.json'
		score_path=(new_path.parent/meta['path']).resolve()
		assert score_path.is_relative_to(current.resolve())
		score=read(score_path)
		assert score['songId']==id
		assert score['scoreHash']==meta['scoreHash']
		assert score['frameCount']==pack['frameCount']==old_pack['frameCount']
		assert score['featuredStem']==pack['adaptive']['featuredStem']
		assert {name:len(rows) for name,rows in score['events'].items()}==EXPECTED_COUNTS[id],id
		assert score['quality']=='provisional-unreviewed'
		assert score['calibratedConfidence'] is False
		# All 4,745 packaged Ogg clips unchanged: compare hashes for each
		# relative path in both deployed trees, not only file size.
		original={p.relative_to(old_path.parent):p for p in
			old_path.parent.rglob('*.ogg')}
		new={p.relative_to(new_path.parent):p for p in new_path.parent.rglob('*.ogg')}
		if new.keys()!=original.keys():
			raise AssertionError('MEDIA_FILES_ADDED_OR_REMOVED '+id)
		for rel,file in new.items():
			if sha256_file(file)!=sha256_file(original[rel]):
				raise AssertionError('OGG_CHANGED '+id+' '+str(rel))
		ogg_count+=len(new)
		scores[id]={'scoreHash':score['scoreHash'],
			'events':sum(len(score['events'][role]) for role in ROLES),
			'unchangedAudio':len(new)}
		print('ORIGINAL_AUDIO_AND_SCORE_IDENTITY_PASS',id,
			'OGG',len(new),'events',scores[id]['events'],flush=True)
	assert ogg_count==4745,ogg_count
	assert sum(row['events'] for row in scores.values())==33752
	return {'format':'bitstream-performance-release-gate-v1',
		'scores':scores,'unchangedOgg':ogg_count,'sourceTracks':4,
		'uncalibrated':True,
		'meaning':'source event provenance and score playback markers only; no improved pitch/timing'}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--current',type=Path,required=True)
	p.add_argument('--baseline',type=Path,required=True)
	p.add_argument('--report',type=Path,required=True)
	a=p.parse_args()
	if a.report.exists():raise FileExistsError(a.report)
	result=run(a.current,a.baseline)
	a.report.parent.mkdir(parents=True,exist_ok=True)
	a.report.write_text(json.dumps(result,indent=2)+'\n')
	print('PERFORMANCE_RELEASE_EVIDENCE_GATE_PASS',result['unchangedOgg'],
		'ORIGINAL_AUDIO_BYTES_UNCHANGED',flush=True)

if __name__=='__main__':
	main()
