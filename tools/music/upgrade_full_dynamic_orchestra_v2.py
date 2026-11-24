#!/usr/bin/env python3
"""Finish an already installed V1 3-part orchestra with 2 more real parts.

Source pack has original six unchanged, 11 biome voice stems, 3 V1
instrument role recordings. After new Guitar/Piano/Other files have been
staged alongside them, this script verifies ALL new clips and changes only
pack.json metadata to route all five instrumental roles in V2.
Never silently change an existing approved orchestra; V1->V2 only.
"""
import argparse
import json
from pathlib import Path

BIOMES=(
	'debutmont','garbage-dump-glacier','pyramid-peak','underwater-mountain',
	'crystal-cavern','space-mountain','candy-cane-canyon',
	'sky-jellyfish-mountain','steampunk-slopes','micro-mountain','vertigo-vents',
)
STEMS=('guitar','piano','other')
FEATURED={
	'FEsxYVStla4':'other',
	'local-one-more-run-bitstream-bluffs':'piano',
	'WRBGQUqD54U':'guitar',
	'FYImnz5-hXs':'other',
}

def patch(root):
	catalog=json.loads((root/'catalog.json').read_text())
	if {track['id'] for track in catalog['tracks']}!=set(FEATURED):
		raise ValueError('The source music catalog does not contain exactly the four owner songs')
	modified=[]
	for track in catalog['tracks']:
		f=root/track['manifest']
		doc=json.loads(f.read_text())
		id=track['id']
		assert doc['orchestraVersion']=='provisional-full-reperformance-v1',id
		assert doc['adaptive']['featuredStem']==FEATURED[id],id
		assert set(doc['adaptive']['variants'])=={'featured','bass','drums'},id
		n=len(doc['segments'])
		roles=[stem for stem in STEMS if stem!=FEATURED[id]]
		assert len(roles)==2 and n>=15
		paths={}
		for role in roles:
			paths[role]={}
			for biome in BIOMES:
				files=[f'adaptive/{biome}/{role}-{i:04d}.ogg' for i in range(n)]
				for rel in files:
					child=f.parent/rel
					if not child.is_file() or child.stat().st_size<=500:
						raise FileNotFoundError('Incomplete extra instrument recording: '+str(child))
				paths[role][biome]=files
		modified.append((f,doc,paths))
	# Only mutate manifests after verifying *all four complete*.
	for f,doc,paths in modified:
		doc['adaptive']['variants'].update(paths)
		# The featured role is already a replacement of its original
		# source stem. A named duplicate role is intentionally absent.
		doc['adaptive']['variants'][FEATURED[doc['id']]]={}
		doc['orchestraVersion']='provisional-full-reperformance-v2'
		doc['scoreDisclaimer']=(
			'PRE-ALPHA: independently regenerated full-length melody, guitar, '
			'piano, other, bass, and airborne percussion. Onset/pitch detection '
			'is provisional and will be rerendered. Dynamic Orchestra defaults '
			'OFF: original six source stems (other than synthesized biome lead) '
			'stay intact; airborne drums and bass speed fades still operate.'
		)
		tmp=f.with_suffix('.v2-tmp')
		assert not tmp.exists()
		tmp.write_text(json.dumps(doc,indent=2)+'\n')
		tmp.replace(f)
		print('UPGRADED_FULL_FIVE_INSTRUMENTS',doc['id'],len(doc['segments']),flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--music-root',type=Path,required=True)
	a=p.parse_args()
	patch(a.music_root)
