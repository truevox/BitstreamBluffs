#!/usr/bin/env python3
"""Self-contained, source-bound SVG HTML evidence for Gym beat review.

Reads ORIGINAL source-wave PCM from stdin (FFmpeg mono f32le at 11025 Hz),
plus local drums/bass OGG stems READ ONLY, then plots original onset envelopes
and competing source-frame beat hypotheses. NEVER marks beats as verified.
The generated HTML is a visual research artifact with NO embedded audio.
"""
import argparse
import hashlib
import html
import json
import math
import sys
from pathlib import Path

import numpy as np

from research_gym_beat_candidates import TARGET_RATE, HOP, decode_stem, onset_envelope

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_STEP = HOP / TARGET_RATE
WIDTH = 1360
WAVE_LEFT = 115
WAVE_RIGHT = 1305
WAVE_WIDTH = WAVE_RIGHT - WAVE_LEFT
LANES = [('Full original WAV mix',102), ('Original drums stem',196), ('Original bass stem',290)]
TICKS = [('80-BPM-prior beat tracker',389,'slow','accent-slow'),
	('160-BPM-prior beat tracker',423,'fast','accent-fast'),
	('163.839-BPM WAV onset-comb phase',457,'fft','accent-fft')]
SOURCE_FORMAT = 'bitstream-gym-visual-unverified-review-v1'


def sha256(blob):
	return hashlib.sha256(blob).hexdigest()


def ensure(predicate, message):
	if not predicate:
		raise ValueError(message)


def json_from(path):
	return json.loads(Path(path).read_text())


def safe_text(value):
	return html.escape(str(value),quote=True)


def svg_path(samples, start_seconds, end_seconds, top_y, height=62,
		start_absolute_seconds=None, precision=1):
	"""Compact unfilled SVG line of a per-window onset-strength envelope."""
	if not len(samples):
		return ''
	base = start_seconds if start_absolute_seconds is None else start_absolute_seconds
	points=[]
	for i,strength in enumerate(samples):
		t=base + i*SAMPLE_STEP
		if t<start_seconds or t>end_seconds:
			continue
		x=WAVE_LEFT+(t-start_seconds)/(end_seconds-start_seconds)*WAVE_WIDTH
		y=top_y+height-height*float(max(0,min(1,strength)))
		points.append(f'{x:.1f},{y:.1f}')
	return ' '.join(points)


def ticks_for_window(values, start, end):
	return [float(v) for v in values if start<=float(v)<end]


def phased_ticks(bpm, phase, start, end):
	period=60/bpm
	if not (math.isfinite(phase) and math.isfinite(period) and period>0):
		return []
	i=max(0,math.ceil((start-phase-1e-9)/period))
	result=[]
	while phase+i*period<end:
		value=phase+i*period
		if value>=start:
			result.append(value)
		i+=1
	return result


def section_lane(svg_y, times, start, end, css_class):
	lines=[]
	for sec in times:
		x=WAVE_LEFT+(sec-start)/(end-start)*WAVE_WIDTH
		lines.append(f'<line class="{css_class}" x1="{x:.1f}" y1="{svg_y-5}" x2="{x:.1f}" y2="{svg_y+22}"/>')
	return ''.join(lines)


