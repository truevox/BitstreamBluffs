#!/usr/bin/env python3
"""Build PRIVATE, all-songs (or explicitly partial) game music index.

Uses the already-protected four authentic voice packs and newer model-free
melody packs. ONLY creates symlinks and manifests in a destination game site's
music/ directory; leaves originals and derived masters completely untouched.
NEVER run this on a public GitHub/Netlify deploy.
"""
import argparse
import json
from pathlib import Path
import shutil

CORE={'vocals','drums','bass','guitar','piano','other'}
VOICES={
	'voice:bitstream-bluffs','voice:debutmont','voice:garbage-dump-glacier',
	'voice:pyramid-peak','voice:underwater-mountain','voice:crystal-cavern',
	'voice:space-mountain','voice:candy-cane-canyon',
	'voice:sky-jellyfish-mountain','voice:steampunk-slopes',
	'voice:micro-mountain','voice:vertigo-vents',
}
OLD_IDS={'FEsxYVStla4','WRBGQUqD54U','FYImnz5-hXs','local-one-more-run-bitstream-bluffs'}

def safe_string(v):
	return isinstance(v,str) and v and all(c.isalnum() or c in '_-' for c in v)

def install(a):
	roster=json.loads(a.roster.read_text())['tracks']
	assert len(roster)==33 and len({t['id'] for t in roster})==33
	default_ids=['FEsxYVStla4','local-one-more-run-bitstream-bluffs','WRBGQUqD54U','FYImnz5-hXs']
	order=[next(t for t in roster if t['id']==id) for id in default_ids]
	order +=[t for t in sorted(roster,key=lambda t:int(t['slot'])) if t['id'] not in OLD_IDS]
	out=a.out.resolve()
	if out.exists():raise FileExistsError('Refusing to overwrite an existing private game music tree '+str(out))
	for source in (a.existing_four,a.new_songs):
		source=source.resolve()
		if out==source or source in out.parents or out in source.parents:
			raise ValueError('Cannot mutate or nest inside source media directory')
	stage=out.with_name('.'+out.name+'.staging')
	if stage.exists():raise FileExistsError('Stale staging media directory: '+str(stage))
	(stage/'packs').mkdir(parents=True)
	catalog={'format':'bitstream-music-catalog-v1','tracks':[]}
	checked=[];missing=[]
	for song in order:
		slot=int(song['slot']);id=song['id'];name=f'{slot:02d}_{id}'
		assert safe_string(id),id
		source=a.existing_four/name if id in OLD_IDS else a.new_songs/name
		if not source.is_dir():
			missing.append(name)
			continue
		root=source.resolve()
		manifest=root/'pack.json'
		doc=json.loads(manifest.read_text())
		assert doc['id']==id and doc['sampleRate']==48000
		assert doc['format']=='bitstream-music-pack-v1'
		assert sum(s['frames'] for s in doc['segments'])==doc['frameCount']
		assert len(doc['segments'])>=10
		expected=CORE|VOICES
		cursor=0
		for idx,seg in enumerate(doc['segments']):
			assert seg['startFrame']==cursor and seg['frames']>0
			cursor+=seg['frames']
			keys={k.replace('voice:debumont','voice:debutmont') for k in seg['sources']}
			assert keys==expected,(name,idx,expected-keys,keys-expected)
			for role,raw in seg['sources'].items():
				p=(root/raw).resolve()
				assert root in p.parents and p.is_file() and p.stat().st_size>90,(name,idx,role,raw)
		if id not in OLD_IDS:
			assert doc.get('melodyOnlyVersion')=='model-free-v1 source-bound provisional'
		(stage/'packs'/name).symlink_to(root,target_is_directory=True)
		catalog['tracks'].append({'id':id,'title':song['title'],
			'manifest':'packs/'+name+'/pack.json',
			**({'youtubeId':id} if len(id)==11 else {})})
		checked.append({'slot':slot,'id':id,'source':str(root),'segmentCount':len(doc['segments']),
			'sourceCountPerSegment':len(doc['segments'][0]['sources'])})
	if missing and not a.partial:
		shutil.rmtree(stage)
		raise ValueError('Full 33-song game library is incomplete: '+', '.join(missing))
	if not a.partial and len(catalog['tracks'])!=33:
		shutil.rmtree(stage)
		raise ValueError('Expected 33 complete song packs')
	if a.partial and len(catalog['tracks'])<5:
		shutil.rmtree(stage)
		raise ValueError('Partial preview must contain the four old songs and one new song')
	(stage/'catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
	(stage/'PRIVATE-README.txt').write_text(
		'PRIVATE TAILSCALE ONLY. Original six stems + source-vocal-derived experimental melody for 33 tracks.\n'
		'NO source FLAC/WAV, media clips or pre-release game packs in Git.\n'
		'All automatic note and beat candidates unverified. Source archive preserved.\n')
	(stage/'private-build-audit.json').write_text(json.dumps({'format':'bitstream-private-33-song-game-qa-v1',
		'status':'PARTIAL_INTERNAL_QA' if missing else '33_PRIVATE_SOURCE_PACKS_READY',
		'installed':checked,'missing':missing},indent=2)+'\n')
	stage.rename(out)
	print('PRIVATE_SONG_PACK_CATALOG_READY',len(checked),'songs',len(missing),'missing',
		sum(v['segmentCount']*v['sourceCountPerSegment'] for v in checked),'source chunks',out,flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--existing-four',type=Path,required=True)
	p.add_argument('--new-songs',type=Path,required=True)
	p.add_argument('--roster',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--partial',action='store_true')
	install(p.parse_args())
