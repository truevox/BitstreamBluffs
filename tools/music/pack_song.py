#!/usr/bin/env python3
"""Build a small, independent Opus music pack from validated Demucs six-stem masters.

Read-only master inputs; derivative output outside the source bank. No Demucs invocation.
"""
import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

STEMS = ("vocals", "drums", "bass", "guitar", "piano", "other")
RATE = 48000
CHANNELS = 2
SAMPLE_BYTES = 2 * CHANNELS


def require(condition, message):
	if not condition:
		raise ValueError(message)


def encode_segment(pcm, target, bitrate):
	command = [
		"ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-f", "s16le", "-ar", str(RATE), "-ac", str(CHANNELS), "-i", "pipe:0",
		"-c:a", "libopus", "-application", "audio", "-b:a", bitrate,
		"-vbr", "on", "-f", "ogg", str(target),
	]
	result = subprocess.run(command, input=pcm, capture_output=True, check=False)
	if result.returncode:
		raise RuntimeError("ffmpeg encode failed: " + result.stderr.decode(errors="replace")[-1000:])


def build(root, out, slot, chunk_seconds, preview_seconds, bitrate):
	roster = json.loads((root / "game-stems-manifest.json").read_text())
	status = json.loads((root / "stem_status.json").read_text())
	track = next((t for t in roster["tracks"] if int(t["slot"]) == slot), None)
	require(track is not None, "Unknown roster slot")
	track_id = str(track["id"])
	checked = status["tracks"].get(track_id, {})
	require(checked.get("status") == "complete", "Track is not fully validated yet")
	details = checked["stems"]
	for stem in STEMS:
		path = root / track["stem_files"][stem]
		require(path.is_file(), "Missing " + str(path))
		require(details[stem]["sample_rate"] == 44100, "Unexpected master sample rate")
		require(details[stem]["channels"] == 2, "Unexpected channel count")
	require(len({details[s]["frames"] for s in STEMS}) == 1, "Master stems differ in length")
	total_source_frames = details["vocals"]["frames"]
	full_frames = round(total_source_frames * RATE / 44100)
	frame_limit = full_frames if preview_seconds <= 0 else min(full_frames, preview_seconds * RATE)
	chunk_frames = chunk_seconds * RATE
	counts = [min(chunk_frames, frame_limit - start) for start in range(0, frame_limit, chunk_frames)]
	require(bool(counts), "No source audio")
	name = f"{slot:02d}_{track_id}"
	pack_dir = out / "packs" / name
	require(not pack_dir.exists(), "Pack already exists: " + str(pack_dir))
	build_dir = out / "packs" / (".building-" + name)
	require(not build_dir.exists(), "Previous staging directory exists: " + str(build_dir))
	build_dir.mkdir(parents=True)
	try:
		segments = [
			{"startFrame": i * chunk_frames, "frames": frames, "sources": {}}
			for i, frames in enumerate(counts)
		]
		for stem in STEMS:
			input_file = root / track["stem_files"][stem]
			command = [
				"ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
				"-i", str(input_file), "-vn", "-ar", str(RATE),
				"-ac", str(CHANNELS), "-f", "s16le", "pipe:1",
			]
			proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
			try:
				for i, frames in enumerate(counts):
					pcm = proc.stdout.read(frames * SAMPLE_BYTES)
					require(len(pcm) == frames * SAMPLE_BYTES, "Unexpected EOF in " + stem)
					filename = f"{i:04d}-{stem}.ogg"
					encode_segment(pcm, build_dir / filename, bitrate)
					segments[i]["sources"][stem] = filename
			finally:
				if proc.stdout:
					proc.stdout.close()
				if proc.poll() is None:
					proc.terminate()
				proc.wait()
		pack = {
			"format": "bitstream-music-pack-v1",
			"id": track_id,
			"title": track["title"],
			"source": "Demucs htdemucs_6s / " + name,
			"sampleRate": RATE,
			"frameCount": frame_limit,
			"preview": preview_seconds > 0,
			"segments": segments,
		}
		(build_dir / "pack.json").write_text(json.dumps(pack, indent=2) + "\n")
		build_dir.rename(pack_dir)
	except BaseException:
		shutil.rmtree(build_dir, ignore_errors=True)
		raise
	catalog_file = out / "catalog.json"
	catalog = json.loads(catalog_file.read_text()) if catalog_file.exists() else {
		"format": "bitstream-music-catalog-v1", "tracks": []
	}
	previous = next((t for t in catalog["tracks"] if t["id"] == track_id), {})
	catalog["tracks"] = [t for t in catalog["tracks"] if t["id"] != track_id]
	# Repacking must not drop catalog-only metadata such as a confirmed youtubeId (billboard artwork, #54).
	extra = {k: v for k, v in previous.items() if k not in ("id", "title", "manifest")}
	catalog["tracks"].append({
		"id": track_id,
		"title": track["title"],
		**extra,
		"manifest": "packs/" + name + "/pack.json",
	})
	tmp = out / "catalog.json.tmp"
	tmp.write_text(json.dumps(catalog, indent=2) + "\n")
	tmp.replace(catalog_file)
	print(json.dumps({"pack": str(pack_dir), "segments": len(segments), "seconds": round(frame_limit/RATE, 2), "tracks": len(catalog["tracks"])}, indent=2))


def main():
	p = argparse.ArgumentParser(description=__doc__)
	p.add_argument("--root", type=Path, default=Path("/root/bitstream-maxi/launch32"))
	p.add_argument("--out", type=Path, required=True, help="New independent derivative directory")
	p.add_argument("--slot", type=int, required=True)
	p.add_argument("--chunk-seconds", type=int, default=10)
	p.add_argument("--preview-seconds", type=int, default=0, help="0 = full track")
	p.add_argument("--bitrate", default="80k")
	a = p.parse_args()
	require(a.chunk_seconds >= 2 and a.chunk_seconds <= 30, "chunk size must be 2..30 seconds")
	require(a.preview_seconds >= 0, "preview seconds cannot be negative")
	require(a.root.resolve() != a.out.resolve(), "Refusing to write to source bank")
	require(not a.root.resolve().is_relative_to(a.out.resolve()), "Output must not contain source bank")
	require(not a.out.resolve().is_relative_to(a.root.resolve()), "Output must be outside master bank")
	build(a.root, a.out, a.slot, a.chunk_seconds, a.preview_seconds, a.bitrate)


if __name__ == "__main__":
	main()
