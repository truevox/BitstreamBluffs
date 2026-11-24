#!/usr/bin/env python3
"""Fixed audio segmentation: per-segment Opus encoder plus decoded frame gate.

The old ffmpeg '-f segment' on a continuous Opus stream produced 575688
decoded frames for nominal 576000 samples (6.5ms gap per 12s).
For a per-file encoder the Opus pre-skip/granule trim applies *per file*.
This module is shared by EVERY game melody/accompaniment/drum renderer.
"""
import subprocess
from pathlib import Path

import numpy as np


def decoded_frame_count(path,rate=48000,channels=2):
	result=subprocess.run([
		'ffmpeg','-hide_banner','-v','error','-nostdin',
		'-i',str(path),'-ac',str(channels),'-ar',str(rate),
		'-f','s16le','pipe:1'],
		capture_output=True,check=True,timeout=45)
	width=channels*2
	if len(result.stdout)%width:
		raise ValueError('Corrupt PCM decoder output: '+str(path))
	return len(result.stdout)//width


def encode_exact_segments(audio,dest,stem_name,segments,rate=48000,bitrate='52k'):
	"""Encode sample-accurate clips from full float32 stereo PCM; fail closed.

	The destination must not already contain files for this stem. The
	input audio must have precisely the expected number of frames.
	"""
	audio=np.asarray(audio,dtype='<f4')
	if audio.ndim!=2 or audio.shape[1]!=2 or not np.isfinite(audio).all():
		raise ValueError('Expected finite stereo PCM')
	if not segments or sum(seg['frames'] for seg in segments)!=audio.shape[0]:
		raise ValueError('Segment manifest does not match rendered PCM')
	dest=Path(dest)
	dest.mkdir(parents=True,exist_ok=True)
	for i,seg in enumerate(segments):
		path=dest/f'{stem_name}-{i:04d}.ogg'
		if path.exists():
			raise FileExistsError('Refusing overwriting audio: '+str(path))
		start=seg['startFrame']
		frames=seg['frames']
		if start<0 or frames<=0 or start+frames>len(audio):
			raise ValueError('Unsafe frame range')
		chunk=audio[start:start+frames]
		part=path.with_suffix('.part')
		try:
			result=subprocess.run([
				'ffmpeg','-hide_banner','-v','error','-nostdin','-y',
				'-f','f32le','-ar',str(rate),'-ac','2','-i','pipe:0',
				'-c:a','libopus','-application','audio','-b:a',bitrate,
				'-frame_duration','20','-vbr','on','-f','ogg',str(part)],
				input=chunk.tobytes(),capture_output=True,timeout=120)
			if result.returncode:
				raise RuntimeError(result.stderr.decode(errors='replace')[-900:])
			decoded=decoded_frame_count(part,rate)
			if decoded!=frames:
				raise ValueError('Decoded Opus frame count mismatch: '+str(part)+
					' actual='+str(decoded)+' required='+str(frames))
			part.rename(path)
		finally:
			if part.exists():
				part.unlink()
	return [f'{stem_name}-{i:04d}.ogg' for i in range(len(segments))]
