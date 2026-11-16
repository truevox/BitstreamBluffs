#!/usr/bin/env python3
"""Private lab asset QA: all real instruments + legacy variants stay available.

Read-only. Does not move, modify or publish privately rendered recordings.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
from pathlib import Path

BIOMES=('debumont','garbage-dump-glacier','pyramid-peak','underwater-mountain',
	'crystal-cavern','space-mountain','candy-cane-canyon',
	'sky-jellyfish-mountain','steampunk-slopes','micro-mountain','vertigo-vents')
SONGS=('pope','one-more-run','every-hacker-pt2')
ORIGINALS=('vocals','bass','drums','guitar','piano','other')

def validate(site):
	index=json.loads((site/'catalog.json').read_text())
	assert len(index['songs'])==3 and len(index['biomes'])==12
	allfiles=list(site.rglob('*.ogg'))
	assert len(allfiles)==231,('missing or extra private audio clips',len(allfiles))
	for song in index['songs']:
		name=song['id']
		assert name in SONGS
		folder=site/name
		for original in ORIGINALS:
			assert (folder/'original'/(original+'.ogg')).is_file(),(name,original)
		for biome in BIOMES:
			for base in ('bass','bass-dsp','drums','drums-sampled','featured'):
				assert (folder/base/(biome+'.ogg')).is_file(),(name,base,biome)
			if name!='every-hacker-pt2':
				assert (folder/'featured-sampled'/(biome+'.ogg')).is_file()
				assert (folder/'melody'/(biome+'.ogg')).is_file()
		if name!='every-hacker-pt2':
			assert (folder/'melody'/'bitstream-bluffs.ogg').is_file()
			assert (folder/'melody-candy-v3/candy-cane-canyon.ogg').is_file()
		else:
			assert not (folder/'melody').exists()
			assert not (folder/'featured-sampled').exists()
	for forbidden in ('safetensors','pt','pth','gguf','ckpt','model'):
		assert not list(site.rglob('*.'+forbidden)),forbidden
	def check_audio(file):
		r=subprocess.run(['ffprobe','-v','error',
			'-show_entries','format=duration',
			'-of','default=noprint_wrappers=1:nokey=1',str(file)],
			capture_output=True,text=True,check=True)
		duration=float(r.stdout.strip())
		if not 31.7<=duration<=32.5:
			raise AssertionError(('invalid duration',file,duration))
		return duration
	with ThreadPoolExecutor(max_workers=8) as pool:
		durations=list(pool.map(check_audio,allfiles))
	print('PASS_PRIVATE_AUDIO_ASSET_COVERAGE',
		'songs=3','biomes=12','ogg=231',
		'durationMin='+str(round(min(durations),3)),
		'durationMax='+str(round(max(durations),3)),
		'oldAssetsPreserved=true',
		'newDrums=33','newFeatured=22','newCandy=2',
		'weights=0')

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('private_site',type=Path)
	a=p.parse_args()
	validate(a.private_site)
