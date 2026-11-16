#!/usr/bin/env python3
"""Offline continuous-pitch vocal-to-synth proof of concept; no MIDI quantization.

Read-only vocal FLAC input. Produces reusable analysis (.npz) and 48kHz mono WAV
outside the master bank. Requires numpy and ffmpeg (not an AI model).
The oscillator is a prototype, NOT an approved mountain instrument.
"""
import argparse
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

ANALYSIS_RATE = 16000
OUTPUT_RATE = 48000
HOP = 160
WINDOW = 2048
MIN_HZ = 80
MAX_HZ = 900


def analyze(input_file, max_seconds=0):
	command = [
		"ffmpeg", "-v", "error", "-nostdin", "-i", str(input_file),
		"-ac", "1", "-ar", str(ANALYSIS_RATE), "-f", "f32le", "pipe:1",
	]
	if max_seconds:
		command[command.index("-ac"):command.index("-ac")] = ["-t", str(max_seconds)]
	p = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
	x = np.frombuffer(p.stdout, dtype="<f4")
	positions = np.arange(0, max(1, len(x) - WINDOW), HOP)
	lag = np.arange(1, int(ANALYSIS_RATE / MIN_HZ) + 2)
	min_lag = int(ANALYSIS_RATE / MAX_HZ)
	f0 = np.zeros(len(positions), dtype=np.float32)
	rms = np.zeros(len(positions), dtype=np.float32)
	conf = np.zeros(len(positions), dtype=np.float32)
	hann = np.hanning(WINDOW).astype(np.float32)
	for start in range(0, len(positions), 128):
		end = min(len(positions), start + 128)
		frames = np.stack([x[i:i + WINDOW] for i in positions[start:end]])
		rms[start:end] = np.sqrt((frames * frames).mean(axis=1))
		windowed = frames * hann
		fft = np.fft.rfft(windowed, n=WINDOW * 2, axis=1)
		corr = np.fft.irfft(fft * fft.conj(), n=WINDOW * 2, axis=1).real
		power = np.cumsum(windowed ** 2, axis=1)
		left = power[:, WINDOW - lag - 1]
		right = power[:, -1, None] - power[:, lag - 1]
		difference = np.maximum(1e-10, left + right - 2 * corr[:, lag])
		cumulative = np.maximum(1e-10, np.cumsum(difference, axis=1))
		cmnd = difference * lag[None, :] / cumulative
		candidate = (cmnd < 0.18) & (lag[None, :] >= min_lag)
		candidate[:, :-1] &= cmnd[:, :-1] <= cmnd[:, 1:]
		available = candidate.any(axis=1)
		first = candidate.argmax(axis=1)
		best = cmnd[:, min_lag - 1:].argmin(axis=1) + min_lag - 1
		index = np.where(available, first, best)
		chosen = np.take_along_axis(cmnd, index[:, None], axis=1)[:, 0]
		voiced = chosen < 0.27
		# Three-point interpolation for non-quantized pitch and vibrato.
		low = np.maximum(0, index - 1)
		high = np.minimum(cmnd.shape[1] - 1, index + 1)
		ym = np.take_along_axis(cmnd, low[:, None], axis=1)[:, 0]
		y0 = chosen
		yp = np.take_along_axis(cmnd, high[:, None], axis=1)[:, 0]
		denom = ym - 2 * y0 + yp
		offset = np.where(np.abs(denom) > 1e-5, 0.5 * (ym - yp) / (denom + 1e-10), 0)
		offset = np.clip(offset, -0.5, 0.5)
		pitches = ANALYSIS_RATE / (lag[index] + offset)
		f0[start:end] = np.where(voiced, pitches, 0)
		conf[start:end] = np.where(voiced, 1 - chosen, 0)
	loud = max(0.001, float(np.percentile(rms, 90)))
	f0[rms < max(0.002, loud * 0.1)] = 0
	# Suppress isolated 10ms F0 spikes. Keep deliberate vocal slides/vibrato.
	for i in range(2, len(f0) - 2):
		neighbors = f0[i-2:i+3]
		voiced = neighbors[neighbors > 0]
		if f0[i] > 0 and len(voiced) >= 3:
			median = np.median(voiced)
			if f0[i] > 1.85 * median or f0[i] < median / 1.85:
				f0[i] = median
	time = (positions + WINDOW / 2) / ANALYSIS_RATE
	return {"time": time.astype(np.float32), "f0": f0, "rms": rms, "confidence": conf,
		"duration": float(len(x) / ANALYSIS_RATE), "loudness_ref": loud}


