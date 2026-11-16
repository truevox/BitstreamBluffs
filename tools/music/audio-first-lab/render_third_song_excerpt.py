#!/usr/bin/env python3
"""Prepare private third-guitar showcase, no game/audio engine modification.

A short original/source-aligned excerpt plus eleven true native-SF2 guitar
instruments, 11 airborne drums, original/dsp and note-guided sampled bass.
The melody remains original Maxi vocals, intentionally NO fake biome leads.
"""
import json
from pathlib import Path
from audio_first_render import read_segment,ogg,render as spectral,BIOMES
from transcribe_source_bass import analyze
from render_note_guided_bass_v2 import render_one,PATCHES

BANK=Path('/root/bitstream-maxi/launch33/stems/htdemucs_6s/03_WRBGQUqD54U')
GUITARS=Path('/root/bitstream-maxi/private-hacker-guitar-20261116')
OUT=Path('/root/bitstream-maxi/private-hacker-full-lab-excerpt-20261116')
START=4.5
DURATION=32

def main():
	assert not OUT.exists(),'Refusing overwrite existing directory '+str(OUT)
	OUT.mkdir(parents=True)
	for k in ['original','melody','bass','bass-dsp','drums','featured']:
		(OUT/k).mkdir()
	sources={}
	for name in ('vocals','bass','drums','guitar','piano','other'):
		x=read_segment(BANK/(name+'.flac'),START,DURATION)
		sources[name]=x
		ogg(OUT/'original'/(name+'.ogg'),x)
		print('ORIGINAL',name,flush=True)
	# Offline bass pitch estimation on THIS source only, not on mixed master.
	estimated=analyze(BANK/'bass.flac',START)
	(OUT/'bass-note-estimates.json').write_text(json.dumps(estimated,indent=2)+'\n')
	report={'song':'Every Hacker (Runs Out of Code) - Part 2 of 2','start':START,'seconds':DURATION,
		'featured':'guitar',
		'bassNoteEvents':len(estimated['notes']),
		'bassPitchEstimateCoverage':estimated['coverage'],
		'guitarSourcePitchFile':'/root/bitstream-maxi/launch33/hacker-guitar-notes-private.json',
		'guitarVersions':11}
	for biome,label,desc in BIOMES:
		if biome=='bitstream-bluffs':continue
		assert (GUITARS/(biome+'.ogg')).exists(),biome
		for role in ('bass','drums'):
			version=spectral(sources[role],role,biome)
			ogg(OUT/('bass-dsp' if role=='bass' else 'drums')/(biome+'.ogg'),version)
			print('SOURCE_COLORED',biome,role,flush=True)
		notes=estimated['notes']
		if not notes:
			raise RuntimeError('No bass estimates to render sampled V2')
		sampled,meta=render_one('every-hacker',sources['bass'],notes,biome)
		ogg(OUT/'bass'/(biome+'.ogg'),sampled)
		print('REAL_SAMPLED_BASS',biome,meta,flush=True)
		# Separate actual sampled guitar clips are copied into live site later
		# and remain immutable, never 'EQ colored source' in featured bus.
	(OUT/'excerpt-report.json').write_text(json.dumps(report,indent=2)+'\n')
	assert len(list(OUT.rglob('*.ogg')))==39
	print('THIRD_SONG_AUDIO_PARTS_READY',OUT,'files',len(list(OUT.rglob('*.ogg'))),flush=True)

if __name__=='__main__':main()
