#!/usr/bin/env python3
"""Isolated ACE-Step 1.5 cover test for Bitstream Bluffs.

No game repo modifications. Produces outputs in CT214 experiment directory.
Mode cover receives original isolated vocal waveform; no pitch extraction/MIDI.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("TOKENIZERS_PARALLELISM","false")
PROJECT_ROOT="/opt/ace15"
sys.path.insert(0,PROJECT_ROOT)

from loguru import logger
from acestep.handler import AceStepHandler
from acestep.inference import GenerationParams,GenerationConfig,generate_music

EXPERIMENT=Path(PROJECT_ROOT)/"auditions/bitstream-vocal-cover-20261115"
CAPTIONS={
 "organ": (
  "SOLO cathedral pipe organ instrumental performance. Full-bodied, beautiful resonant "
  "church organ with rich principal and diapason ranks, bright flute stops, soulful "
  "expressive phrasing. Play only Maxi's original lead vocal MELODY as a single "
  "organ lead. Exactly follow her notes, rapid attacks, intentional glides, rhythm "
  "and rests. No vocals, drums, accompaniment, counterpoint or added melodies."
 ),
 "holo": (
  "SOLO futuristic holographic glass synthesizer lead and ethereal analog pad "
  "instrumental. Shimmering luminous crystalline timbre, flowing expressive "
  "sustains, airy digital harmonics, soft evolving synth envelopes. Play only "
  "Maxi's original lead vocal MELODY with clear articulation, same exact "
  "phrase starts, precise note changes, held notes, glides and rests. "
  "No vocals, drums, beats, bassline, counterpoint or added harmonies."
 ),
}
def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--source",required=True)
 parser.add_argument("--preset",choices=list(CAPTIONS),required=True)
 parser.add_argument("--strength",type=float,required=True)
 parser.add_argument("--seconds",type=float,required=True)
 parser.add_argument("--seed",type=int,default=20261115)
 parser.add_argument("--steps",type=int,default=8)
 args=parser.parse_args()
 assert .0<=args.strength<=1.0
 assert os.path.isfile(args.source)
 name=f'{args.preset}-{args.seconds:g}s-{int(args.strength*100):02d}-{args.seed}'
 out=EXPERIMENT/"output"/name
 out.mkdir(parents=True,exist_ok=True)
 receipt=out/"run.json"
 assert not receipt.exists(),f"Already attempted {receipt}; prevent accidental duplicate"
 info={
  "source":args.source,
  "preset":args.preset,
  "caption":CAPTIONS[args.preset],
  "duration":args.seconds,
  "strength":args.strength,
  "seed":args.seed,
  "steps":args.steps,
  "model":"acestep-v15-turbo",
  "status":"starting",
  "requestTime":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
 }
 receipt.write_text(json.dumps(info,indent=2)+"\n")
 print("PREVIEW_STARTED",name,flush=True)
 begin=time.monotonic()
 handler=AceStepHandler()
 status,ok=handler.initialize_service(
  project_root=PROJECT_ROOT,
  config_path="acestep-v15-turbo",
  device="cuda",
  use_flash_attention=False,
  compile_model=False,
  offload_to_cpu=True,
  offload_dit_to_cpu=False,
 )
 print("MODEL_INIT",ok,status[:500],round(time.monotonic()-begin,1),flush=True)
 if not ok:
  info.update(status="init_failed",error=str(status))
  receipt.write_text(json.dumps(info,indent=2)+"\n")
  raise RuntimeError(status)
 params=GenerationParams(
  task_type="cover",
  src_audio=str(Path(args.source).resolve()),
  caption=CAPTIONS[args.preset],
  lyrics="[Instrumental]",
  instrumental=True,
  duration=args.seconds,
  audio_cover_strength=args.strength,
  inference_steps=args.steps,
  guidance_scale=1.0,
  thinking=False,
  use_cot_metas=False,
  use_cot_caption=False,
  use_cot_lyrics=False,
  use_cot_language=False,
 )
 config=GenerationConfig(
  batch_size=1,
  audio_format="flac",
  seeds=[args.seed],
  use_random_seed=False,
 )
 generation_start=time.monotonic()
 result=generate_music(handler,None,params,config,save_dir=str(out))
 elapsed=time.monotonic()-generation_start
 print("GENERATION_DONE",name,"success",result.success,
       "elapsed",round(elapsed,1),"error",str(result.error)[:250],
       "audios",len(result.audios),flush=True)
 info.update(status="complete" if result.success else "failed",
             elapsedSeconds=round(elapsed,2),
             error=str(result.error) if result.error else None,
             files=[str(Path(x.get("path",""))) for x in result.audios])
 receipt.write_text(json.dumps(info,indent=2)+"\n")
 if not result.success or not result.audios:raise RuntimeError("Generation failed: "+str(result.error))
 for x in result.audios:
  fp=Path(x["path"])
  assert fp.is_file() and fp.stat().st_size>50000,fp
  print("AUDIO_READY",str(fp),fp.stat().st_size,flush=True)
 print("EXIT_SUCCESS",name,flush=True)

if __name__=="__main__":
 main()
