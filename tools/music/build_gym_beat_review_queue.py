#!/usr/bin/env python3
"""Rank specific One More Run sections for human pulse/meter review.

Combines independent ORIGINAL WAV beat-track predictions with two stem-FFT
research reports. All annotations are RESEARCH_ONLY and never feed gameplay.
No audio output, no changes to source packs or verified BeatGridCatalog.
"""
import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path


ROOT=Path(__file__).resolve().parents[2]
TRACK_ID='local-one-more-run-bitstream-bluffs'


def read_json(path):
	return json.loads(Path(path).read_text())


def fraction_near_lattice(times, bpm, phase_seconds, tolerance=.060):
	if not times:
		return 0.0
	if not math.isfinite(bpm) or bpm<=0:
		raise ValueError('Invalid frequency')
	period=60/bpm
	hits=sum(1 for time in times if abs((time-phase_seconds+period/2)%period-period/2)<=tolerance)
	return hits/len(times)


def section_metrics(segment, faster_beats, slower_beats, cross, mix_phases, upper_frame_count, sample_rate):
	start=segment['startFrame']/sample_rate
	end=(segment['startFrame']+segment['frames'])/sample_rate
	fast=[t for t in faster_beats if start<=t<end]
	slow=[t for t in slower_beats if start<=t<end]
	intervals=[b-a for a,b in zip(fast,fast[1:])]
	median=statistics.median(intervals) if intervals else None
	local_bpm=60/median if median and median>0 else None
	phase_matches={str(bpm):round(fraction_near_lattice(fast,bpm,phase),4)
		for bpm,phase in mix_phases.items()}
	mid=(start+end)/2
	stem=cross['sections'][next((i for i,x in enumerate(cross['sections'])
		if abs(x['startSeconds']-start)<.1),0)]
	if abs(stem['startSeconds']-start)>.1:
		raise ValueError('Cross-stem segment boundaries unexpectedly different')
	flags=[]
	if stem['candidateForHumanSpotCheck']:
		flags.append('drum_bass_harmonic_phase_agree_research_only')
	elif stem['bothStemsHavePeriodicOnsetEnergy']:
		flags.append('drum_bass_strong_but_phase_disagree')
	else:
		flags.append('one_or_both_stems_weak')
	if local_bpm and (local_bpm<145 or local_bpm>180):
		flags.append('dynamic_tracker_local_tempo_deviates_from_strong_global_periodicity')
	if max(phase_matches.values(),default=0)<.30:
		flags.append('original_mix_fft_lattice_does_not_track_predicted_beat_phase')
	# This is a REVIEW PRIORITY, not musical validation confidence.
	importance=(3 if 'drum_bass_strong_but_phase_disagree' in flags else 0)+\
		(2 if stem['candidateForHumanSpotCheck'] else 0)+\
		(2 if max(phase_matches.values(),default=0)<.30 else 0)+\
		(1 if local_bpm and (local_bpm<145 or local_bpm>180) else 0)
	return dict(
		segmentIndex=segment['index'],startSeconds=round(start,6),
		endSeconds=round(end,6),originalSourceStartFrame=segment['startFrame'],
		originalSourceEndFrame=min(segment['startFrame']+segment['frames'],upper_frame_count),
		originalSourceSampleRate=sample_rate,
		machineReviewPriority=importance,
		flags=flags,
		fastTrackerCandidateCount=len(fast),slowTrackerCandidateCount=len(slow),
		localFastTrackerMedianBpm=round(local_bpm,3) if local_bpm else None,
		originalMixOnsetCombMatchFractions=phase_matches,
		crossStemPhaseDifferenceMs=stem['bassDrumHarmonicPhaseErrorMs'],
		crossStemBothStrong=stem['bothStemsHavePeriodicOnsetEnergy'],
		crossStemMachineAligned=stem['candidateForHumanSpotCheck'],
		suggestedHumanProbeSeconds=round(mid,4),
		candidateSourceFrames=[int(round(t*sample_rate)) for t in fast],
		decision='PENDING_ACCOUNTABLE_LISTENING_AND_METER_VERIFICATION',
		approval=False,
	)


def spread_review_sections(sections, count=4, expected_kind=True):
	"""Pick falsifiable examples across the whole song, not just the intro.

	The sort order and review priority are ONLY workload scheduling; they do
	not encode approved timing, subjective confidence, or phase correctness.
	"""
	pool=[s for s in sections if s['crossStemMachineAligned']==expected_kind]
	if not pool or count<=0:
		return []
	n_total=max(s['segmentIndex'] for s in sections)+1
	chosen=[]
	for quartile in range(4):
		options=[s for s in pool if int(s['segmentIndex']*4/n_total)==quartile]
		if not options:
			continue
		selection=max(options,key=lambda s:(s['machineReviewPriority'],
			-s['segmentIndex']))
		chosen.append(selection)
	if len(chosen)>count:
		return sorted(chosen,key=lambda s:(-s['machineReviewPriority'],s['segmentIndex']))[:count]
	remainder=sorted((s for s in pool if s not in chosen),
		key=lambda s:(-s['machineReviewPriority'],s['segmentIndex']))
	return chosen+remainder[:max(0,count-len(chosen))]


