#!/usr/bin/env python3
"""Render full Pope gentle organ and pure-sheet control through original V3 organ.

No overwrite of masters. Require SheetSage2 research-rights review before game
release. Uses original FluidR3 GM organ (#19) and articulated_gallery_v2.polish.
"""
import hashlib,json,subprocess,sys,wave
from pathlib import Path

import numpy as np

SRC=Path('/root/bitstream-maxi/music-pack-pope-full')
sys.path.insert(0,str(SRC))
from sf2_melody_v2 import render as sf2_render
from articulated_gallery_v2 import polish,openwav,savewav

LAB=Path('/root/bitstream-maxi/transcription-lab-20261115/full-song-pope')
OUT=LAB/'output'
V1=Path('/root/bitstream-maxi/mountain-voice-gallery/vertigo-vents.wav')
FULL_FRAMES=10318847
RATE=48000
assert V1.is_file()
assert abs(wave.open(str(V1),'rb').getnframes()-FULL_FRAMES)<2

def hash_file(path):
	h=hashlib.sha256()
	with path.open('rb') as f:
		for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
	return h.hexdigest()

def render(name):
	b=OUT/name
	notes_json=b/'notes.json'
	analysis=b/'controls.npz'
	target=b/'pope-full-vertigo-church-organ.ogg'
	if target.is_file():
		print('EXISTS_ABORT',target,flush=True)
		raise RuntimeError('Will not overwrite prior generated audio')
	with np.load(analysis) as z:
		control={k:z[k] for k in z.files}
	notes=json.loads(notes_json.read_text())['notes']
	assert len(notes)>590
	print('PREPARED',name,'notes',len(notes),'controls',len(control['f0']),flush=True)
	scratch=b/'sample-sf2-temp.wav'
	result=sf2_render(analysis,notes_json,scratch,19,FULL_FRAMES,0.,FULL_FRAMES/RATE)
	print('SOUNDFONT_RENDERED',name,result,flush=True)
	sample=openwav(scratch)
	scratch.unlink()
	with wave.open(str(V1),'rb') as w:
		old=np.frombuffer(w.readframes(FULL_FRAMES),dtype='<i2').astype(np.float32)/32768
	assert len(old)==FULL_FRAMES and len(sample)==FULL_FRAMES
	audio,rms,peak=polish('vertigo-vents',old,sample,control,notes,0.,FULL_FRAMES/RATE)
	assert np.all(np.isfinite(audio))
	wav=b/'pope-full-vertigo-church-organ.wav'
	savewav(wav,audio)
	subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',
		'-i',str(wav),'-c:a','libopus','-b:a','144k','-ar','48000',str(target)],check=True)
	out={
		'variant':name,'format':'ogg-opus','sourceVocalStem':'Demucs isolated Maxi lead vocal',
		'transcription':'Official SheetSage2 full-song vocal melody',
		'stemCount':1,'notes':len(notes),'instrument':'original V3 sampled church organ / FluidR3 GM #19',
		'parentStemUnchanged':True,'userApproval':'pending full-song listening',
		'durationSeconds':FULL_FRAMES/RATE,
		'rmsDbfs':rms,'peakDbfs':peak,
		'oggPath':str(target),'wavPath':str(wav),
		'oggBytes':target.stat().st_size,'oggSha256':hash_file(target),
		'performancePrecision':'research audio generated with noncommercial SheetSage2 weights',
	}
	(b/'result.json').write_text(json.dumps(out,indent=2)+'\n')
	print('COMPLETE',name,'seconds',out['durationSeconds'],'notes',len(notes),
		'rms',rms,'peak',peak,'bytes',out['oggBytes'],flush=True)
	return out

if __name__=='__main__':
	result=[]
	for n in ('gentle','pure'):
		result.append(render(n))
	(OUT/'finished-results.json').write_text(json.dumps(result,indent=2)+'\n')
	print('ALL_FINISHED',len(result),flush=True)
