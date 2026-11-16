#!/usr/bin/env python3
"""Assemble a PRIVATE two-song, twelve-mountain Bitstream Bluffs game pack.

Run on CT211, with source masters read-only; package derivative Ogg chunks
into a NEW independent directory. Exact source sample clocks, 10-second
segment grid and engine-compatible manifest. No SheetSage checkpoints or
trained model weights ever enter the web/game pack.

This script is the offline *demo* builder, not a production release tool.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import shutil
import subprocess
import sys
from pathlib import Path

RATE=48000
CHANNELS=2
BYTES_PER_FRAME=4
CHUNK_FRAMES=RATE*10
CORE=('vocals','drums','bass','guitar','piano','other')
MOUNTAINS=(
	'bitstream-bluffs','debumont','garbage-dump-glacier','pyramid-peak',
	'underwater-mountain','crystal-cavern','space-mountain',
	'candy-cane-canyon','sky-jellyfish-mountain','steampunk-slopes',
	'micro-mountain','vertigo-vents',
)
BASE=Path('/root/bitstream-maxi')
POPE_BASE=BASE/'music-pack-pope-full/packs/01_FEsxYVStla4'
POPE_PALETTE=BASE/'transcription-lab-20261115/full-song-pope/full-palette'
RUN_CORE=BASE/'launch33/stems/grouped_6s/33_one_more_run'
RUN_PALETTE=BASE/'transcription-lab-20261115/full-song-one-more-run/full-palette'
SONGS={
	'pope':{
		'id':'FEsxYVStla4','title':'Pope Leo Wants the AI Root Password',
		'name':'01_FEsxYVStla4','frames':10318847,'palette':POPE_PALETTE,
	},
	'one-more-run':{
		'id':'one-more-run-bitstream-bluffs',
		'title':'One More Run (The Ballad of Bitstream Bluffs)',
		'name':'33_one_more_run','frames':8380800,'palette':RUN_PALETTE,
	},
}

def require(condition,msg):
	if not condition:raise RuntimeError(msg)

def run(args,**kw):
	p=subprocess.run(args,capture_output=True,**kw)
	if p.returncode:
		raise RuntimeError(' '.join(map(str,args[:8]))+' failed: '+p.stderr.decode(errors='replace')[-1300:])
	return p

def encode_segment(pcm,dest):
	result=subprocess.run([
		'ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','2','-y',
		'-f','s16le','-ar',str(RATE),'-ac',str(CHANNELS),'-i','pipe:0',
		'-c:a','libopus','-application','audio','-b:a','80k','-vbr','on',
		'-f','ogg',str(dest),
	],input=pcm,capture_output=True)
	if result.returncode:
		raise RuntimeError(f'Opus encode failed: {dest} '+result.stderr.decode(errors='replace')[-800:])

def read_exact(pipe,num):
	blocks=[];remaining=num
	while remaining:
		part=pipe.read(remaining)
		if not part:break
		blocks.append(part);remaining-=len(part)
	return b''.join(blocks)

def transcode_chunks(src,dst,name,segments):
	require(src.is_file() and src.stat().st_size>150000,'Source missing: '+str(src))
	proc=subprocess.Popen([
		'ffmpeg','-hide_banner','-loglevel','error','-nostdin',
		'-i',str(src),'-vn','-ac',str(CHANNELS),'-ar',str(RATE),
		'-f','s16le','pipe:1',
	],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
	try:
		total=0
		for i,seg in enumerate(segments):
			num=seg['frames']*BYTES_PER_FRAME
			pcm=read_exact(proc.stdout,num)
			require(len(pcm)==num,f'{name}: unexpected PCM EOF at segment {i}: {len(pcm)}/{num}')
			outname=f'{i:04d}-{name.replace(":","-")}.ogg'
			encode_segment(pcm,dst/outname)
			seg['sources'][name]=outname
			total+=seg['frames']
		require(total>0,'Empty audio source')
	finally:
		proc.stdout.close()
		if proc.poll() is None:proc.terminate()
		proc.wait(timeout=10)
		if proc.stderr:proc.stderr.close()
	return name

def segments_for(frames):
	return [
		{'startFrame':start,'frames':min(CHUNK_FRAMES,frames-start),'sources':{}}
		for start in range(0,frames,CHUNK_FRAMES)
	]

def base_pope_pack(dst,config):
	data=json.loads((POPE_BASE/'pack.json').read_text())
	require(data['frameCount']==config['frames'] and data['id']==config['id'],'Pope base pack mismatch')
	require(len(data['segments'])==22,'Pope base pack segments mismatch')
	data['segments']=[{'startFrame':s['startFrame'],'frames':s['frames'],
		'sources':{n:s['sources'][n] for n in CORE}} for s in data['segments']]
	require(sum(x['frames'] for x in data['segments'])==config['frames'],'Pope base frame mismatch')
	for seg in data['segments']:
		for stem,path in seg['sources'].items():
			shutil.copyfile(POPE_BASE/path,dst/path)
	return data

def create_pack(which,packs):
	config=SONGS[which]
	target=packs/config['name']
	require(not target.exists(),'Pack exists: '+str(target))
	target.mkdir()
	palette=config['palette']
	meta=json.loads((palette/'palette.json').read_text())
	require(set(meta['voices'])==set(MOUNTAINS),'Missing mountain voice')
	require(abs(meta['seconds']-config['frames']/RATE)<.01,'Palette duration mismatch')
	if which=='pope':
		pack=base_pope_pack(target,config)
	else:
		segments=segments_for(config['frames'])
		pack={'format':'bitstream-music-pack-v1','id':config['id'],
			'title':config['title'],'source':'Suno original 11 -> optional grouped six; private research proof',
			'sampleRate':RATE,'frameCount':config['frames'],'preview':True,
			'segments':segments}
		for stem in CORE:
			path=RUN_CORE/(stem+'.flac')
			print('ENCODE_CORE',which,stem,flush=True)
			transcode_chunks(path,target,stem,segments)
	# Stable per-frame grids let the mixer switch between twelve voices
	# while sharing the same song clock with the six standard stems.
	segments=pack['segments']
	with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
		futures={pool.submit(transcode_chunks,palette/(name+'-full.ogg'),target,'voice:'+name,segments):name
			for name in MOUNTAINS}
		for f in concurrent.futures.as_completed(futures):
			print('ENCODED_VOICE',which,f.result(),flush=True)

	required=set(CORE)|{'voice:'+n for n in MOUNTAINS}
	require(len(segments)>=17 and sum(x['frames'] for x in segments)==config['frames'],'segment coverage')
	for seg in segments:
		require(set(seg['sources'])==required,'Incomplete voice/core segment source')
		require(seg['frames']>0,'Empty segment')
		for name,path in seg['sources'].items():
			item=target/path
			require(item.is_file() and item.stat().st_size>90,'Empty encoded audio '+str(item))
	pack['source']='PRIVATE proof: original six-stem source + 12 full SheetSage-informed Gentle-synthesis mountain timbres'
	pack['preview']=True
	pack['effects']={}
	(target/'pack.json').write_text(json.dumps(pack,indent=2)+'\n')
	print('COMPLETED',which,len(segments),'segments',len(required),'sources-per-segment',
		'files',len(list(target.glob('*.ogg'))),flush=True)
	return {'id':config['id'],'title':config['title'],
		'manifest':'packs/'+config['name']+'/pack.json'}

def main():
	arg=argparse.ArgumentParser(description=__doc__)
	arg.add_argument('--out',type=Path,required=True)
	a=arg.parse_args()
	dst=a.out.resolve()
	require(not dst.exists(),'Refusing overwrite '+str(dst))
	require(not str(dst).startswith(str(BASE/'launch33')),'Cannot write inside source bank')
	staging=dst.with_name('.'+dst.name+'.building')
	require(not staging.exists(),'Previous staging present '+str(staging))
	(staging/'packs').mkdir(parents=True)
	try:
		tracks=[create_pack(name,staging/'packs') for name in SONGS]
		(staging/'catalog.json').write_text(json.dumps({
			'format':'bitstream-music-catalog-v1','tracks':tracks,
		},indent=2)+'\n')
		(staging/'PRIVATE-README.txt').write_text(
			'PRIVATE TAILSCALE ONLY. 12 mountain voices for each of Pope and One More Run.\\n'
			'Generated with CC BY-NC SheetSage/MERT weights: not for commercial public release.\\n'
			'Contains only derived Opus segment audio and metadata, NO model checkpoints/weights.\\n'
			'Research packs MUST NOT be copied into real public/music or GitHub.\\n')
		staging.rename(dst)
		print('PROOF_LIBRARY_READY',dst,flush=True)
	except BaseException:
		print('BUILD_INCOMPLETE_STAGING',staging,flush=True)
		raise

if __name__=='__main__':main()
