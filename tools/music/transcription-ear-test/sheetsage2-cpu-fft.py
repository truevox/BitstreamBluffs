#!/usr/bin/env python3
"""SheetSage2 original 300s-window transcription; GPU backbone, CPU-only FFT.

The official model's input window remains 300 seconds; only cuFFT execution
is substituted with numerically equivalent torchaudio STFT on CPU. All the
model weights, decoder, mel filtering and core audio windows remain original.
Research-only; noncommercial pretrained weights.
"""
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
	def __init__(self,wrapped):
		super().__init__()
		self.original=wrapped.to('cpu')
	def forward(self,waveform):
		print('CPUFFT',tuple(waveform.shape),waveform.device,flush=True)
		result=self.original(waveform.detach().to('cpu',dtype=torch.float32))
		print('CPUFFT_RETURN',tuple(result.shape),flush=True)
		return result.to(waveform.device)

def run():
	print('LOAD_START',time.strftime('%H:%M:%S'),flush=True)
	start=time.monotonic()
	model=AutoModel.from_pretrained(str(ROOT/'code'),trust_remote_code=True).eval().to('cuda')
	print('MODEL_LOADED',time.monotonic()-start,'window',model.hparams.input_audio_length,'vram',torch.cuda.memory_allocated()/1e9,flush=True)
	assert model.hparams.input_audio_length==300.0
	frontend=model.encoder.feature_extractor
	frontend.spectrogram=CPUFFT(frontend.spectrogram)
	print('SPECTROGRAM_CPU_ONLY_GPU_MODEL',flush=True)
	try:
		res=model.transcribe(str(ROOT/'input/maxi-vocal-150-175.flac'),
			output_dir=ROOT/'output/maxi-vocal-25-cpufft',
			dtype='bf16')
		print('TRANSCRIBE_SUCCEEDED',list(res.keys()),time.monotonic()-start,flush=True)
		print('PEAK_GPU_GB',torch.cuda.max_memory_allocated()/1e9,flush=True)
	except Exception as e:
		print('TRANSCRIBE_FAILED',type(e).__name__,str(e),flush=True)
		traceback.print_exc()
		print('PEAK_GPU_GB',torch.cuda.max_memory_allocated()/1e9,flush=True)
		sys.exit(1)

if __name__=='__main__':
	run()
