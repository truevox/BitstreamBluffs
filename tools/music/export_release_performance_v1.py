#!/usr/bin/env python3
"""Freeze the exact CURRENT full-song release detector events in performance-v1.

This is a source score capture, not a better transcription or gold truth.
Reads six original stems and the original release vocal audit, runs the same
shipped release-v1 detectors, and stores content-addressed, private-path-free
immutable note/hit timelines. No re-rendering or original audio modification.
"""
import argparse
import inspect
import json
from pathlib import Path

from performance_v1 import ROLES,STEMS,from_legacy,write_new,sha256_file,verify_melody_audit
from render_full_dynamic_orchestra_v1 import (
	sample_mono,choose_feature_events,choose_bass_events,choose_drum_events
)
from render_additional_instruments_v1 import FEATURED

def build_song(song,roster,master,source_packs,melody_source,out,legacy_audit=None,
		extra_audit=None):
	id= song['id']
	relative=Path(song['manifest']).parent
	manifest=json.loads((source_packs/song['manifest']).read_text())
	if manifest['id']!=id or id not in FEATURED:
		raise ValueError('song/manifest identifier mismatch')
	original=next(row for row in roster['tracks'] if row['id']==id)
	stems=original['grouped_6s']['stemFiles'] if original['slot']==33 else original['stem_files']
	source_paths={role:master/stems[role] for role in STEMS}
	for role,path in source_paths.items():
		if not path.is_file():raise FileNotFoundError(f'{id} missing {role}')
	hashes={role:sha256_file(source_paths[role]) for role in STEMS}
	scores={}
	for role in ('guitar','piano','other'):
		score,stats=choose_feature_events(sample_mono(source_paths[role]))
		scores[role]=score
		print('EXTRACTED_RELEASE_NOTES',id,role,len(score),stats['sourceOnsets'],flush=True)
	scores['bass'],bs=choose_bass_events(sample_mono(source_paths['bass']))
	print('EXTRACTED_RELEASE_NOTES',id,'bass',len(scores['bass']),flush=True)
	scores['drums'],ds=choose_drum_events(sample_mono(source_paths['drums']))
	print('EXTRACTED_RELEASE_HITS',id,'drums',len(scores['drums']),flush=True)
	voice=melody_source/relative/'melody-audit-private.json'
	audit=json.loads(voice.read_text())
	if audit['song']!=id:
		raise ValueError('provisional melody score wrong song')
	scores['melody']=audit['notes']
	featured=FEATURED[id]
	if legacy_audit:
		legacy=legacy_audit['songs'][id]
		expected=legacy['noteCounts']
		for role,k in [('melody','melody'),('bass','bass'),
			('drums','drums'),(featured,'featured')]:
			if len(scores[role])!=expected[k]:
				raise ValueError(f'SHIPPED_RELEASE_EVENT_COUNT_MISMATCH {id} {role}: '
					f'{len(scores[role])} vs {expected[k]}')
	if extra_audit:
		legacy=extra_audit['songs'][id]
		for role,info in legacy['additionalParts'].items():
			if len(scores[role])!=info['notes']:
				raise ValueError(f'SHIPPED_EXTRA_EVENT_COUNT_MISMATCH {id} {role}')
	# Code provenance belongs to this release capture. Source stems,
	# model checkpoint and pre-existing vocal/YIN note audit must all be
	# accounted for, even though no later guessing changes these events.
	analyzer_file=Path(inspect.getsourcefile(choose_feature_events))
	result=from_legacy(id,manifest['frameCount'],featured,scores,hashes,{
		'melodyAuditSha256':sha256_file(voice),
		'releaseExtractorSha256':sha256_file(analyzer_file),
		'extractorSpec':'FFT1024@16kHz, 160-hop, YIN on bass/vocals; uncalibrated',
		'checkpoint':'no-neural-model-release-heuristics',
	})
	verify_melody_audit(result,voice)
	file=out/relative/'performance.json'
	write_new(file,result)
	print('PERFORMANCE_V1_CREATED',id,'sha256',result['scoreHash'],
		'counts',json.dumps({role:len(v) for role,v in result['events'].items()},
		sort_keys=True),'file',file,flush=True)
	return result

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--master',type=Path,required=True)
	p.add_argument('--source-packs',type=Path,required=True)
	p.add_argument('--melody-source',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--legacy-audit',type=Path)
	p.add_argument('--extra-audit',type=Path)
	p.add_argument('--song-id',action='append',help='optional repeatable song ID')
	a=p.parse_args()
	if a.out.exists():raise FileExistsError('Do not overwrite prior score capture')
	a.out.mkdir(parents=True)
	catalog=json.loads((a.source_packs/'catalog.json').read_text())
	roster=json.loads((a.master/'game-stems-manifest.json').read_text())
	legacy=json.loads(a.legacy_audit.read_text()) if a.legacy_audit else None
	extra=json.loads(a.extra_audit.read_text()) if a.extra_audit else None
	selected=[song for song in catalog['tracks']
		if not a.song_id or song['id'] in a.song_id]
	if not selected or (a.song_id and len(selected)!=len(set(a.song_id))):
		raise ValueError('unknown or repeated song ID')
	for song in selected:
		build_song(song,roster,a.master,a.source_packs,a.melody_source,
			a.out,legacy,extra)
	(a.out/'capture-manifest.json').write_text(json.dumps({
		'format':'bitstream-performance-capture-index-v1',
		'songIds':[song['id'] for song in selected],
		'algorithm':'exact original release v1 provisional MIDI extraction',
		'productionAudio':'unchanged',
		'manualGoldSet':'not yet annotated'
	},indent=2)+'\n')
	print('PERFORMANCE_V1_CAPTURE_PASS',len(selected),'songs',flush=True)

if __name__=='__main__':
	main()
