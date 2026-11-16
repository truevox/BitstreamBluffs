#!/usr/bin/env python3
"""Full 12-mountain score-anchored instrumental voice renderer.

Pope + One More Run only. Same V2 articulated palette with source-note
F0/score from SheetSage2 -12, musical rests and onset attacks. The previously
approved short Pope Gentle organ has been completed as a full-song original
V3 organ; preserve that exact full-song file as its selected Vertigo voice.

No model checkpoint/output committed, no game pack overwrites, no source edits.
SheetSage2 weights have NC license: research auditions, not release assets.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np

SRC=Path('/root/bitstream-maxi/music-pack-pope-full')
sys.path.insert(0,str(SRC))
from render_mountain_voices import render_voice
from articulated_gallery_v2 import DESCRIPTIONS,PROGRAMS,openwav,savewav,polish
from sf2_melody_v2 import render as sf2_render

RATE=48000
BASE=Path('/root/bitstream-maxi/transcription-lab-20261115')
ROOTS={
	'pope':BASE/'full-song-pope',
	'one-more-run':BASE/'full-song-one-more-run',
}
FRAMES={'pope':10318847,'one-more-run':8380800}
SOURCE_VOCAL={
	'pope':Path('/root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4/vocals.flac'),
	'one-more-run':Path('/root/bitstream-maxi/launch33/stems/original_11s/33_one_more_run/vocals.wav'),
}
ORIGINAL_FULL_GENTLE=ROOTS['pope']/'output/gentle/pope-full-vertigo-church-organ.ogg'
ORIGINAL_FULL_GENTLE_WAV=ROOTS['pope']/'output/gentle/pope-full-vertigo-church-organ.wav'

def sha256(path):
	h=hashlib.sha256()
	with path.open('rb') as f:
		for c in iter(lambda:f.read(1024*1024),b''):
			h.update(c)
	return h.hexdigest()

def render_one(song):
	root=ROOTS[ song ]
	b=root/'output/gentle'
	analysis=b/'controls.npz'
	notespath=b/'notes.json'
	d=root/'full-palette'
	d.mkdir(parents=True,exist_ok=True)
	assert SOURCE_VOCAL[song].is_file()
	duration=FRAMES[song]/RATE
	with np.load(analysis) as z:
		ctrl={k:z[k].copy() for k in z.files}
	notes=json.loads(notespath.read_text())['notes']
	assert len(notes)>=300,(song,len(notes))
	assert abs(float(ctrl['duration'])-duration)<.1,(song,ctrl['duration'],duration)
	assert 'time' in ctrl and 'env' in ctrl and 'active' in ctrl

	# 100Hz continuous score target F0, bounded original within-note pitch
	# expression. There is no original F0 pitch center or octave leakage.
	clock=np.asarray(ctrl['time'],dtype=np.float32)
	pitches=np.asarray(ctrl['f0'],dtype=np.float64)
	is_on=np.asarray(ctrl['active'],dtype=bool)
	ids=np.flatnonzero(is_on & (pitches>40) & np.isfinite(pitches))
	assert len(ids)>500,ids
	melody=np.interp(np.arange(len(pitches)),ids,pitches[ids]).astype(np.float32)
	loudness=(np.asarray(ctrl['env'],dtype=np.float32)*is_on.astype(np.float32))
	loudness=np.clip(loudness,0,1.5)
	pluck=np.zeros(len(clock),dtype=np.float32)
	last=-10000
	onsets={int(round(n['start']*100)) for n in notes}
	for i in range(len(clock)):
		if i in onsets:last=i
		pluck[i]=float(np.exp(-max(0,i-last)*.01/.26))
	state=dict(
		clock=clock,pitch=melody,env=loudness,pluck=pluck,
		voices=is_on.astype(np.float32),
		duration=duration,loud_ref=float(np.max(loudness)),
		notes=len(notes),
	)

	record=dict(
		song= song,seconds=duration,frames=FRAMES[song],
		sampleRate=RATE,rawScoreNotes=len(notes),
		scoreSource='SheetSage2 lead-vocal transcription',
		registerShiftSemitones=-12,
		gentleMaxCents=32,gentleExpressionWeight=.72,
		sourceVocal=str(SOURCE_VOCAL[song]),
		sourceRights='Research/private audio only; SheetSage2/MERT weights CC-BY-NC',
		voices={},
	)
	manifest=d/'palette.json'
	for name,(label,instrument,description) in DESCRIPTIONS.items():
		full=d/(name+'-full.ogg')
		wav=d/(name+'-full.wav')
		if full.exists() or wav.exists():
			print('NO_OVERWRITE',song,name,flush=True)
			raise RuntimeError('Refusing to overwrite source output '+str(full))
		t=time.monotonic()
		if song=='pope' and name=='vertigo-vents':
			assert ORIGINAL_FULL_GENTLE.is_file() and ORIGINAL_FULL_GENTLE_WAV.is_file()
			shutil.copyfile(ORIGINAL_FULL_GENTLE,full)
			shutil.copyfile(ORIGINAL_FULL_GENTLE_WAV,wav)
			info={'source':'exact prior completed full Pope Gentle master (unchanged)'}
			print('REUSE_SAME_GENTLE_ORGAN',song,full,flush=True)
		else:
			# Render fresh *score-anchored* oscillator guide for each timbre.
			# Do NOT use the old uncorrected V1 F0 as input: it would undo
			# SheetSage correctness for bitstream, ocean, space and glacier.
			oldwav=d/(name+'-score-driven-texture.wav')
			print('SCORE_TEXTURE',song,name,flush=True)
			meta=render_voice(name,state,oldwav,frame_count=FRAMES[song])
			assert abs(meta['seconds']-duration)<.01
			old=openwav(oldwav)
			assert len(old)==FRAMES[song]
			sample=None
			if name in PROGRAMS:
				scratch=d/(name+'-sf2-temp.wav')
				print('SOUNDFONT',song,name,PROGRAMS[name],flush=True)
				sf2_render(analysis,notespath,scratch,PROGRAMS[name],FRAMES[song],0.,duration)
				sample=openwav(scratch)
				assert len(sample)==FRAMES[song]
				scratch.unlink()
			# Musical note timings/pitches come from SheetSage Gentle;
			# palette timbre/FX from prior articulated V2/V3 design.
			audio,rms,peak=polish(name,old,sample,ctrl,notes,0.,duration)
			assert np.isfinite(audio).all() and len(audio)==FRAMES[song]
			savewav(wav,audio)
			del old,sample,audio
			# Avoid retaining large temporary v1 textures after final WAV.
			oldwav.unlink()
			subprocess.run([
				'ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',
				'-i',str(wav),'-c:a','libopus','-b:a','128k',
				'-ar','48000',str(full),
			],check=True)
			info=dict(source='new score-anchored same V2 timbre',rmsDb=rms,peakDb=peak)
		assert full.is_file() and full.stat().st_size>1000000,full
		with wave.open(str(wav),'rb') as w:
			assert (w.getframerate(),w.getnchannels(),w.getnframes())==(48000,1,FRAMES[song])
		item=dict(
			id=name,label=label,instrument=instrument,description=description,
			audioFile=full.name,wavFile=wav.name,
			oggBytes=full.stat().st_size,wavBytes=wav.stat().st_size,
			oggSha256=sha256(full),elapsedSeconds=round(time.monotonic()-t,2),
			**info
		)
		record['voices'][name]=item
		manifest.write_text(json.dumps(record,indent=2)+'\n')
		print('FULL_VOICE_READY',song,name,'elapsed',item['elapsedSeconds'],'size',item['oggBytes'],flush=True)
	assert len(record['voices'])==12
	print('FULL_PALETTE_COMPLETED',song,len(record['voices']),round(duration,3),flush=True)

if __name__=='__main__':
	assert len(sys.argv)==2 and sys.argv[1] in ROOTS
	render_one(sys.argv[1])
