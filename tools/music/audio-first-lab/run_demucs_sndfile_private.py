#!/usr/bin/env python3
"""Private Demucs research CLI with WAV writes via SoundFile when TorchCodec is absent.
Does NOT patch installed packages or alter the production audio demux workflow.
Only handles native WAV/FLAC outputs; refuses MP3.
"""
import sys
from pathlib import Path

import soundfile as sf
import torchaudio as ta

def safely_save(path,src,sample_rate,encoding=None,bits_per_sample=16,**kwargs):
	dst=Path(path)
	if dst.suffix.lower() not in ('.wav','.flac'):
		raise ValueError('Research writer refuses non-WAV/FLAC output')
	if dst.exists():
		raise FileExistsError('Refuse overwrite: '+str(dst))
	data=src.detach().cpu().numpy()
	if data.ndim!=2:
		raise ValueError('Expected [channels, samples] tensor')
	subtype='FLOAT' if encoding=='PCM_F' else (
		'PCM_24' if bits_per_sample==24 else 'PCM_16')
	if dst.suffix.lower()=='.flac' and subtype=='FLOAT':
		raise ValueError('FLOAT FLAC unsupported')
	sf.write(str(dst),data.T,int(sample_rate),subtype=subtype)
	return None

def main():
	ta.save=safely_save
	from demucs.separate import main as demucs_main
	return demucs_main()

if __name__=='__main__':
	sys.exit(main())
