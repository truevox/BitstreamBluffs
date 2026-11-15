#!/usr/bin/env python3
"""Compile a static 12-voice audition manifest from generated full-length WAVs.

Audition audio is independent of the FLAC master bank. No source files are edited.
Run on CT211's existing numpy environment, then copy preview assets to the game host.
"""
import argparse
import json
import math
import wave
from pathlib import Path
import numpy as np


def profile_excerpt(path, start, seconds):
	with wave.open(str(path), "rb") as w:
		assert w.getframerate() == 48000 and w.getnchannels() == 1 and w.getsampwidth() == 2
		w.setpos(round(start * 48000))
		pcm = w.readframes(round(seconds * 48000))
	data = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
	assert len(data) == round(seconds * 48000)
	rms = float(np.sqrt(np.mean(data * data)))
	peak = float(np.max(np.abs(data)))
	return {
		"rmsDb": round(20 * math.log10(max(1e-9, rms)), 1),
		"peakDb": round(20 * math.log10(max(1e-9, peak)), 1),
		"rms": rms, "peak": peak,
	}


def main():
	p = argparse.ArgumentParser()
	p.add_argument("--root", required=True, type=Path)
	p.add_argument("--out", required=True, type=Path)
	a = p.parse_args()
	gallery = json.loads((a.root / "voice-gallery.json").read_text())
	a.out.mkdir(parents=True, exist_ok=True)
	output = {
		"format": "bitstream-voice-gallery-v1",
		"song": gallery["source"],
		"subtitle": "12 mountains. One continuous Maxi performance.",
		"excerptStartSeconds": gallery["previewStart"],
		"excerptSeconds": gallery["previewSeconds"],
		"sampleRate": gallery["sampleRate"],
		"backing": "backing-excerpt.ogg",
		"originalVocal": "original-vocal-excerpt.ogg",
		"notes": "Draft instrument sound-design auditions, not final approved audio. Vocal timing is driven by the separated performance, not MIDI.",
		"voices": []
	}
	target_rms = -20.0
	for voice in gallery["voices"]:
		profile = profile_excerpt(a.root / (voice["voice"] + ".wav"), output["excerptStartSeconds"], output["excerptSeconds"])
		gain_db = max(-3.8, min(4.5, target_rms - profile["rmsDb"]))
		# Keep at least 2 dB peak headroom.
		gain_db = min(gain_db, -2 - profile["peakDb"])
		output["voices"].append({
			"id": voice["voice"],
			"label": voice["label"],
			"instrument": voice["instrument"],
			"description": voice["description"],
			"file": voice["voice"] + "-excerpt.ogg",
			"gainDb": round(gain_db, 2),
			"rawRmsDb": profile["rmsDb"],
			"rawPeakDb": profile["peakDb"],
			"expectedPreviewSeconds": output["excerptSeconds"]
		})
		file = a.root / (voice["voice"] + "-excerpt.ogg")
		assert file.is_file() and file.stat().st_size > 10000
	out = a.out / "gallery.json"
	out.write_text(json.dumps(output, indent=2) + "\n")
	print(json.dumps({"path":str(out),"voices":len(output["voices"]),
		"gainRanges":[(v["label"], v["gainDb"],v["rawRmsDb"]) for v in output["voices"]]},indent=2))


if __name__ == "__main__":
	main()
