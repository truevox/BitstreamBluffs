#!/usr/bin/env python3
"""Provisional independent performances for the two *unfeatured* parts.

On 11 biome instruments across 4 full songs, analyze each original source
instrument stem on its own, then render a completely new note waveform,
aligned to the existing 12s segmentation. This adds Guitar/Piano/Other real
instrument substitutions; the featured part already exists in V1.
All original masters, approved sample labs, and staging remain unchanged.
"""
import argparse
import json
from pathlib import Path

from render_full_dynamic_orchestra_v1 import (
	BIOMES, sample_mono, choose_feature_events, render_notes, encode_segments
)
from performance_v1 import read as read_performance,verify_origin,to_legacy,STEMS

INSTRUMENTS=('guitar','piano','other')
FEATURED={
	'FEsxYVStla4':'other',
	'local-one-more-run-bitstream-bluffs':'piano',
	'WRBGQUqD54U':'guitar',
	'FYImnz5-hXs':'other',
}

def render(a):
	if a.out.exists():
		raise FileExistsError('Never overwrite an earlier independent instrument render')
	a.out.mkdir(parents=True)
	catalog=json.loads((a.source_packs/'catalog.json').read_text())
	roster=json.loads((a.master/'game-stems-manifest.json').read_text())
	assert len(catalog['tracks'])==4
	report={'schemaVersion':1,'purpose':'source-independent score reconstruction of both unfeatured parts',
		'approval':'not artist-approved; source note guesses including octave errors; will re-render later',
		'songs':{}}
	for song in catalog['tracks']:
		id=song['id']
		assert id in FEATURED
		original=next(row for row in roster['tracks'] if row['id']==id)
		stem_files=(original['grouped_6s']['stemFiles'] if original['slot']==33
			else original['stem_files'])
		base=json.loads((a.source_packs/song['manifest']).read_text())
		frames=base['frameCount']
		n=len(base['segments'])
		assert frames>48000*90 and n>=15
		dest=a.out/Path(song['manifest']).parent/'adaptive'
		performance=None
		if a.performance_root:
			performance=read_performance(a.performance_root/Path(song['manifest']).parent/
				'performance.json')
			verify_origin(performance,id,frames,FEATURED[id],{
				role:a.master/stem_files[role] for role in STEMS})
			print('LOCKED_EXTRA_SCORE',id,performance['scoreHash'],flush=True)
		elif not a.legacy_direct_extraction:
			raise ValueError('New releases require --performance-root; '
				'legacy direct extraction needs explicit --legacy-direct-extraction')
		counts={}
		for role in INSTRUMENTS:
			if role==FEATURED[id]: continue
			if performance:
				events=to_legacy(performance,role)
				details={'method':'content-addressed-performance-v1',
					'scoreHash':performance['scoreHash']}
			else:
				source=a.master/stem_files[role]
				events,details=choose_feature_events(sample_mono(source))
			if len(events)<80:
				raise ValueError('Too few note candidates for '+id+' '+role)
			counts[role]={'notes':len(events),'evidence':details}
			for biome in BIOMES:
				audio=render_notes(events,biome,frames,role)
				names=encode_segments(audio,dest/biome,role,base['segments'])
				assert len(names)==n
				print('EXTRA_REAL_INSTRUMENT',id,role,biome,len(names),
					flush=True)
		report['songs'][id]={'featured':FEATURED[id],
			'scoreHash':performance['scoreHash'] if performance else None,
			'additionalParts':counts}
	(a.out/'private-additional-audit.json').write_text(json.dumps(report,indent=2)+'\n')
	print('ALL_FOUR_SONGS_TWO_EXTRA_INSTRUMENT_PARTS_COMPLETED',flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--master',type=Path,required=True)
	p.add_argument('--source-packs',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	group=p.add_mutually_exclusive_group(required=True)
	group.add_argument('--performance-root',type=Path)
	group.add_argument('--legacy-direct-extraction',action='store_true')
	render(p.parse_args())
