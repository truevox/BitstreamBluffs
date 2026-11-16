#!/usr/bin/env python3
"""Full song backing/vocal references for two 12-voice auditions.

Only independent derived Opus files. Original stems are read-only.
Each output is mono 48kHz, full original sample-clock duration.
"""
import json,subprocess
from pathlib import Path
ROOT=Path('/root/bitstream-maxi/transcription-lab-20261115')
CONFIG={
	'pope':dict(
		full=ROOT/'full-song-pope',
		stem=Path('/root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4'),
		vocal=Path('/root/bitstream-maxi/launch32/stems/htdemucs_6s/01_FEsxYVStla4/vocals.flac'),
		master=Path('/root/bitstream-maxi/launch32/audio/01_FEsxYVStla4.mp3'),
		duration=10318847/48000,
	),
	'one-more-run':dict(
		full=ROOT/'full-song-one-more-run',
		stem=Path('/root/bitstream-maxi/launch33/stems/grouped_6s/33_one_more_run'),
		vocal=Path('/root/bitstream-maxi/launch33/stems/original_11s/33_one_more_run/vocals.wav'),
		master=Path('/root/bitstream-maxi/launch33/audio/33_one_more_run.mp3'),
		duration=8380800/48000,
	),
}
def cmd(args):
	subprocess.run(args,check=True)
def ffprobe(file):
	v=subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(file)],text=True)
	return float(v.strip())
for song,c in CONFIG.items():
	d=c['full']/'full-palette'
	d.mkdir(parents=True,exist_ok=True)
	assert c['stem'].is_dir()
	for name in ('drums','bass','guitar','piano','other'):
		assert (c['stem']/(name+'.flac')).is_file()
	assert c['vocal'].is_file() and c['master'].is_file()
	vout=d/'original-vocal-full.ogg'
	bout=d/'backing-full.ogg'
	if vout.exists():
		assert abs(ffprobe(vout)-c['duration'])<.08
	else:
		print('NEW_VOCAL',song,flush=True)
		cmd(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',
			'-i',str(c['vocal']),'-vn','-ac','1','-ar','48000',
			'-c:a','libopus','-b:a','112k',str(vout)])
	if bout.exists():
		existing=ffprobe(bout)
		if abs(existing-c['duration'])<.08:
			print('REUSE_VALID_BACKING',song,round(existing,3),flush=True)
		else:
			print('INVALID_DERIVED_BACKING_REENCODE',song,round(existing,3),flush=True)
			bout.unlink()
	print('BACKING_FIVE_STEMS',song,flush=True)
	inputs=[]
	for name in ('drums','bass','guitar','piano','other'):
		inputs+=['-i',str(c['stem']/(name+'.flac'))]
	filtercomplex=''.join(f'[{i}:a]' for i in range(5))
	filtercomplex+='amix=inputs=5:normalize=0:duration=longest,'
	filtercomplex+=f'volume=0.75,alimiter=limit=0.90,aresample=48000:resampler=soxr:precision=28,apad=whole_dur={c["duration"]:.7f},atrim=duration={c["duration"]:.7f}[a]'
	if not bout.exists():
		cmd(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y',*inputs,
			'-filter_complex',filtercomplex,'-map','[a]','-ac','1',
			'-c:a','libopus','-b:a','128k',str(bout)])
	for f in (vout,bout):
		seconds=ffprobe(f)
		assert abs(seconds-c['duration'])<.10,(song,f,seconds,c['duration'])
		print('READY',song,f.name,f.stat().st_size,round(seconds,3),flush=True)
	(d/'references.json').write_text(json.dumps(dict(
		song=song,originalSeconds=c['duration'],
		vocal=vout.name,backing=bout.name,
		backingSources=['drums','bass','guitar','piano','other'],
		notes='Source stems kept untouched. Instrumental backing derived from five non-vocal stems; source master preferred for exact neutral playback.',
	),indent=2)+'\n')
