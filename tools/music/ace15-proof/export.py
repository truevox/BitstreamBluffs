#!/usr/bin/env python3
"""Export finished ACE Step 1.5 vocal-to-instrument covers with metadata."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

base=Path("/opt/ace15/auditions/bitstream-vocal-cover-20261115")
export=base/"exports"
export.mkdir(exist_ok=True)
source=base/"input/maxi-vocal-stem.mp3"
source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
assert source_hash=="5c5d6d1e92b3b1423f06ee5bffbae879b5a64734c60d793c897f23f8c63a4c63"
out={}
for preset in ("organ","holo"):
	for strength in ("90","70"):
		label=f"ace-{preset}-s{strength}"
		name=f"{preset}-215s-{strength}-20261115"
		r=base/"output"/name/"run.json"
		d=json.loads(r.read_text())
		assert d["status"]=="complete" and len(d["files"])==1,(name,d)
		flac=Path(d["files"][0])
		assert flac.is_file() and flac.stat().st_size>1_000_000
		full=export/f"{label}-full.ogg"
		excerpt=export/f"{label}-excerpt.ogg"
		if not full.is_file():
			subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
				"-i",str(flac),"-ar","48000","-c:a","libopus","-b:a","160k",
				str(full)],check=True)
		if not excerpt.is_file():
			subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
				"-ss","150","-t","25","-i",str(flac),"-ar","48000",
				"-c:a","libopus","-b:a","128k",str(excerpt)],check=True)
		def probe(path):
			x=subprocess.check_output(["ffprobe","-v","error","-show_entries",
				"format=duration","-of","default=noprint_wrappers=1:nokey=1",
				str(path)],text=True).strip()
			return float(x)
		def level(path):
			p=subprocess.run(["ffmpeg","-hide_banner","-nostdin","-i",str(path),
				"-af","volumedetect","-f","null","-"],capture_output=True,text=True)
			v=re.search(r"mean_volume:\s+(-?[0-9.]+)\s+dB",p.stderr)
			return float(v.group(1)) if v else None
		full_duration=probe(full)
		excerpt_duration=probe(excerpt)
		assert abs(full_duration-215)<2, (label,full_duration)
		assert abs(excerpt_duration-25)<.05,(label,excerpt_duration)
		item={
			"instrument":preset,"strength":int(strength)/100,"seed":d["seed"],
			"steps":d["steps"],"source_sha256":source_hash,
			"source_flac":str(flac),"source_flac_sha256":hashlib.sha256(flac.read_bytes()).hexdigest(),
			"full":full.name,"full_seconds":full_duration,"full_bytes":full.stat().st_size,
			"excerpt":excerpt.name,"excerpt_seconds":excerpt_duration,
			"excerpt_bytes":excerpt.stat().st_size,"excerpt_mean_dbfs":level(excerpt),
			"elapsed_seconds":d["elapsedSeconds"],"generator_model":d["model"]
		}
		out[label]=item
		print(json.dumps({"name":label,"fullSeconds":full_duration,
			"excerptSeconds":excerpt_duration,"excerptMeanDb":item["excerpt_mean_dbfs"],
			"files":(full.stat().st_size,excerpt.stat().st_size)}),flush=True)
(export/"manifest.json").write_text(json.dumps({
	"experiment":"bitstream-maxi-ace15-cover",
	"source_sha256":source_hash,
	"model":"ACE-Step 1.5 Turbo",
	"gpu":"NVIDIA RTX 3060 12GB on CT214",
	"profiles":out,
},indent=2)+"\n")
print("COMPLETE",len(out))