def render(analysis, output_file, output_frames, mode="bitstream"):
	f0 = analysis["f0"]
	time = analysis["time"]
	rms = analysis["rms"]
	loud = max(0.001, float(analysis["loudness_ref"]))
	out = Path(output_file)
	out.parent.mkdir(parents=True, exist_ok=True)
	phase = 0
	with wave.open(str(out), "wb") as w:
		w.setnchannels(1); w.setsampwidth(2); w.setframerate(OUTPUT_RATE)
		for begin in range(0, output_frames, 480000):
			frames = min(480000, output_frames - begin)
			times = (begin + np.arange(frames)) / OUTPUT_RATE
			pitch = np.interp(times, time, f0, left=0, right=0)
			level = np.interp(times, time, rms, left=0, right=0)
			voice_gate = np.interp(times, time, (f0 > 0).astype(np.float32), left=0, right=0)
			# Continuous phase: no MIDI note-ons, rounded pitches, or broken vibrato.
			angle = phase + np.cumsum(2 * np.pi * pitch / OUTPUT_RATE)
			phase = float(angle[-1] % (2 * np.pi))
			env = np.minimum(1, level / loud) ** 0.62 * voice_gate
			if mode == "theremin":
				signal = np.sin(angle) * 0.74 + np.sin(angle * 2) * 0.08
			elif mode == "brass":
				signal = np.tanh(2.4 * np.sin(angle) + 0.4 * np.sin(2 * angle))
			else:
				# Rounded pulse + chip harmonics, not an original vocal recording.
				signal = 0.75 * np.tanh(4.0 * np.sin(angle)) + 0.2 * np.sin(3 * angle)
				# Hold 1/2 samples gives slightly retro DAC character without losing note timing.
			pcm = np.int16(np.clip(signal * env * 0.33, -0.8, 0.8) * 32767)
			w.writeframes(pcm.astype("<i2").tobytes())
	return str(out)


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--input", required=True, type=Path)
	parser.add_argument("--output", required=True, type=Path)
	parser.add_argument("--cache", required=True, type=Path)
	parser.add_argument("--frames", required=True, type=int, help="EXACT output 48kHz frame count from pack manifest")
	parser.add_argument("--mode", choices=["bitstream", "theremin", "brass"], default="bitstream")
	parser.add_argument("--seconds", type=float, default=0, help="Prototype first N seconds (0=full)")
	a = parser.parse_args()
	if a.input.resolve() == a.output.resolve() or a.input.resolve() == a.cache.resolve():
		raise SystemExit("Refusing to overwrite source recording")
	if a.cache.exists():
		with np.load(a.cache) as npz:
			analysis = {key: npz[key] for key in npz.files}
	else:
		analysis = analyze(a.input, a.seconds)
		a.cache.parent.mkdir(parents=True, exist_ok=True)
		np.savez_compressed(a.cache, **analysis)
	output_frames = min(a.frames, int(round(a.seconds * OUTPUT_RATE))) if a.seconds else a.frames
	render(analysis, a.output, output_frames, a.mode)
	voiced = analysis["f0"] > 0
	print(json.dumps({"audio":str(a.output),"analysis":str(a.cache),
		"seconds":round(output_frames / OUTPUT_RATE, 3),
		"voiced_fraction":round(float(np.mean(voiced)),3),
		"median_f0_hz":round(float(np.median(analysis["f0"][voiced])),2) if voiced.any() else 0,
		"mode":a.mode},indent=2))


if __name__ == "__main__":
	main()
