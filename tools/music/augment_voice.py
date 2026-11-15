#!/usr/bin/env python3
"""Add an offline-rendered, sample-aligned alternate singing voice to a derivative pack.

Never writes to FLAC masters. All segments must align with manifest frame counts.
Existing alternate name must be absent. Source audio is a 48kHz full-length WAV.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

from pack_song import RATE, CHANNELS, SAMPLE_BYTES, encode_segment, require


def augment(pack_file, source_audio, voice_name, bitrate):
	require(re.fullmatch(r"[a-zA-Z0-9:_-]{1,100}", voice_name), "Invalid source ID")
	require(voice_name.startswith("voice:"), "Alternate voice source ID must start with voice:")
	require(pack_file.is_file() and source_audio.is_file(), "Pack or voice WAV missing")
	require("/launch32/" not in str(pack_file.resolve()), "Refusing to mutate master bank")
	pack = json.loads(pack_file.read_text())
	require(pack.get("format") == "bitstream-music-pack-v1", "Unsupported pack format")
	require(pack.get("sampleRate") == RATE, "Expected 48kHz game pack")
	require(pack["frameCount"] > 0, "Empty pack")
	require(all(voice_name not in s["sources"] for s in pack["segments"]), "Voice already registered")
	files = []
	command = [
		"ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(source_audio),
		"-vn", "-ar", str(RATE), "-ac", str(CHANNELS), "-f", "s16le", "pipe:1",
	]
	process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
	try:
		for index, segment in enumerate(pack["segments"]):
			pcm = process.stdout.read(segment["frames"] * SAMPLE_BYTES)
			require(len(pcm) == segment["frames"] * SAMPLE_BYTES, "Voice WAV is too short")
			filename = f"{index:04d}-{voice_name.replace(':', '-')}.ogg"
			out = pack_file.parent / filename
			require(not out.exists(), "Derived segment already exists: " + str(out))
			files.append(out)
			encode_segment(pcm, out, bitrate)
			segment["sources"][voice_name] = filename
		require(not process.stdout.read(1), "Voice WAV is longer than pack")
		process.wait()
		require(process.returncode == 0, "Voice source read failure")
		pack.setdefault("effects", {})[voice_name] = [
			{"type": "filter", "id": "chip-tone", "mode": "lowpass", "frequency": 7800, "Q": 0.7},
		]
		tmp = pack_file.with_suffix(".json.tmp")
		tmp.write_text(json.dumps(pack, indent=2) + "\n")
		tmp.replace(pack_file)
	except BaseException:
		process.terminate()
		process.wait()
		for file in files:
			file.unlink(missing_ok=True)
		raise
	print(json.dumps({"pack":str(pack_file), "addedSource":voice_name,
		"segments":len(files),"bytes":sum(f.stat().st_size for f in files)},indent=2))


if __name__ == "__main__":
	p = argparse.ArgumentParser(description=__doc__)
	p.add_argument("--pack",type=Path,required=True)
	p.add_argument("--wav",type=Path,required=True)
	p.add_argument("--name",default="voice:bitstream-bluffs")
	p.add_argument("--bitrate",default="72k")
	a=p.parse_args()
	augment(a.pack,a.wav,a.name,a.bitrate)
