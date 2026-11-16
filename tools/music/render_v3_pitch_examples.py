#!/usr/bin/env python3
"""Two-voice A/B test for V3 stable pitch control, retaining V2 note timings.

Render a SoundFont sample source from the new stable pitch path, then apply the
same V2 instrument polish so the comparison primarily isolates pitch control.
"""
import argparse
import json
import subprocess
import wave
from pathlib import Path

import numpy as np
from sf2_melody_v2 import render as synth_render
from articulated_gallery_v2 import polish, openwav, savewav, DESCRIPTIONS

RATE=48000
PROGRAMS={"candy-cane-canyon":81,"vertigo-vents":19}


def main():
	p=argparse.ArgumentParser()
	p.add_argument("--analysis",type=Path,required=True)
	p.add_argument("--notes",type=Path,required=True)
	p.add_argument("--v1-gallery",type=Path,required=True)
	p.add_argument("--out",type=Path,required=True)
	p.add_argument("--frame-count",type=int,required=True)
	p.add_argument("--start",type=float,default=150)
	p.add_argument("--seconds",type=float,default=25)
	a=p.parse_args()
	with np.load(a.analysis) as z:
		control={k:z[k] for k in z.files}
	notes=json.loads(a.notes.read_text())["notes"]
	window_notes=[n for n in notes if a.start-.01<=n["start"]<a.start+a.seconds]
	a.out.mkdir(parents=True,exist_ok=True)
	for name,program in PROGRAMS.items():
		temporary=a.out/(name+"-sf2-stable.wav")
		synth_render(a.analysis,a.notes,temporary,program,a.frame_count,a.start,a.seconds)
		sample=openwav(temporary)
		temporary.unlink()
		with wave.open(str(a.v1_gallery/(name+".wav")),"rb") as wav:
			wav.setpos(round(a.start*RATE))
			old=np.frombuffer(wav.readframes(round(a.seconds*RATE)),dtype="<i2").astype(np.float32)/32768
		audio,rms,peak=polish(name,old,sample,control,window_notes,a.start,a.seconds)
		outwav=a.out/(name+"-pitch35.wav")
		savewav(outwav,audio)
		outogg=a.out/(name+"-pitch35.ogg")
		subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y",
			"-i",str(outwav),"-c:a","libopus","-b:a","96k",str(outogg)],check=True)
		print(json.dumps(dict(name=name,rmsDb=rms,peakDb=peak,ogg=str(outogg),
			duration=a.seconds,originalTimingUnchanged=True)),flush=True)


if __name__=="__main__":
	main()
