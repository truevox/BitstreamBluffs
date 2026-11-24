#!/usr/bin/env python3
"""Build ONE of the 29 NEW source-backed melody-only private game packs.

Keep all six original instrumental/vocal stems, add 12 independent biome
melody leads. Uses the same model-free YIN vocal extraction and V1 character
synthesis as the already-running four-song game. It intentionally avoids the
license-restricted SheetSage/MERT checkpoints and keeps scores UNVERIFIED.

Run on CT211 with its existing Python environment and authentic launch33
masters; output must live OUTSIDE that archive. One song is staged separately
and atomically promoted only after every Opus chunk passes an exact decode
frame count. No source master or existing released 4-song pack is overwritten.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import time

import numpy as np

from pack_song import build as build_core
from build_provisional_melody_v1 import read_mono,detect,synth
from opus_exact_segments import encode_exact_segments
from render_full_dynamic_orchestra_v1 import render_notes

RATE=48000
CORE=('vocals','drums','bass','guitar','piano','other')
BIOMES=(
	'debutmont','garbage-dump-glacier','pyramid-peak',
	'underwater-mountain','crystal-cavern','space-mountain',
	'candy-cane-canyon','sky-jellyfish-mountain','steampunk-slopes',
	'micro-mountain','vertigo-vents',
)
PRESERVED_SLOTS={1,3,31,33}

def sha(path):
	h=hashlib.sha256()
	with path.open('rb') as f:
		for part in iter(lambda:f.read(2<<20),b''):
			h.update(part)
	return h.hexdigest()

def quality(sound):
	if not np.isfinite(sound).all():raise ValueError('Nonfinite rendered PCM')
	peak=float(np.max(np.abs(sound)))
	rms=float(np.sqrt(np.mean(sound.astype('float64')**2)))
	if peak<.002 or rms<.0005:raise ValueError('Melody rendered silent; needs review')
	gain=min(1.,.83/peak)
	return (sound*gain).astype('float32'),{'untrimmedPeak':peak,'rmsBeforeTrim':rms,'safetyGain':gain}

def build_song(args):
	master=args.master.resolve()
	root=args.out.resolve()
	if master==root or master in root.parents or root in master.parents:
		raise ValueError('Output must be separate from and not enclose originals')
	if args.slot in PRESERVED_SLOTS:
		raise ValueError('Already established four-song melody: preserve instead of rebuilding')
	roster=json.loads((master/'game-stems-manifest.json').read_text())
	track=next((s for s in roster['tracks'] if int(s['slot'])==args.slot),None)
	if not track:raise ValueError('Unknown source slot')
	name=f'{args.slot:02d}_{track["id"]}'
	pack_target=root/'packs'/name
	if pack_target.exists():raise FileExistsError('Already built; refusing overwrite '+str(pack_target))
	stage=root/'.song-staging'/name
	if stage.exists():raise FileExistsError('Existing stage requires inspection '+str(stage))
	stage.mkdir(parents=True)
	start=time.monotonic()
	try:
		# pack_song creates a 12-second exact source grid, six original stems,
		# and its own catalog in this PER-SONG stage (no multiworker races).
		build_core(master,stage,args.slot,12,0,'64k')
		pack_dir=stage/'packs'/name
		manifest=pack_dir/'pack.json'
		doc=json.loads(manifest.read_text())
		frames=int(doc['frameCount'])
		segments=doc['segments']
		assert sum(s['frames'] for s in segments)==frames
		vocals=master/track['stem_files']['vocals']
		assert vocals.is_file()
		original_hash=sha(vocals)
		mono=read_mono(vocals)
		notes,stats=detect(mono,frames/RATE)
		if stats['voicedFraction']<.04 or len(notes)<25:
			raise ValueError('No reliable automatic melody candidates; needs manual review')
		for n in notes:
			if not 40<=n['midi']<=94 or n['start']>=n['end']:
				raise ValueError('Implausible automatic note; reject pending review')
		note_provenance={'format':'bitstream-provisional-melody-33-v1',
			'status':'provisional-unreviewed; source vocal pitch hypotheses; NOT artist transcription',
			'algorithm':'model-free librosa YIN, 16kHz, 10ms hop, note segmentation',
			'songId':track['id'],'slot':args.slot,'sourceStemSha256':original_hash,
			'sourceStem':track['stem_files']['vocals'],
			'frameCount':frames,'statistics':stats,'notes':notes}
		# This audit is only retained in the private staging collection;
		# never ship source f0/notes or raw vocal recordings to public Git.
		home=synth(notes,frames)
		home_stereo=np.column_stack([home,home])
		home_stereo,home_quality=quality(home_stereo)
		home_dir=pack_dir/'melodies'/'home'
		home_files=encode_exact_segments(home_stereo,home_dir,'melody',segments,rate=RATE,bitrate='52k')
		variant_quality={'bitstream-bluffs':home_quality}
		for id in BIOMES:
			# Earlier source character model still uses deBUMont internally;
			# game-facing biome ID and new archive path use canonical deBUTmont.
			model_id='debumont' if id=='debutmont' else id
			wave=render_notes(notes,model_id,frames,'melody')
			wave,metrics=quality(wave)
			folder=pack_dir/'melodies'/id
			encode_exact_segments(wave,folder,'melody',segments,rate=RATE,bitrate='52k')
			variant_quality[id]=metrics
			print('MELODY_BIOME',args.slot,id,len(segments),round(time.monotonic()-start,1),flush=True)
		for i,seg in enumerate(segments):
			assert set(seg['sources'])==set(CORE)
			seg['sources']['voice:bitstream-bluffs']=str(Path('melodies/home')/home_files[i])
			for id in BIOMES:
				seg['sources']['voice:'+id]=f'melodies/{id}/melody-{i:04d}.ogg'
			assert len(seg['sources'])==18
		assert len(list((pack_dir/'melodies').rglob('*.ogg')))==12*len(segments)
		doc['source']='PRIVATE original six stems + source-derived, model-free 12-biome provisional melodic synth'
		doc['scoreDisclaimer']='Automatic YIN source-vocal note candidates, NOT artist verified; original six stems are unchanged. No SheetSage/MERT noncommercial weights.'
		doc['melodyOnlyVersion']='model-free-v1 source-bound provisional'
		manifest.write_text(json.dumps(doc,indent=2)+'\n')
		pack_target.parent.mkdir(parents=True,exist_ok=True)
		# Use atomic rename ONLY after every source+melody Opus file exists
		# and each file independently passed exact decoded frame count.
		pack_dir.rename(pack_target)
		audit=root/'private-melody-audits'
		audit.mkdir(parents=True,exist_ok=True)
		note_provenance['render']={'biomeQuality':variant_quality,
			'segmentCount':len(segments),'elapsedSeconds':round(time.monotonic()-start,2)}
		note_provenance['noteEventSha256']=hashlib.sha256(json.dumps(notes,sort_keys=True).encode()).hexdigest()
		(audit/(name+'.json')).write_text(json.dumps(note_provenance,indent=2)+'\n')
		print('MELODY_SONG_COMPLETE',args.slot,track['id'],len(notes),'notes',
			len(segments),'segments',12*len(segments),'melody chunks',
			round(time.monotonic()-start,1),'seconds',flush=True)
	finally:
		# Do not delete a failed stage: preserve evidence for diagnosing
		# which step failed, never claim incomplete files as a completed song.
		pass

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--master',type=Path,default=Path('/root/bitstream-maxi/launch33'))
	p.add_argument('--out',required=True,type=Path)
	p.add_argument('--slot',required=True,type=int,choices=range(1,34))
	build_song(p.parse_args())