def make_segment_svg(segment, waveforms, mix_tempo_phase, fast, slow):
	start=segment['startSeconds']
	end=segment['endSeconds']
	svg=[f'<svg role="img" aria-label="Original mix, drum and bass onset amplitude with three unverified rhythmic hypotheses for {start:.0f} to {end:.0f} seconds" viewBox="0 0 {WIDTH} 505" xmlns="http://www.w3.org/2000/svg">']
	svg.append('<rect x="0" y="0" width="1360" height="505" fill="#111b2d" rx="10"/>')
	for second in range(math.ceil(start), math.floor(end)+1):
		x=WAVE_LEFT+(second-start)/(end-start)*WAVE_WIDTH
		svg.append(f'<line x1="{x:.1f}" y1="56" x2="{x:.1f}" y2="483" stroke="#3a465b" stroke-width="0.9"/>')
		if second%2==0:
			svg.append(f'<text x="{x:.1f}" y="40" text-anchor="middle" class="axis-label">{second}s</text>')
	for lane,(label,y) in zip(('mix','drums','bass'),LANES):
		series=waveforms[lane]
		points=svg_path(series,start,end,y,height=68,start_absolute_seconds=start)
		color={'mix':'#8deac8','drums':'#f4b46d','bass':'#81b7ff'}[lane]
		svg.append(f'<text x="10" y="{y+16}" class="lane-label">{safe_text(label)}</text>')
		svg.append(f'<rect x="{WAVE_LEFT}" y="{y+1}" width="{WAVE_WIDTH}" height="69" fill="#18243a" rx="4"/>')
		svg.append(f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="1.25"/>')
	for label,y,key,css in TICKS:
		if key=='slow':
			times=ticks_for_window(slow,start,end)
		elif key=='fast':
			times=ticks_for_window(fast,start,end)
		else:
			times=phased_ticks(mix_tempo_phase['bpm'],mix_tempo_phase['phase'],start,end)
		svg.append(f'<text x="9" y="{y+12}" class="tick-label">{safe_text(label)}</text>')
		svg.append(f'<rect x="{WAVE_LEFT}" y="{y-10}" width="{WAVE_WIDTH}" height="33" fill="#1b2b43"/>')
		svg.append(section_lane(y,times,start,end,css))
		svg.append(f'<text x="{WAVE_RIGHT-3}" y="{y+12}" text-anchor="end" class="count-label">{len(times)} unverified ticks</text>')
	svg.append('</svg>')
	return ''.join(svg)


def validate_sources(queue,manifest,original,multi,source_hash,manifest_hash):
	ensure(queue.get('status')=='UNVERIFIED_RESEARCH_ONLY_NO_SHIPPING_BEAT_GRIDS',
		'Input queue is not an unverified review queue')
	ensure(queue.get('trackId')==manifest['id']==original['source']['recordingId']==multi['source']['trackId'],
		'Track identity mismatch')
	ensure(queue.get('metadataSha256')==manifest_hash,
		'Pack manifest SHA has changed since research')
	ensure(queue.get('originalWavSha256')==source_hash==
		original['source']['originalWavSha256']==multi['source']['originalWavSha256'],
		'Original WAV SHA does not match upstream evidence')
	ensure(queue.get('originalFrameCount')==manifest['frameCount']==multi['source']['originalFrameCount'],
		'Pack original frame-count mismatch')
	ensure(queue.get('originalSampleRate')==manifest['sampleRate']==multi['source']['originalSampleRate'],
		'Source sample rate mismatch')
	ensure(queue.get('trackerPrior120Vs160')=='IDENTICAL',
		'Expected previously verified 120/160-prior candidate overlap changed')
	ensure(len(queue['allSections'])==len(manifest['segments']),
		'Queue and source manifest section count mismatch')
	ensure(all(q['approval'] is False for q in queue['allSections']),
		'Queue must have no approved beats')
	for i,(q,seg) in enumerate(zip(queue['allSections'],manifest['segments'])):
		ensure(q['segmentIndex']==i and q['originalSourceStartFrame']==seg['startFrame']
			and q['originalSourceEndFrame']==seg['startFrame']+seg['frames'],
			f'Wrong segment original source positions at {i}')
	return True


def create_html(queue,manifest,original,multi,source_hash,source_pcm,manifest_hash):
	validate_sources(queue,manifest,original,multi,source_hash,manifest_hash)
	ensure(len(source_pcm) and np.isfinite(source_pcm).all(),
		'Original WAV decoded PCM invalid')
	original_duration=manifest['frameCount']/manifest['sampleRate']
	ensure(abs(len(source_pcm)/TARGET_RATE-original_duration)<.2,
		'Original WAV decoded duration mismatch')
	runs={r['initialTempoBpm']:r for r in multi['trackerRuns']}
	ensure(set(runs)=={80.0,120.0,160.0},'Missing recorded tempo-prior experiments')
	fft=next((v for v in original['candidateComparisons']
		if abs(v['bpm']-163.839)<.10),None)
	ensure(fft is not None,'Expected source-mix Fourier phase baseline not present')
	phase={'bpm':fft['bpm'],'phase':fft['originalMixPhaseSeconds']}
	selected=queue['priorityReviewSections']
	ensure(len(selected)==8 and len(set(selected))==8,'Expected eight different review windows')
	css='''
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#081322;color:#dfe9f8}
body{max-width:1480px;margin:auto;padding:22px 28px 55px;line-height:1.55}
h1{font-size:1.8rem;margin-bottom:0.1em}h2{font-size:1.22rem;margin-top:1.6em}
p{max-width:1150px}.small{font-size:.88rem;color:#a9bcd6}
section{background:#132238;border:1px solid #324866;padding:14px 19px;margin:22px 0;border-radius:12px}
svg{width:100%;height:auto;display:block}.axis-label,.lane-label,.tick-label,.count-label{font-size:14px;fill:#e2eefa}
.lane-label{font-size:12.5px}.tick-label{font-size:12px}.count-label{font-size:12px;opacity:.84}
.accent-slow{stroke:#6de1f0;stroke-width:1.8}.accent-fast{stroke:#f9d575;stroke-width:1.5}
.accent-fft{stroke:#ff89b5;stroke-width:1.5;stroke-dasharray:2,4}
strong{color:#fff}.status{color:#ffd67d;font-weight:700}code{font-size:.86em;color:#b9e5e9}
.table{border-collapse:collapse}td,th{border-bottom:1px solid #314461;text-align:left;padding:6px 12px}
footer{font-size:.86rem;color:#9daecc;margin-top:30px}
</style>'''
	stem_urls={}
	panels=[]
	visual_digest=[]
	for index in selected:
		q=queue['allSections'][index]
		seg=manifest['segments'][index]
		start=q['startSeconds'];end=q['endSeconds']
		start_index=max(0,round(start*TARGET_RATE));end_index=min(len(source_pcm),round(end*TARGET_RATE))
		mix_wave=source_pcm[start_index:end_index].astype('float64')
		mix_env=onset_envelope(mix_wave)
		wv={'mix':mix_env}
		for stem in ('drums','bass'):
			stem_file=(ROOT/'public/music/packs/33_local-one-more-run-bitstream-bluffs'/seg['sources'][stem])
			ensure(stem_file.is_file(),f'Missing input stem: {stem}')
			stem_urls[f'{index}:{stem}']=sha256(stem_file.read_bytes())
			wave=decode_stem(stem_file,seconds=(end-start))
			wv[stem]=onset_envelope(wave)
		svg=make_segment_svg(q,wv,phase,
			runs[160]['proposedBeatsSeconds'],runs[80]['proposedBeatsSeconds'])
		flags=', '.join(q['flags'])
		align='machine onset phases roughly align' if q['crossStemMachineAligned'] else 'machine phase agreement absent/insufficient'
		panels.append(f'''<section id="window-{index}"><h2>Window {index+1}: {start:.2f}–{end:.2f} seconds</h2>
<p class="small">Original source-frame interval <code>{q['originalSourceStartFrame']}–{q['originalSourceEndFrame']}</code> at {manifest['sampleRate']} Hz. <span class="status">UNVERIFIED</span> — {safe_text(align)}; cross-stem delta {q['crossStemPhaseDifferenceMs']:+.2f} ms. Machine flags: {safe_text(flags)}.</p>
{svg}<p class="small">For reviewers: listen to the original recording from {start:.2f}s to {end:.2f}s; independently tap the regular musical pulse and decide whether the 81-vs-161 BPM rows show beats, half-time subdivisions or syncopation. Compare the third dotted source-onset comb for possible phase drift. Do not treat any tick row as verified.</p></section>''')
		visual_digest.append(dict(index=index,startSeconds=start,endSeconds=end,
			originalSourceStartFrame=q['originalSourceStartFrame'],
			originalSourceEndFrame=q['originalSourceEndFrame'],
			stemSha256={stem:stem_urls[f'{index}:{stem}'] for stem in ('drums','bass')},
			beatCountFast=sum(start<=x<end for x in runs[160]['proposedBeatsSeconds']),
			beatCountSlow=sum(start<=x<end for x in runs[80]['proposedBeatsSeconds']),
			crossStemAligned=q['crossStemMachineAligned'],approval=False))
	source_pcm_sha=sha256(source_pcm.astype('<f4').tobytes())
	ensure(source_pcm_sha==original['source']['decodedMonoF32leSha256']
		and source_pcm_sha==multi['source']['decodedPcmSha256'],
		'Actual streamed downsampled WAV differs from previous independent evidence')
	summary=dict(format=SOURCE_FORMAT,trackId=manifest['id'],
		status='UNVERIFIED_VISUAL_REVIEW_ONLY',originalWavSha256=source_hash,
		shippedManifestSha256=manifest_hash,
		decodedMonoF32leSha256=source_pcm_sha,
		decodedRate=TARGET_RATE,originalSampleRate=manifest['sampleRate'],
		originalFrameCount=manifest['frameCount'],
		windowCount=len(panels),
		windows=visual_digest,
		inputSourceProvenance=stem_urls,
		artifacts='SVG markup contains derived normalized onset-strength curves and distinct nonapproved beat priors; NO original audio copied or embedded',
		canAuthorizeGame=False)
	encoded_json=json.dumps(summary,sort_keys=True,ensure_ascii=True)
	css_block=css
	header=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Unverified One More Run — source-bound Gym beat review</title>{css_block}</head><body>
<header><h1>One More Run — Eight-Window Beat Audit</h1>
<p class="status">RESEARCH ONLY — NO VERIFIED MUSICAL QUARTER NOTES — NO GYM TIMING AUTHORITY</p>
<p>Compare the original recording's spectral-onset envelope with separate drums and bass stems and competing machine-proposed rhythmic ticks. The source half-time (≈81 BPM) and double-time (≈161 BPM) rows are distinct mathematical hypotheses, not approved beats. The third row is a <em>Fourier onset-comb phase extrapolation</em>, not an independently tapped musical beat.</p>
<p class="small">Original WAV SHA-256 <code>{source_hash}</code> · Packed music manifest SHA-256 <code>{manifest_hash}</code> · Original sample rate {manifest['sampleRate']} Hz · Original length {original_duration:.2f} s · Derived visualization uses read-only original PCM downsampled to {TARGET_RATE} Hz. Audio is not embedded. Reviewers need authorized access to the original WAV.</p>
<p class="small">All ticks are for research only. A higher onset or louder drum is <strong>not</strong> necessarily the regular pulse. Candidates may be half-time, double-time, syncopated or tempo drifting. Uncertain or unreviewed sections should remain silent about beat-timing advice.</p>
<p><strong>Workflow:</strong> two reviewers independently listen, identify the perceived regular quarter-note, mark complete source-frame-indexed pulses in the provided blank review template, and submit separate annotations. The offline consensus tool reports phase/count disagreements. It cannot grant release approval.</p>
</header>'''
	manifest_tag=f'<script type="application/json" id="unverified-source-provenance">{encoded_json}</script>'
	return (header+'\n'.join(panels)+manifest_tag+
		'<footer>Generated from source-bound original mix and two stem recordings. No network scripts or audio file writes. Every section is unverified until reviewed by independent people; this visualization is NOT a trusted beat grid.</footer></body></html>'),summary


def main():
	p=argparse.ArgumentParser()
	for name in ('manifest','queue','multiprior','original-mix','original-sha256','out'):
		p.add_argument('--'+name,required=True)
	args=p.parse_args()
	output=Path(args.out)
	ensure(not output.exists(),f'Refusing to overwrite evidence {output}')
	pack_path=Path(args.manifest)
	pack=json_from(pack_path)
	queue=json_from(args.queue)
	original=json_from(args.original_mix)
	multi=json_from(args.multiprior)
	stream=sys.stdin.buffer.read()
	ensure(len(stream)>0 and len(stream)%4==0,'Expected original WAV derived mono float32 on stdin')
	pcm=np.frombuffer(stream,dtype='<f4')
	result,meta=create_html(queue,pack,original,multi,args.original_sha256,
		pcm,sha256(pack_path.read_bytes()))
	output.parent.mkdir(parents=True,exist_ok=True)
	output.write_text(result)
	print('VISUAL_REVIEW_READY',meta['trackId'],'windows',meta['windowCount'],
		'frameCount',meta['originalFrameCount'],'source',meta['originalWavSha256'],
		'canAuthorizeGame',meta['canAuthorizeGame'])
	print('OUTPUT',str(output),'bytes',output.stat().st_size,'SHA256',sha256(output.read_bytes()))


if __name__=='__main__':
	main()
