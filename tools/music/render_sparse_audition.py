#!/usr/bin/env python3
"""Private, deliberately provisional One More Run sparse-MIDI audition.
Uses immutable event score + an UNVERIFIED source-beat candidate grid.
Never overwrites game stems; emits stand-alone 48 kHz Opus clips.
"""
import argparse
import bisect
import hashlib
import json
import math
import subprocess
from pathlib import Path

import numpy as np

RATE = 48000
PITCHED = ("bass", "guitar", "piano", "other")
ROLES = (*PITCHED, "drums")
MODES = ("dense", "beats", "eighths", "selective")
KIND_GAIN = {"bass": .11, "guitar": .027, "piano": .022, "other": .019,
			 "kick": .12, "snare": .060, "hat": .032}
OUTPUTS = ("recorded", "dense", "beats", "eighths", "selective", "hybrid")

def nearest(grid, frame):
	i = bisect.bisect_left(grid, frame)
	return min((j for j in (i-1, i) if 0 <= j < len(grid)),
			   key=lambda j: abs(grid[j]-frame))

def grid_for_mode(beats, mode):
	if mode == "beats":
		return beats
	return sorted(beats + [(a+b)//2 for a,b in zip(beats,beats[1:])])

def select_events(events, beats, mode, role):
	"""Choose whole onset groups; no quantization or invented note attacks."""
	if mode == "dense":
		return list(events)
	grid = grid_for_mode(beats, mode)
	tolerance = int(RATE * (.105 if mode == "beats" else .078 if mode == "eighths" else .135))
	groups = {}
	for event in events:
		groups.setdefault(event["startFrame"], []).append(event)
	candidates = []
	for onset, group in groups.items():
		idx = nearest(grid, onset)
		distance = abs(onset-grid[idx])
		if distance > tolerance and mode != "selective":
			continue
		if mode == "selective" and distance > RATE * .175:
			continue
		duration = max((e.get("endFrame",onset+2400)-onset)/RATE for e in group)
		drum_priority = 1.0 if any(e.get("class") in ("kick","snare") for e in group) else 0
		score = (1.1-distance/RATE*3 + min(duration,.7)*.6
				 + (len(group)>1)*.14 + drum_priority)
		candidates.append((idx, -score, onset, group))
	buckets = {}
	for idx, neg_score, onset, group in candidates:
		# Select a limited number of rhythmic ATTACKS, retaining the chord at each attack.
		# For the selective mode, rank both on-beat and offbeat candidates
		# against the same BEAT budget, rather than allowing two per eighth.
		bucket = nearest(beats,onset) if mode == "selective" else idx
		buckets.setdefault(bucket, []).append((neg_score,onset,group))
	quota = (1 if mode=="beats" else 2 if mode=="eighths" else
			 1 if role in ("bass","other") else 2)
	selected = []
	for idx, ranked in buckets.items():
		for _, onset, group in sorted(ranked)[:quota]:
			if role in ("piano","guitar","other") and len(group)>3:
				group = sorted(group,key=lambda e:(e.get("pitch",0),e["id"]))[:3]
			selected.extend(group)
	return sorted(selected,key=lambda e:(e["startFrame"],e.get("renderOrdinal",0)))

def decode_segment(path, frames):
	cmd = ["ffmpeg","-v","error","-nostdin","-i",str(path),"-ar",
		   str(RATE),"-ac","2","-f","f32le","pipe:1"]
	pcm = subprocess.run(cmd,check=True,capture_output=True,timeout=90).stdout
	audio = np.frombuffer(pcm,dtype="<f4").reshape(-1,2).copy()
	if abs(len(audio)-frames)>16:
		raise ValueError(f"segment PCM length mismatch {path}: {len(audio)} vs {frames}")
	if len(audio)!=frames:
		audio = np.pad(audio[:frames],((0,max(0,frames-len(audio))),(0,0)))
	return audio

def load_audio(pack, manifest, source, start, stop):
	pieces=[]
	for part in manifest["segments"]:
		begin = part["startFrame"]/RATE
		end = begin + part["frames"]/RATE
		if begin >= stop or end <= start: continue
		name = part["sources"].get(source)
		if name is None: raise ValueError(f"Missing source {source}")
		pcm=decode_segment(pack/name,part["frames"])
		lo=max(0,round((start-begin)*RATE))
		hi=min(len(pcm),round((stop-begin)*RATE))
		pieces.append(pcm[lo:hi])
	result=np.concatenate(pieces) if pieces else np.zeros((0,2),np.float32)
	expected=round((stop-start)*RATE)
	if len(result)!=expected:raise ValueError(f"{source}: got {len(result)}, wanted {expected}")
	return result

def render_event(out, role, event, t0):
	start=event["startFrame"]-t0
	if start < -RATE*2 or start>=len(out): return
	pitch=int(event.get("pitch",60))
	klass=event.get("class","note")
	duration = (event.get("endFrame",event["startFrame"]+round(.14*RATE))
				-event["startFrame"])/RATE
	if klass=="note":
		duration = min(1.65, max(.07, duration))
	else:
		duration={"kick":.22,"snare":.13,"hat":.09}.get(klass,.13)
	n=round(duration*RATE)
	low=max(0,start); high=min(len(out),start+n)
	if high<=low:return
	t=(np.arange(low-start,high-start,dtype=np.float32)/RATE)
	ordinal=event.get("renderOrdinal",0)
	key=int.from_bytes(hashlib.sha256(event["id"].encode()).digest()[:4],"big")
	if klass=="note":
		f=440*(2**((pitch-69)/12))
		# One consistent family of synthesis timbres across ALL MIDI-density conditions.
		if role=="bass":
			f = min(f,165)
			waves=np.sin(2*np.pi*f*t)+.2*np.sin(4*np.pi*f*t)
			env=np.minimum(1,t/.008)*np.minimum(1,(duration-t)/.045)
		elif role=="guitar":
			waves=(np.sin(2*np.pi*f*t)+.48*np.sin(4*np.pi*f*t)
				   +.2*np.sin(6*np.pi*f*t))
			env=np.minimum(1,t/.004)*np.exp(-t/max(.12,duration*.6))
		elif role=="piano":
			waves=(np.sin(2*np.pi*f*t)+.28*np.sin(4*np.pi*f*t)
				   +.13*np.sin(6*np.pi*f*t))
			env=np.minimum(1,t/.006)*np.exp(-t/max(.20,duration*.85))
		else:
			waves=(np.sin(2*np.pi*f*t)+.32*np.sin(2*np.pi*f*1.005*t)
				   +.20*np.sin(4*np.pi*f*t))
			env=np.minimum(1,t/.035)*np.minimum(1,(duration-t)/.10)
		sample=waves*np.maximum(0,env)*KIND_GAIN[role]
	else:
		rng=np.random.default_rng(key)
		noise=rng.standard_normal(len(t)).astype(np.float32)
		if klass=="kick":
			freq=100*(1+t*25)**(-.58)
			sample=(np.sin(2*np.pi*np.cumsum(freq)/RATE)+noise*.08)*np.exp(-t/.058)*KIND_GAIN["kick"]
		elif klass=="snare":
			sample=(noise*.7+np.sin(2*np.pi*420*t)*.3)*np.exp(-t/.032)*KIND_GAIN["snare"]
		else:
			sample=noise*np.exp(-t/.020)*KIND_GAIN["hat"]
	pan = (0.5 if role in ("bass","drums") else
		   .25 if role=="guitar" else .75 if role=="piano" else .55)
	out[low:high,0] += sample*math.cos(pan*math.pi/2)
	out[low:high,1] += sample*math.sin(pan*math.pi/2)


def write_ogg(path,audio):
	cmd=["ffmpeg","-v","error","-nostdin","-f","f32le","-ar",str(RATE),
		 "-ac","2","-i","pipe:0","-c:a","libopus","-b:a","112k",
		 "-vbr","on","-application","audio","-y",str(path)]
	subprocess.run(cmd,input=audio.astype("<f4",copy=False).tobytes(),
				   check=True,capture_output=True,timeout=180)

def run(args):
	pack=Path(args.pack)
	out=Path(args.out)
	if out.exists() and any(out.iterdir()):
		raise FileExistsError("Audition output is immutable; choose a fresh directory")
	out.mkdir(parents=True,exist_ok=True)
	score=json.loads((pack/"performance.json").read_text())
	manifest=json.loads((pack/"pack.json").read_text())
	grid_source=json.loads(Path(args.grid).read_text())
	if score["songId"]!="local-one-more-run-bitstream-bluffs" or grid_source["sourceId"]!=score["songId"]:
		raise ValueError("Source song mismatch")
	if score["frameCount"]!=grid_source["sourceFrameCount"] or score["frameCount"]!=manifest["frameCount"]:
		raise ValueError("Source duration mismatch")
	beats=grid_source["candidateGrid"]["timesSourceFrames"]
	if any(b>=c for b,c in zip(beats,beats[1:])):raise ValueError("Nonmonotone beat candidates")
	a=float(args.start);b=a+float(args.seconds)
	if b > score["frameCount"]/RATE:raise ValueError("Clip extends beyond track")
	first=round(a*RATE);last=round(b*RATE);n=last-first
	reference = load_audio(pack,manifest,"vocals",a,b)
	originals = {role: load_audio(pack,manifest,role,a,b) for role in ("drums","bass","guitar","piano","other")}
	recorded = reference.copy()
	game_names = {"drums":"drums","bass":"bass","guitar":"guitar","piano":"featured","other":"other"}
	for role in ROLES:
		recorded += load_adaptive(pack,manifest,game_names[role],a,b) # fixed prerecorded game MIDI
	variants={"recorded":recorded}
	stats={}
	for mode in MODES:
		accompaniment=np.zeros((n,2),dtype=np.float32)
		counts={}
		for role in ROLES:
			pool=[e for e in score["events"][role] if first-RATE <= e["startFrame"] < last]
			filtered=select_events(pool,beats,mode,role)
			counts[role]={"from":len(pool),"retained":len(filtered)}
			for e in filtered:render_event(accompaniment,role,e,first)
		variants[mode]=reference + accompaniment
		stats[mode]=counts
	# Hybrid: original recorded separated stems at reduced level plus selective MIDI accents.
	hybrid=reference.copy()
	for role in originals:hybrid += originals[role]*.44
	hybrid += (variants["selective"]-reference)*.38
	variants["hybrid"]=hybrid
	meta={"song":score["songId"],"title":"One More Run (The Ballad of Bitstream Bluffs)",
		  "sourceScoreHash":score["scoreHash"],"quality":"EXPERIMENTAL_UNREVIEWED",
		  "beatGrid":"UNVERIFIED_SOURCE_BEAT_TRACK_RESEARCH_NO_PRODUCTION_APPROVAL",
		  "start":a,"duration":b-a,"sampleRate":RATE,"counts":stats,"files":{}}
	for name in OUTPUTS:
		audio=variants[name]
		rms=float(np.sqrt(np.mean(np.square(audio,dtype=np.float64))))
		peak=float(np.max(np.abs(audio)))
		gain=min(.12/max(rms,1e-7), .92/max(peak,1e-7))
		audio=np.clip(audio*gain,-.96,.96).astype(np.float32)
		fn=name+".ogg"
		write_ogg(out/fn,audio)
		meta["files"][name]={"file":fn,"rmsBefore":round(rms,6),
							 "peakBefore":round(peak,6),"gain":round(float(gain),5)}
		print(name,meta["files"][name],flush=True)
	(out/"manifest.json").write_text(json.dumps(meta,indent=2)+"\n")
	print("AUDITION_CREATED",out)

def load_adaptive(pack,manifest,role,start,stop):
	# Adaptive role files are generated, recorded MIDI parts. Always use Debumont for a fixed comparison.
	pieces=[]
	for idx,part in enumerate(manifest["segments"]):
		b=part["startFrame"]/RATE;e=b+part["frames"]/RATE
		if b>=stop or e<=start:continue
		src=pack/"adaptive"/"debumont"/f"{role}-{idx:04}.ogg"
		pcm=decode_segment(src,part["frames"])
		lo=max(0,round((start-b)*RATE));hi=min(len(pcm),round((stop-b)*RATE))
		pieces.append(pcm[lo:hi])
	audio=np.concatenate(pieces)
	if len(audio)!=round((stop-start)*RATE):raise ValueError("Adaptive source mismatch")
	return audio

if __name__=="__main__":
	parser=argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--pack",required=True)
	parser.add_argument("--grid",required=True)
	parser.add_argument("--out",required=True)
	parser.add_argument("--start",type=float,default=36.)
	parser.add_argument("--seconds",type=float,default=48.)
	run(parser.parse_args())
