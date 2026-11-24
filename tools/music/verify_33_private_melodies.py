#!/usr/bin/env python3
"""Independent post-render QA on immutable 29 new-song private melody packs.

Verify all source+voice file references and identity/clock boundaries; hash
all original six FLACs, verify vocal score ancestry and spot-decode exact
Opus PCM for first and last source chunks. No media is written to Git.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess

SIX=('vocals','drums','bass','guitar','piano','other')
BIOMES=(
	'bitstream-bluffs','debutmont','garbage-dump-glacier','pyramid-peak',
	'underwater-mountain','crystal-cavern','space-mountain','candy-cane-canyon',
	'sky-jellyfish-mountain','steampunk-slopes','micro-mountain','vertigo-vents')
PRESERVE={1,3,31,33}
RATE=48000

def sha(path):
	h=hashlib.sha256()
	with path.open('rb') as stream:
		for part in iter(lambda:stream.read(4<<20),b''):
			h.update(part)
	return h.hexdigest()

def decoded_frames(file):
	p=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-i',str(file),
		'-ac','2','-ar',str(RATE),'-f','s16le','pipe:1'],capture_output=True,timeout=90,check=True)
	assert len(p.stdout)%4==0,file
	return len(p.stdout)//4

def verify_one(track,master,root,status):
	slot=int(track['slot']);id=track['id'];name=f'{slot:02d}_{id}'
	path=root/'packs'/name
	if not path.is_dir():return None
	doc=json.loads((path/'pack.json').read_text())
	report=json.loads((root/'private-melody-audits'/(name+'.json')).read_text())
	assert doc['id']==report['songId']==id and doc['format']=='bitstream-music-pack-v1'
	assert doc.get('melodyOnlyVersion')=='model-free-v1 source-bound provisional'
	assert 'provisional' in report['status'] and 'unreviewed' in report['status']
	assert doc['sampleRate']==RATE
	assert report['frameCount']==doc['frameCount']
	assert doc['frameCount']==round(status['stems']['vocals']['frames']*RATE/44100)
	assert len(doc['segments'])>8 and doc['segments'][-1]['frames']>0
	sourcehash={}
	for role in SIX:
		original=master/track['stem_files'][role]
		assert original.is_file()
		assert original.stat().st_size==status['stems'][role]['bytes'],(name,role,'bytes')
		sourcehash[role]=sha(original)
	assert report['sourceStemSha256']==sourcehash['vocals'],name
	notes=report['notes']
	assert len(notes)>=25
	assert report['statistics']['mergedNotes']==len(notes)
	assert hashlib.sha256(json.dumps(notes,sort_keys=True).encode()).hexdigest()==report['noteEventSha256']
	assert all(0<=n['start']<n['end']<=doc['frameCount']/RATE+.5 and 40<=n['midi']<=94 for n in notes)
	roots=set(SIX)|{'voice:'+name for name in BIOMES}
	cursor=0;total=0
	for i,seg in enumerate(doc['segments']):
		assert seg['startFrame']==cursor and seg['frames']>0
		cursor+=seg['frames'];assert set(seg['sources'])==roots
		for role,rel in seg['sources'].items():
			file=(path/rel).resolve()
			assert path.resolve() in file.parents and file.is_file() and file.stat().st_size>90
			total+=1
	assert cursor==doc['frameCount']
	for v in ('bitstream-bluffs','debutmont','pyramid-peak','crystal-cavern','garbage-dump-glacier'):
		for index in (0,len(doc['segments'])-1):
			seg=doc['segments'][index]
			file=path/seg['sources']['voice:'+v]
			assert decoded_frames(file)==seg['frames'],(name,v,index,'decoded frames')
	minimum=min(x['rmsBeforeTrim'] for x in report['render']['biomeQuality'].values())
	assert minimum>.0005,(name,'silent melody',minimum)
	assert all(0<x['safetyGain']<=1 for x in report['render']['biomeQuality'].values())
	return {'slot':slot,'id':id,'notes':len(notes),'sourceFrames':doc['frameCount'],
		'segments':len(doc['segments']),'originalStems':len(SIX),
		'melodyVariants':len(BIOMES),'melodyOpusChunks':len(doc['segments'])*len(BIOMES),
		'allSourceFileReferences':total,'sourceFlacSha256':sourcehash,
		'vocalNoteAuditSha256':sha(root/'private-melody-audits'/(name+'.json')),
		'lowestMelodyRms':round(minimum,6)}

if __name__=='__main__':
	p=argparse.ArgumentParser()
	p.add_argument('--master',type=Path,default=Path('/root/bitstream-maxi/launch33'))
	p.add_argument('--song-root',type=Path,required=True)
	p.add_argument('--summary',type=Path,required=True)
	p.add_argument('--partial',action='store_true')
	a=p.parse_args()
	if a.summary.exists():raise FileExistsError('Refusing overwrite '+str(a.summary))
	root=a.song_root.resolve();master=a.master.resolve()
	assert not root.is_relative_to(master) and not master.is_relative_to(root)
	roster=json.loads((master/'game-stems-manifest.json').read_text())['tracks']
	source_status=json.loads((master/'stem_status.json').read_text())['tracks']
	passed=[];missing=[]
	for track in roster:
		if int(track['slot']) in PRESERVE:continue
		candidate=verify_one(track,master,root,source_status[track['id']])
		if candidate:passed.append(candidate);print('VERIFIED_MELODY',candidate['slot'],candidate['id'],candidate['melodyOpusChunks'],flush=True)
		else:missing.append(int(track['slot']))
	if missing and not a.partial:raise ValueError('29 private melody packs not all ready: '+str(missing))
	if not missing and len(passed)!=29:raise ValueError('Incorrect full source count')
	result={'format':'bitstream-private-source-melody-29-verified-v1',
		'status':'PRIVATE_PARTIAL_MUSIC_QA' if missing else 'PRIVATE_29_MELODY_PACKS_SOURCE_VERIFIED',
		'existingFourIntentionallyPreserved':sorted(PRESERVE),
		'newSongCount':len(passed),'pendingSlots':missing,
		'notes':sum(x['notes'] for x in passed),
		'totalMelodyOpusChunks':sum(x['melodyOpusChunks'] for x in passed),
		'allSourceReferences':sum(x['allSourceFileReferences'] for x in passed),
		'sourceStemsFingerprinted':sum(len(x['sourceFlacSha256']) for x in passed),
		'spotDecodedMelodyOpusChunks':len(passed)*10,
		'sourceAlbums':passed,
		'releaseApproval':'NONE, machine source notes provisional and no owner listening'}
	a.summary.write_text(json.dumps(result,indent=2)+'\n')
	print('SOURCE_MELODY_QA_COMPLETE',len(passed),'of 29',len(missing),'not yet rendered',
		result['totalMelodyOpusChunks'],'melody chunks',flush=True)
