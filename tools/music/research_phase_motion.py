#!/usr/bin/env python3
"""Music Friday UNVERIFIED phase-motion diagnostic for original OGG stems.

Explicitly distinguishes common-mode pulse drift from instrument-only accent
shift *as hypotheses*, not by claiming a verified musical quarter note.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from research_global_pulse_phase import phase_vector
from research_spectral_rhythm import (
	SOURCE_RATE, TICK, ROLES, expected_original_hashes, source_spectral_envelopes,
)
from research_variable_tempo import validate_source_manifest

FORMAT='bitstream-original-stems-phase-motion-UNVERIFIED-v1'
STATUS='RESEARCH_ONLY_PHASE_MOTION_NO_SOURCE_BEAT_APPROVAL'
WINDOW_SECONDS=18
HOP_SECONDS=6
DEFAULT_MIN_COHERENCE=.10


def wrapped_beats(a:float,b:float)->float:
	"""Shortest change in circular phase, in units of candidate rhythm cycles."""
	return float(np.angle(np.exp(1j*(b-a)))/(2*np.pi))


def phase_trace(signal:np.ndarray,reference_bpm:float,
	window_seconds=WINDOW_SECONDS,hop_seconds=HOP_SECONDS,
	min_coherence=DEFAULT_MIN_COHERENCE)->list[dict]:
	"""Return source-absolute phased onset windows without phase reset at cuts."""
	if not np.isfinite(reference_bpm) or reference_bpm<=0:
		raise ValueError('Finite positive reference BPM required')
	if not 0<min_coherence<1:
		raise ValueError('Coherence gate must be between 0 and 1')
	signal=np.asarray(signal,dtype=float)
	if not len(signal) or not np.isfinite(signal).all() or (signal<0).any():
		raise ValueError('Nonnegative finite source onset signal required')
	whole=len(signal)*TICK
	out=[]
	for start in range(0,int(whole),hop_seconds):
		end=min(start+window_seconds,whole)
		if end-start<10:continue
		a=round(start/TICK);b=min(len(signal),round(end/TICK))
		v=phase_vector(signal[a:b],reference_bpm,a)
		strength=abs(v)
		out.append({'startSeconds':start,'endSeconds':round(end,3),
			'centerSeconds':round((start+end)/2,3),
			'relativePhaseRadians':round(float(np.angle(v)),6),
			'relativePhaseBeats':round(float(np.angle(v)/(2*np.pi)),6),
			'coherence':round(float(strength),6),
			'passesCoherenceGate':bool(strength>=min_coherence),
			'candidateOnly':True})
	return out


def circular_steps(rows:list[dict]) -> list[dict]:
	"""Within-stem adjacent step evidence, no arbitrary unwrap across silence."""
	result=[]
	for a,b in zip(rows,rows[1:]):
		good=a['passesCoherenceGate'] and b['passesCoherenceGate']
		step=wrapped_beats(a['relativePhaseRadians'],b['relativePhaseRadians']) if good else None
		result.append({'fromCenterSeconds':a['centerSeconds'],
			'toCenterSeconds':b['centerSeconds'],
			'phaseStepCandidateBeats':round(step,5) if good else None,
			'coherentPair':good,
			'candidateOnly':True})
	return result


def cross_role_phase_motion(traces:dict[str,list[dict]], minimum_roles=3,
	step_tolerance_beats=.10)->list[dict]:
	"""Diagnose same-sign source *changes*; not a drift classifier.

	Each role has a potentially arbitrary phase offset. Compare phase *steps*,
	gated by source onset-periodicity strength, not raw absolute phase angles.
	"""
	if not traces or not 1<=minimum_roles<=len(traces):
		raise ValueError('At least minimum_roles source tracks required')
	steps={role:circular_steps(track) for role,track in traces.items()}
	n=len(next(iter(steps.values())))
	if any(len(row)!=n for row in steps.values()):
		raise ValueError('Source phase timelines must have equal windows')
	out=[]
	for idx in range(n):
		present={role:stream[idx]['phaseStepCandidateBeats'] for role,stream in steps.items()
			if stream[idx]['coherentPair'] and stream[idx]['phaseStepCandidateBeats'] is not None}
		values=np.array(list(present.values()),dtype=float)
		median=float(np.median(values)) if len(values) else None
		support=[role for role,v in present.items() if abs(v-median)<=step_tolerance_beats] if median is not None else []
		ambiguous= len(present)<minimum_roles or len(support)<minimum_roles
		moving=(not ambiguous and abs(median)>=.05)
		out.append({'fromCenterSeconds':next(iter(steps.values()))[idx]['fromCenterSeconds'],
			'toCenterSeconds':next(iter(steps.values()))[idx]['toCenterSeconds'],
			'coherentSourceRoleSteps':present,
			'medianCandidateChangeBeats':round(median,5) if median is not None else None,
			'rolesSupportingMedianChange':support,
			'candidateCommonChange':bool(moving),
			'gate':('INSUFFICIENT_MULTIROLE_EVIDENCE' if ambiguous else
				'MULTIROLE_PHASE_CHANGE_CANDIDATE_NOT_VERIFIED' if moving else
				'MULTIROLE_PHASE_STABLE_CANDIDATE_NOT_VERIFIED'),
			'candidateOnly':True})
	return out


def analyze(pack:Path,prior:Path,harmonic:Path,global_report:Path):
	manifest,manifest_sha=validate_source_manifest(pack,prior)
	expected,prior_hashes=expected_original_hashes(prior,harmonic,manifest_sha)
	global_bytes=global_report.read_bytes();previous=json.loads(global_bytes)
	if (previous.get('format')!='bitstream-source-global-pulse-coherence-UNVERIFIED-v1'
		or previous.get('status')!='NO_VERIFIED_MUSICAL_BEATS_OR_TEMPO_DRIFT'
		or previous.get('originalSourceManifestSha256')!=manifest_sha):
		raise ValueError('Global source frequency report hash/status mismatch')
	bpm=previous['candidateSourcePulseReferenceBpm']
	if not 150<=bpm<=180:raise ValueError('Implausible unapproved reference rhythm')
	envelopes,actual_hashes=source_spectral_envelopes(pack,manifest,expected)
	traces={role:phase_trace(envelopes[role],bpm) for role in ROLES}
	role_steps={role:circular_steps(trace) for role,trace in traces.items()}
	common=cross_role_phase_motion(traces,minimum_roles=3)
	priority=[]
	for row in common:
		if row['gate']=='INSUFFICIENT_MULTIROLE_EVIDENCE':
			priority.append({'sourceWindowCenterSeconds':row['toCenterSeconds'],
				'candidateReviewReason':'too few coherent or concordant independent-role changes',
				'candidateOnly':True})
		elif row['medianCandidateChangeBeats'] is not None and abs(row['medianCandidateChangeBeats'])>=.15:
			priority.append({'sourceWindowCenterSeconds':row['toCenterSeconds'],
				'candidateReviewReason':'concordant step may be drift, section change or synchronized rhythmic accent change',
				'candidateOnly':True})
	return {'format':FORMAT,'status':STATUS,'sourceId':manifest['id'],
		'sourceManifestSha256':manifest_sha,**prior_hashes,
		'globalRhythmReportSha256':hashlib.sha256(global_bytes).hexdigest(),
		'originalStemSha256':actual_hashes,
		'sourceFrameCount':manifest['frameCount'],'sampleRate':SOURCE_RATE,
		'rhythmicReferenceBpmHypothesis':bpm,
		'sourceTimeWindowSeconds':WINDOW_SECONDS,'sourceTimeHopSeconds':HOP_SECONDS,
		'minimumPerSourcePhaseCoherence':DEFAULT_MIN_COHERENCE,
		'perStemSourcePhase':traces,'perStemAdjacentSteps':role_steps,
		'crossStemCommonMotionCandidates':common,
		'highPriorityUncertainTransitions':priority,
		'limitations':['All source phase values are relative to an unverified 163.8-style rhythmic reference, not quarter-note or meter phase',
			'Circular phase is ambiguous modulo a rhythmic pulse; a strong half-pulse shifted source may be instrumentation, not tempo drift',
			'Correlated Demucs separation stems are not independent musical ground truth',
			'Only adjacent coherent-window steps are compared; gap windows intentionally prevent confident unwrapping through silence',
			'High common-mode phase motion can be caused by a section-wide synced rhythm or arrangement accent shift, not tempo drift',
			'Three-stem gates and 0.1-beat support threshold are descriptive exploration settings, not calibrated false-positive rates',
			'18s windows overlap every 6s and are correlated, not independent measurements',
			'No real musical beat-one, phrase/downbeat, meter or half-time bridge boundaries were validated by ear',
			'No source timing release/gameplay/RELEASE_BEAT_GRIDS changes authorized']}


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--source-pack',type=Path,required=True)
	p.add_argument('--prior-report',type=Path,required=True)
	p.add_argument('--harmonic-report',type=Path,required=True)
	p.add_argument('--global-report',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing overwrite of existing source evidence')
	result=analyze(a.source_pack,a.prior_report,a.harmonic_report,a.global_report)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('REPORT_SHA256',hashlib.sha256(a.out.read_bytes()).hexdigest())
	common=result['crossStemCommonMotionCandidates']
	print('ALL_TRANSITIONS',len(common),'coherent multi-role',sum(a['candidateCommonChange'] for a in common),
		'uncertain',len(result['highPriorityUncertainTransitions']))
	for a in common:
		print('WINDOW',a['fromCenterSeconds'],'to',a['toCenterSeconds'],
			'roles',len(a['coherentSourceRoleSteps']),'support',len(a['rolesSupportingMedianChange']),
			'medianStepBeats',a['medianCandidateChangeBeats'],'gate',a['gate'])
if __name__=='__main__':main()