def build_queue(multiprior,cross_report,mix_report,manifest,manifest_sha256=None):
	meta=multiprior['source']
	track=next((x for x in cross_report['tracks'] if x['trackId']==meta['trackId']),None)
	if meta['trackId']!=TRACK_ID or not track:
		raise ValueError('Missing or mismatched song ID')
	if mix_report['source']['originalWavSha256']!=meta['originalWavSha256']:
		raise ValueError('Original WAV hash disagrees between independent reports')
	if (manifest['id']!=meta['trackId'] or manifest['frameCount']!=meta['originalFrameCount']
			or manifest['sampleRate']!=meta['originalSampleRate']):
		raise ValueError('Original WAV beat proposals differ from pack identity')
	if manifest_sha256 is None:
		raise ValueError('Actual manifest bytes SHA-256 must be supplied')
	if manifest_sha256!=track['manifestSha256']:
		raise ValueError('Cross-stem source pack manifest has changed')
	runs={x['initialTempoBpm']:x for x in multiprior['trackerRuns']}
	if set(runs)!={80.0,120.0,160.0}:
		raise ValueError('All three prior hypotheses required')
	if runs[120]['proposedBeatsSeconds']!=runs[160]['proposedBeatsSeconds']:
		# Disagreement is allowed but MUST be visible; no sampling assumed safe.
		agreement_120_160='DIVERGED'
	else:
		agreement_120_160='IDENTICAL'
	cross_section=track['doubleTimeCrossStemReview']
	if not cross_section or cross_section['ratio']!='2:1':
		raise ValueError('No source-bound 2:1 stem-phase audit exists')
	mix_phases={x['bpm']:x['originalMixPhaseSeconds']
		for x in mix_report['candidateComparisons']
		if x['bpm'] in (81.919,122.822,163.839)}
	if not mix_phases:
		raise ValueError('No original-mix onset phase hypothesis available')
	sections=[]
	for i,seg in enumerate(manifest['segments']):
		sections.append(section_metrics(dict(index=i,**seg),
			runs[160]['proposedBeatsSeconds'],runs[80]['proposedBeatsSeconds'],
			cross_section,mix_phases,manifest['frameCount'],manifest['sampleRate']))
	# Balanced review: select up to 4 strong 2:1 source-stem alignments,
	# then 4 opposing sections to falsify the hypothesis, not cherry-pick.
	positive=spread_review_sections(sections,count=4,expected_kind=True)
	negative=spread_review_sections(sections,count=4,expected_kind=False)
	chosen=sorted(positive+negative,key=lambda s:s['segmentIndex'])
	return dict(format='bitstream-gym-source-bound-human-beat-review-queue-v1',
		status='UNVERIFIED_RESEARCH_ONLY_NO_SHIPPING_BEAT_GRIDS',
		trackId=meta['trackId'],originalWavSha256=meta['originalWavSha256'],
		originalFrameCount=manifest['frameCount'],originalSampleRate=manifest['sampleRate'],
		metadataSha256=manifest_sha256,
		trackerPrior120Vs160=agreement_120_160,
		allSections=sections,
		priorityReviewSections=[s['segmentIndex'] for s in chosen],
		reviewPrompts=['For each selected ~12-second segment, independently tap the perceived regular quarter-note pulse',
			'Distinguish kick/snare/hi-hat syncopation or subdivisions from meter',
			'Decide whether bass 81.92 and drum 163.84 are half/double-time alternatives and document actual pulse',
			'If original full mix and stems disagree, mark segment uncertain rather than averaging phases',
			'Record source-frame-index pulse anchors and reviewer attribution; verify two distant positions for drift',
			'Unreviewed, low-confidence and tempo-changing sections MUST remain excluded from Gym'],
		warnings=['machineReviewPriority is NOT musical confidence',
			'Original-mix onset comb is a rhythmic feature, not a beat-grid ground truth',
			'Algorithm agreement does not substitute accountable listening',
			'Current production beat grid stays unverified; no Gym hold authorized'])


def main():
	p=argparse.ArgumentParser()
	for flag in ('multiprior','cross-stem','original-mix','manifest','out'):
		p.add_argument('--'+flag,required=True)
	args=p.parse_args()
	out=Path(args.out)
	if out.exists():
		raise SystemExit('Refusing to overwrite evidence: '+str(out))
	manifest=Path(args.manifest)
	report=build_queue(read_json(args.multiprior),read_json(args.cross_stem),
		read_json(args.original_mix),json.loads(manifest.read_text()),
		manifest_sha256=hashlib.sha256(manifest.read_bytes()).hexdigest())
	out.write_text(json.dumps(report,indent=2)+'\n')
	print('REVIEW_SECTIONS',report['priorityReviewSections'])
	for s in report['allSections']:
		print('SECTION',s['segmentIndex'],round(s['startSeconds'],2),
			'priority',s['machineReviewPriority'],
			'stemAligned',s['crossStemMachineAligned'],
			'localTrackerBpm',s['localFastTrackerMedianBpm'])
	print('REPORT',out,'SHA256',hashlib.sha256(out.read_bytes()).hexdigest())


if __name__=='__main__':
	main()
