#!/usr/bin/env python3
"""Original official SheetSage2 with only CPU-backed FFT for CUDA compatibility.

Model context stays at the published 300 seconds. Scores are RESEARCH ONLY:
m-a-p/SheetSage2/MERT2 weights CC-BY-NC-4.0. Do not ship model outputs in game.
"""
import json
import os
import sys
import time
import traceback
from pathlib import Path
import torch
from torch import nn
from transformers import AutoModel

ROOT=Path('/opt/sheetsage2-bitstream-20261115')
torch.set_num_threads(4)
class CPUFFT(nn.Module):
	def __init__(self,spectrogram):
		super().__init__()
		self.spec=spectrogram.to('cpu')
	def forward(self,waveform):
		return self.spec(waveform.detach().to('cpu',dtype=torch.float32)).to(waveform.device)

def main():
	t0=time.monotonic()
	print('SHEETSAGE2_LOADING',flush=True)
	model=AutoModel.from_pretrained(str(ROOT/'code'),trust_remote_code=True).eval().to('cuda')
	assert model.hparams.input_audio_length==300.0
	model.encoder.feature_extractor.spectrogram=CPUFFT(model.encoder.feature_extractor.spectrogram)
	print('SHEETSAGE2_LOADED',round(time.monotonic()-t0,2),'window',model.hparams.input_audio_length,flush=True)
	matrix=[
		('fullmix-25',ROOT/'input/pope-fullmix-150-175.wav'),
		('fullmix-215',ROOT/'input/pope-fullmix-full.mp3'),
		('vocal-215',Path('/opt/ace15/auditions/bitstream-vocal-cover-20261115/input/maxi-vocal-stem.mp3')),
	]
	records=[]
	for name,source in matrix:
		assert source.is_file() and source.stat().st_size>100000,source
		output=ROOT/'output'/name
		print('BEGIN',name,'bytes',source.stat().st_size,flush=True)
		start=time.monotonic()
		try:
			result=model.transcribe(str(source),output_dir=output,dtype='bf16')
			d=dict(name=name,status='success',duration=result.get('duration_seconds'),
				melody_notes=result.get('melody_notes'),
				vocal_notes=result.get('vocal_notes'),
				instrumental_notes=result.get('instrumental_notes'),
				num_events=result.get('num_events'),
				warnings=result.get('warnings'),
				score=str(output/'score.abc'),
				seconds=round(time.monotonic()-start,2))
			print('RESULT',json.dumps(d),flush=True)
		except Exception as e:
			d=dict(name=name,status='error',error=str(e),seconds=round(time.monotonic()-start,2))
			print('FAILED',json.dumps(d),flush=True)
			traceback.print_exc()
		records.append(d)
		(ROOT/'output/batch-results.json').write_text(json.dumps(records,indent=2)+'\n')
		torch.cuda.empty_cache()
	print('BATCH_COMPLETE',json.dumps(records),flush=True)
	if any(x['status']!='success' for x in records):sys.exit(1)
if __name__=='__main__':main()
