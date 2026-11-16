#!/usr/bin/env python3
"""Research-only SheetSage2 on full One More Run supplied lead vocal WAV.
Existing pinned model and CPU-only spectrogram workaround; no game writes.
"""
import json,time,traceback,sys
from pathlib import Path
import torch
from torch import nn
from transformers import AutoModel
R=Path('/opt/sheetsage2-bitstream-20261115')
INPUT=R/'input/one-more-run/vocals.wav'
OUTPUT=R/'output/one-more-run-vocals-full'
assert INPUT.is_file() and not OUTPUT.exists()
class CPUFFT(nn.Module):
	def __init__(self,model):
		super().__init__()
		self.model=model.to('cpu')
	def forward(self,x):
		return self.model(x.detach().to('cpu',dtype=torch.float32)).to(x.device)
print('START',time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),flush=True)
model=AutoModel.from_pretrained(str(R/'code'),trust_remote_code=True).eval().to('cuda')
assert model.hparams.input_audio_length==300.
model.encoder.feature_extractor.spectrogram=CPUFFT(model.encoder.feature_extractor.spectrogram)
print('MODEL_READY',round(torch.cuda.memory_allocated()/1e9,2),'GB',flush=True)
t=time.monotonic()
r=model.transcribe(str(INPUT),output_dir=OUTPUT,dtype='bf16')
print('SUCCESS',json.dumps({k:r.get(k) for k in ('duration_seconds','melody_notes','vocal_notes','instrumental_notes','num_events','warnings')}),flush=True)
print('ELAPSED',round(time.monotonic()-t,2),'PEAK_GB',round(torch.cuda.max_memory_allocated()/1e9,2),flush=True)
assert (OUTPUT/'melody_vocal.mid').stat().st_size>500
print('OUTPUT',str(OUTPUT/'melody_vocal.mid'),flush=True)
