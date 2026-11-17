#!/usr/bin/env python3
"""Source-preserving four-song real orchestra release gate.

Checks full-song frame-accurate pack segments, all 12 distinct voice sources,
11 mountain variant triplets and known-safe paths. Verifies original six
Opus chunks against the private baseline hash, and decodes selected first,
middle and final chunks to ensure that adaptive swaps won't underrun.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from install_full_dynamic_orchestra_v1 import BIOMES,FEATURED

ROLES=('featured','bass','drums','melody','guitar','piano','other')
STEMS=('vocals','drums','bass','guitar','piano','other')
def filehash(path):
	h=hashlib.sha256()
	with path.open('rb') as f:
		for block in iter(lambda:f.read(1<<20),b''):
			h.update(block)
	return h.digest()

def probe(file):
	p=subprocess.run(['ffprobe','-v','error','-show_entries',
		'stream=codec_name,sample_rate,channels:format=duration',
		'-of','json',str(file)],capture_output=True,text=True,check=True,timeout=20)
	data=json.loads(p.stdout)
	stream=data['streams'][0]
	assert stream['codec_name']=='opus' and int(stream['sample_rate'])==48000
	assert stream['channels']==2
	return float(data['format']['duration'])

def validate(music,baseline):
	catalog=json.loads((music/'catalog.json').read_text())
	assert catalog['format']=='bitstream-music-catalog-v1'
	assert len(catalog['tracks'])==4
	assert {t['id'] for t in catalog['tracks']}==set(FEATURED)
	report={'songs':[],'originalsIdentical':True,'roles':list(ROLES)}
	total_source=0
	total_replacements=0
	for track in catalog['tracks']:
		pack_path=music/track['manifest']
		old_path=baseline/track['manifest']
		pack=json.loads(pack_path.read_text())
		old=json.loads(old_path.read_text())
		assert pack['id']==track['id'] and pack['sampleRate']==48000
		assert pack['frameCount']==old['frameCount']
		assert pack['orchestraVersion']=='provisional-full-reperformance-v2'
		assert pack['adaptive']['featuredStem']==FEATURED[track['id']]
		assert set(pack['adaptive']['variants'])=={'featured','bass','drums','guitar','piano','other'}
		assert len(pack['segments'])==len(old['segments'])>=15
		n=len(pack['segments'])
		for role in ('featured','bass','drums','guitar','piano','other'):
			expected=set() if role==FEATURED[track['id']] else set(BIOMES)
			assert set(pack['adaptive']['variants'][role])==expected
		for i,seg in enumerate(pack['segments']):
			old_seg=old['segments'][i]
			assert seg['startFrame']==old_seg['startFrame']
			assert seg['frames']==old_seg['frames']
			assert set(seg['sources'])==set(STEMS)|{
				'voice:bitstream-bluffs'}|{'voice:'+b for b in BIOMES}
			for stem in STEMS:
				original=music/Path(track['manifest']).parent/seg['sources'][stem]
				prior=baseline/Path(track['manifest']).parent/old_seg['sources'][stem]
				assert original.is_file() and prior.is_file()
				assert filehash(original)==filehash(prior),original
				total_source+=1
			for name in ('voice:bitstream-bluffs',):
				assert (music/Path(track['manifest']).parent/seg['sources'][name]).is_file()
				total_source+=1
			for biome in BIOMES:
				voice=music/Path(track['manifest']).parent/seg['sources']['voice:'+biome]
				assert voice.is_file() and voice.stat().st_size>500
				total_replacements+=1
				for role in ('featured','bass','drums','guitar','piano','other'):
					if role==FEATURED[track['id']]: continue
					path=pack['adaptive']['variants'][role][biome][i]
					assert '..' not in path and not path.startswith('/')
					full=music/Path(track['manifest']).parent/path
					assert full.is_file() and full.stat().st_size>500
					total_replacements+=1
		# Decode the beginning, middle and tail of every selected role.
		# FFmpeg's 20ms Opus packetization permits up to ~20ms pad,
		# but never early truncation >40ms.
		for idx in sorted({0,n//2,n-1}):
			seg=pack['segments'][idx]
			required=seg['frames']/48000
			for biome in ('debumont','crystal-cavern','vertigo-vents'):
				for role in ('melody','featured','bass','drums')+tuple(r for r in ('guitar','piano','other') if r!=FEATURED[track['id']]):
					name=(seg['sources']['voice:'+biome] if role=='melody' else
						pack['adaptive']['variants'][role][biome][idx])
					full=music/Path(track['manifest']).parent/name
					duration=probe(full)
					assert required-.04<=duration<=required+.06,(full,required,duration)
		report['songs'].append({'id':track['id'],'duration':pack['frameCount']/48000,
			'segments':n,'originalStems':len(STEMS),
			'biomes':len(BIOMES),'reperformedRoles':list(ROLES)})
	all_files=list(music.rglob('*.ogg'))
	assert len(all_files)==total_source+total_replacements
	assert total_source==455 and total_replacements==4290,(total_source,total_replacements)
	report.update({'passed':True,'sourceOggsPreserved':total_source,
		'brandNewBiomeOggs':total_replacements,'totalOggs':len(all_files),
		'bytes':sum(f.stat().st_size for f in all_files),
		'licenseScope':'User requested publishing four personal tracks to main',
		'limitations':'Pitch/onset resynthesis provisional; human approval pending; not proof of note-perfect transcription'})
	return report

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--music-root',type=Path,required=True)
	p.add_argument('--baseline',type=Path,required=True)
	p.add_argument('--report',type=Path,required=True)
	a=p.parse_args()
	assert not a.report.exists()
	result=validate(a.music_root,a.baseline)
	a.report.write_text(json.dumps(result,indent=2)+'\n')
	print('FULL_DYNAMIC_ORCHESTRA_QA_PASS',result['sourceOggsPreserved'],
		'unchanged source',result['brandNewBiomeOggs'],
		'new parts',result['totalOggs'],'total',flush=True)
