#!/usr/bin/env python3
"""Exact-source candidate performance v2 exporter — NEVER game music directly.

Reads immutable v1 captured score and all six original isolated FLAC stems,
verifies all source fingerprints, recomputes ONLY accompaniment, bass repeated
attacks and drum-family hits, then creates a *different*, immutable score with
experimental-candidate-unreviewed status. Melody and source hashes preserved.

The shipping JS pack validator intentionally refuses candidate quality; no
public music manifest is changed. Run on CT211 from private scratch tree.
"""
import argparse
import hashlib
import json
from pathlib import Path

from detector_candidate_v2 import accompaniment,bass_replucks,drum_simultaneous
from performance_v1 import (
	ROLES,STEMS,DETECTORS,from_legacy,read,to_legacy,verify_origin,
	sha256_file,write_new
)
from render_full_dynamic_orchestra_v1 import sample_mono

NEW_DETECTORS=dict(DETECTORS,**{
	'guitar':'experimental-v2-RMS-waveform-onsets-harmonic-pitch',
	'piano':'experimental-v2-RMS-waveform-onsets-harmonic-pitch',
	'other':'experimental-v2-RMS-waveform-onsets-harmonic-pitch',
	'bass':'experimental-v2-legacy-YIN-plus-regular-source-reattacks',
	'drums':'experimental-v2-independent-drum-families-echo-hypotheses',
})

def capture(song,master,packs,old_root,new_root,code_hash):
	id=song['id']
	manifest=json.loads((packs/song['manifest']).read_text())
	if manifest['id']!=id:raise ValueError('song manifest mismatch')
	roster=json.loads((master/'game-stems-manifest.json').read_text())
	source=next(t for t in roster['tracks'] if t['id']==id)
	stems=source['stem_files'] if source['slot']!=33 else source['grouped_6s']['stemFiles']
	source_paths={role:master/stems[role] for role in STEMS}
	old=read(old_root/Path(song['manifest']).parent/'performance.json')
	if old['quality']!='provisional-unreviewed':
		raise ValueError('parent is not immutable release score')
	verify_origin(old,id,manifest['frameCount'],old['featuredStem'],
		source_paths)
	result={role:to_legacy(old,role) for role in ROLES}
	diag={}
	for role in ('guitar','piano','other'):
		y=sample_mono(source_paths[role])
		if len(y)<20000:raise ValueError('source too short')
		result[role],diag[role]=accompaniment(y)
		del y
	for role,fn in (('bass',bass_replucks),('drums',drum_simultaneous)):
		y=sample_mono(source_paths[role])
		result[role],diag[role]=fn(y)
		del y
	if result['melody']!=to_legacy(old,'melody'):
		raise ValueError('candidate unexpectedly changed vocal/biome melody')
	for role in ROLES:
		if not result[role]:
			raise ValueError('empty candidate role: '+role)
		if role=='drums':
			position=[r['t'] for r in result[role]]
		else:
			position=[r['start'] for r in result[role]]
		if position!=sorted(position):
			raise ValueError('unordered candidate role: '+role)
	evidence=dict(old['provenance'].get('evidence',{}))
	evidence.update({
		'parentScoreHash':old['scoreHash'],
		'candidateDetectorSha256':code_hash,
		'candidateApproval':'NO — synthetic probes only, no verified real gold',
		'candidateMethod':'separate-bucket-analysis-v2-experiment',
		'goldAnnotations':'none',
	})
	score=from_legacy(id,old['frameCount'],old['featuredStem'],result,
		old['provenance']['sourceStemSha256'],extra_provenance=evidence,
		quality='experimental-candidate-unreviewed',
		detectors=NEW_DETECTORS)
	original_counts={role:len(old['events'][role]) for role in ROLES}
	new_counts={role:len(score['events'][role]) for role in ROLES}
	assert original_counts['melody']==new_counts['melody']
	# The file is explicitly NOT copied to public/music or a game pack.
	dest=new_root/Path(song['manifest']).parent/'performance-candidate-v2.json'
	write_new(dest,score)
	print('IMMUTABLE_CANDIDATE_EXPERIMENT',id,'hash',score['scoreHash'],
		'prior',original_counts,'candidate',new_counts,flush=True)
	return {'songId':id,'parentScoreHash':old['scoreHash'],
		'candidateScoreHash':score['scoreHash'],'candidateQuality':score['quality'],
		'previousCounts':original_counts,'newCounts':new_counts,
		'methodDiagnostics':diag}

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--master',type=Path,required=True)
	p.add_argument('--packs',type=Path,required=True)
	p.add_argument('--parent',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--song-id',action='append')
	a=p.parse_args()
	if a.out.exists():raise FileExistsError('Candidate output must be new')
	a.out.mkdir(parents=True)
	catalog=json.loads((a.packs/'catalog.json').read_text())
	code_hash=sha256_file(Path(__file__).with_name('detector_candidate_v2.py'))
	results=[]
	for song in catalog['tracks']:
		if a.song_id and song['id'] not in a.song_id:continue
		results.append(capture(song,a.master,a.packs,a.parent,a.out,code_hash))
	expected=len(a.song_id) if a.song_id else 4
	if len(results)!=expected:
		raise ValueError('wrong song count')
	index={'format':'bitstream-unapproved-candidate-index-v2',
		'quality':'experimental-candidate-unreviewed',
		'candidateDetectorSha256':code_hash,
		'artifactScope':'CT211 PRIVATE; not part of game; no audio rendered',
		'songResults':results}
	(a.out/'candidate-index.json').write_text(json.dumps(index,indent=2)+'\n')
	print('RESEARCH_CANDIDATES_ONLY_NOT_SHIPPED',len(results),flush=True)

if __name__=='__main__':
	main()
