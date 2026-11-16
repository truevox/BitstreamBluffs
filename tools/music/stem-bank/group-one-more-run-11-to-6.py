#!/usr/bin/env python3
"""Add an *alternate* six-stem compatibility bank for One More Run.

Never overwrite imported 11 Suno/supplied WAV masters or 33-track archive.
Resample linearly-aligned 48k PCM to 44.1k stereo 24-bit FLAC, preserving
six expected stem names for the game. Main master remains neutral-mix source.

One group (drums+percussion) peaks +0.055 dBFS, so a documented gain
of 0.9936 is used to prevent FLAC PCM clipping. Runtime compensation
would be +0.0558 dB if you want source summation; original WAV remains
the exact reference and is NOT guaranteed reconstructed by source stems.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path

import soundfile as sf

ROOT=Path('/root/bitstream-maxi/launch33')
SOURCE=ROOT/'stems/original_11s/33_one_more_run'
TARGET=ROOT/'stems/grouped_6s/33_one_more_run'
STAGING=ROOT/'stems/grouped_6s/.33_one_more_run_work'
SOURCES={
	'vocals':['vocals','backing_vocals'],
	'drums':['drums','percussion'],
	'bass':['bass'],
	'guitar':['guitar'],
	'piano':['keyboard'],
	'other':['synth','strings','woodwinds','fx'],
}
assert len(set().union(*map(set,SOURCES.values())))==11
assert all((SOURCE/f'{s}.wav').is_file() for names in SOURCES.values() for s in names)
assert (ROOT/'audio/33_one_more_run.wav').is_file()
frames={sf.info(SOURCE/f'{name}.wav').frames for members in SOURCES.values() for name in members}
rates={sf.info(SOURCE/f'{name}.wav').samplerate for members in SOURCES.values() for name in members}
channels={sf.info(SOURCE/f'{name}.wav').channels for members in SOURCES.values() for name in members}
assert frames=={8380800} and rates=={48000} and channels=={2}
assert not TARGET.exists(), f"Already present: {TARGET}; abort duplicate generation"
STAGING.mkdir(parents=True,exist_ok=True)
report={
	'trackSlot':33,'id':'local-one-more-run-bitstream-bluffs',
	'title':'One More Run (The Ballad of Bitstream Bluffs)',
	'sourceStemCount':11,'compatibilityStemCount':6,
	'sourceLayout':'stems/original_11s/33_one_more_run/',
	'compatibilityLayout':'stems/grouped_6s/33_one_more_run/',
	'groups':{},
	'originalSampleRate':48000,'outputSampleRate':44100,
	'originalFrames':8380800,'targetFrames':7699860,
	'originalMaster':'audio/33_one_more_run.wav',
	'originalMasterPreserved':True,
	'neutralMixPolicy':'play original WAV at all gains unity; for ducking groups use grouped stems, not a claim of perfect reconstruction',
	'notes':[
		'Original supplied 11 WAV stems, original ZIP, original WAV/MP3 master remain untouched.',
		'All 11 channels have semantic homes in one and only one of six groups.',
		'11-stem direct sum has significant residual vs supplied original WAV, so six-stem sum also differs; no fake perfect reconstruction assertion.',
		'Drums+percussion combination peaks slightly above 0dBFS. Apply 0.9936 scale before integer FLAC to prevent clipping; metadata records this scale.',
		'FX is grouped with other because it is not a reliable melodic-keyboard or guitar source.',
	],
}
for group,names in SOURCES.items():
	out=STAGING/(group+'.flac')
	gain=0.9936 if group=='drums' else 1.0
	inputs=[]
	for n in names:inputs+=['-i',str(SOURCE/(n+'.wav'))]
	if len(names)==1:
		mix='[0:a]aresample=44100:resampler=soxr:precision=28'
	else:
		mix=''.join(f'[{i}:a]' for i in range(len(names)))
		mix+=f'amix=inputs={len(names)}:normalize=0:duration=first,aresample=44100:resampler=soxr:precision=28'
	if gain!=1.0:mix+=f',volume={gain}'
	mix+='[stem]'
	cmd=['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','2','-y',*inputs,
		'-filter_complex',mix,'-map','[stem]','-ac','2','-ar','44100',
		'-c:a','flac','-sample_fmt','s32','-bits_per_raw_sample','24','-compression_level','5',str(out)]
	print('GROUP',group,names,'gain',gain,flush=True)
	subprocess.run(cmd,check=True)
	i=sf.info(out)
	assert i.frames==7699860 and i.channels==2 and i.samplerate==44100 and i.subtype=='PCM_24',i
	assert out.stat().st_size>10000
	hash_=hashlib.sha256()
	with out.open('rb') as f:
		for block in iter(lambda:f.read(1024*1024),b''):
			hash_.update(block)
	report['groups'][group]={
		'sourceNames':names,
		'output':f'stems/grouped_6s/33_one_more_run/{group}.flac',
		'sourceGainApplied':gain,
		'runtimeGainToRecoverSourceSummation':round(1.0/gain,9),
		'sampleRate':i.samplerate,'frames':i.frames,'channels':i.channels,
		'bitsPerSample':24,'bytes':out.stat().st_size,
		'sha256':hash_.hexdigest(),
	}
	print('OK',group,'size',out.stat().st_size,'frames',i.frames,flush=True)
assert len(report['groups'])==6
(STAGING/'grouping.json').write_text(json.dumps(report,indent=2)+'\n')
STAGING.rename(TARGET)
print('PUBLISHED_COMPATIBILITY_BANK',str(TARGET),flush=True)
print('SOURCE_ORIGINALS_UNTOUCHED',flush=True)
