#!/usr/bin/env python3
"""Research-only independent original full-mix alignment via downsampled stdin.

Stream mono f32le PCM via FFmpeg; neither raw WAV nor decoded audio is saved.
Separate from stem source, all phases remain metrical-identity UNVERIFIED.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

from research_gym_beat_candidates import TARGET_RATE, HOP, onset_envelope
from research_gym_cross_stem_alignment import (
	ENVELOPE_RATE, FFT_SIZE, phases_for_frequency,
	align_harmonic_sections, top_spectral_peaks, wrapped_residual,
)


def source_chunks(pack, envelope):
	windows=[]
	for seg in pack['segments']:
		start=int(round(seg['startFrame']/pack['sampleRate']*ENVELOPE_RATE))
		end=min(len(envelope),int(round((seg['startFrame']+seg['frames'])/
			pack['sampleRate']*ENVELOPE_RATE)))
		if end-start<30:
			continue
		idx=np.arange(start,end,dtype='int32')
		windows.append((idx,envelope[start:end]))
	return windows


def analyze_mix(raw,pack,stem_report,source_sha,source_name):
	if len(raw)%4:
		raise ValueError('Expected aligned little-endian f32le mono')
	pcm=np.frombuffer(raw,dtype='<f4')
	assert abs(len(pcm)/TARGET_RATE-pack['frameCount']/pack['sampleRate'])<.2, (
		'Decoded WAV length does not match shipped recording')
	if not np.all(np.isfinite(pcm)):
		raise ValueError('Original PCM contains nonfinite samples')
	envelope=onset_envelope(pcm.astype('float64'))
	fft,freq,amplitude,top=top_spectral_peaks(envelope)
	windows=source_chunks(pack,envelope)
	results=[]
	for candidate in stem_report['pulseAlternatives']:
		bpm=candidate['bpm']
		if not any(abs(bpm-b)<.08 for b in [40.96,81.92,122.82,163.84]):
			continue
		f=bpm/60
		closest=np.argmin(np.abs(freq-f))
		phase,sections=phases_for_frequency(windows,f)
		stem_agreements={}
		for stem in ['drums','bass']:
			evidence=candidate['stemPhaseEvidence'][stem]
			comp=align_harmonic_sections(dict(absoluteOnsetPhaseSeconds=phase,
				sections=sections),evidence,bpm,bpm,ratio=1)
			stem_agreements[stem]=dict(
				phaseDifferenceMs=round(wrapped_residual(
					phase,evidence['absoluteOnsetPhaseSeconds'],1/f)*1000,2),
				alignedSections=comp['machineAlignedSections'],
				strongSections=comp['bothStemsStrongSections'],
				uniformPhaseNullExpected=comp['uniformRandomPhaseNullExpectedAlignments'],
				reviewSections=[sec['startSeconds'] for sec in comp['sections']
					if sec['candidateForHumanSpotCheck']],
			)
		results.append(dict(bpm=bpm,
			originalFullMixOnsetMagnitude=round(float(amplitude[closest]),4),
			originalMixPhaseSeconds=round(phase,6),
			sectionConcentration=sections,
			stemPhaseAgreement=stem_agreements,
			status='RESEARCH_ONLY_NOT_QUARTER_NOTE_VERIFIED'))
	return dict(format='bitstream-original-wav-mix-pulse-crosscheck-v1',
		status='ORIGINAL_RECORDING_RESEARCH_ONLY_NO_BEAT_GRID_PROMOTION',
		source=dict(recordingId=pack['id'],originalWavSha256=source_sha,
			originalWavLocation=source_name,decodedMonoF32leSha256=hashlib.sha256(raw).hexdigest(),
			decodedSampleRate=TARGET_RATE,frames=len(pcm),
			originalSeconds=round(len(pcm)/TARGET_RATE,6),
			mixEnvelopeFrames=len(envelope),
			shippedPackFrameCount=pack['frameCount'],
			shippedPackSampleRate=pack['sampleRate']),
		strongestOriginalMixOnsetRates=[dict(bpm=round(f*60,3),
			magnitude=round(v,3)) for f,v in top[:18]],
		candidateComparisons=results,
		limitations=['full mix may emphasize melody/voice rather than pulse',
			'mono 11025 Hz onset signal is an approximation',
			'no ear-confirmed metrical quarter-note or subdivisions',
			'phasor sections are not independent validation of source listening',
			'must not create trusted runtime beat grid from this report'])


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--original-sha256',required=True)
	p.add_argument('--original-name',required=True)
	p.add_argument('--stem-report',required=True)
	p.add_argument('--manifest',required=True)
	p.add_argument('--out',required=True)
	args=p.parse_args()
	out=Path(args.out)
	if out.exists():
		raise SystemExit('Refusing report overwrite: '+str(out))
	assert len(args.original_sha256)==64 and all(c in '0123456789abcdef' for c in args.original_sha256)
	pack=json.loads(Path(args.manifest).read_text())
	stem=json.loads(Path(args.stem_report).read_text())
	track=next((t for t in stem['tracks'] if t['trackId']==pack['id']),None)
	if not track:
		raise SystemExit('Stem source report does not contain same track ID')
	raw=sys.stdin.buffer.read()
	if not raw:
		raise SystemExit('No PCM input supplied (expected FFmpeg f32le mono)')
	report=analyze_mix(raw,pack,track,args.original_sha256,args.original_name)
	out.write_text(json.dumps(report,indent=2)+'\n')
	print('ORIGINAL_MIX',pack['id'],'top BPM',
		[v['bpm'] for v in report['strongestOriginalMixOnsetRates'][:6]])
	for candidate in report['candidateComparisons']:
		print('ORIGINAL_MIX_PULSE',candidate['bpm'],
			{stem:ev['alignedSections'] for stem,ev in candidate['stemPhaseAgreement'].items()})
	print('REPORT',out,'SHA256',hashlib.sha256(out.read_bytes()).hexdigest())


if __name__=='__main__':
	main()
