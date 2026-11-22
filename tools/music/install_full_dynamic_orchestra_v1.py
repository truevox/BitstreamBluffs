#!/usr/bin/env python3
"""Install verified full-length biome re-performance assets into public packs.

Original six song stem chunks never overwritten. New voice:<biome> sources
are explicit, and the adaptive manifest names five independent replacement instrument
recordings per biome (guitar, piano, other, bass, airborne drums).
Fails closed: rejects partial/missing/misaligned replacement families.
"""
import argparse
import json
import shutil
from pathlib import Path

BIOMES=(
	'debutmont','garbage-dump-glacier','pyramid-peak','underwater-mountain',
	'crystal-cavern','space-mountain','candy-cane-canyon',
	'sky-jellyfish-mountain','steampunk-slopes','micro-mountain','vertigo-vents',
)
ROLES=('featured','bass','drums','melody','guitar','piano','other')
FEATURED={
	'FEsxYVStla4':'other',
	'local-one-more-run-bitstream-bluffs':'piano',
	'WRBGQUqD54U':'guitar',
	'FYImnz5-hXs':'other',
}
def install(a):
	root=a.music_root
	catalog=json.loads((root/'catalog.json').read_text())
	assert len(catalog['tracks'])==4
	for track in catalog['tracks']:
		assert track['id'] in FEATURED,track['id']
		manifest=root/track['manifest']
		doc=json.loads(manifest.read_text())
		assert 'adaptive' not in doc, 'Do not overwrite an existing orchestra version'
		n=len(doc['segments'])
		assert n>=15
		rel=Path(track['manifest']).parent
		replacements=a.replacement_root/rel/'adaptive'
		dest=manifest.parent/'adaptive'
		assert not dest.exists(),dest
		mapping={role:{} for role in ('featured','bass','drums','guitar','piano','other')}
		melody={}
		roles=('featured','bass','drums','melody')+tuple(
			r for r in ('guitar','piano','other') if r!=FEATURED[doc['id']])
		extra=a.extra_root/rel/'adaptive'
		for biome in BIOMES:
			for role in roles:
				source_root=extra if role in ('guitar','piano','other') else replacements
				files=[source_root/biome/f'{role}-{i:04d}.ogg'
					for i in range(n)]
				if any(not file.is_file() or file.stat().st_size<=500
					for file in files):
					raise ValueError(f'Missing replacement {track["id"]} {biome} {role}')
				names=[f'adaptive/{biome}/{role}-{i:04d}.ogg'
					for i in range(n)]
				if role=='melody':
					melody[biome]=names
				else:
					mapping[role][biome]=names
		# Check all files for this pack BEFORE copying, and use a
		# temp directory so interruption doesn't publish a half-version.
		stage=manifest.parent/'adapt-staging'
		assert not stage.exists()
		shutil.copytree(replacements,stage)
		shutil.copytree(extra,stage,dirs_exist_ok=True)
		stage.rename(dest)
		for i,seg in enumerate(doc['segments']):
			for biome in BIOMES:
				seg['sources']['voice:'+biome]=melody[biome][i]
			assert len(seg['sources'])==18 # six original + home + eleven
		doc['adaptive']={'featuredStem':FEATURED[doc['id']],
			'variants':mapping}
		doc['orchestraVersion']='provisional-full-reperformance-v2'
		doc['scoreDisclaimer']='Source-derived automatic note estimates, NOT artist-verified. Original six stems retained. Dynamic Orchestra OFF plays original instrumental stems and biome melody; ON uses five genuine newly performed 11-biome instrumental recordings.'
		temp=manifest.with_suffix('.tmp')
		temp.write_text(json.dumps(doc,indent=2)+'\n')
		temp.replace(manifest)
		print('INSTALLED',doc['id'],n,'segments',len(BIOMES),
			'biomes',n*6*len(BIOMES),'replacement clips',flush=True)
	print('FOUR_FULL_DYNAMIC_ORCHESTRA_PACKS_INSTALLED',flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--music-root',required=True,type=Path)
	p.add_argument('--replacement-root',required=True,type=Path)
	p.add_argument('--extra-root',required=True,type=Path)
	install(p.parse_args())
