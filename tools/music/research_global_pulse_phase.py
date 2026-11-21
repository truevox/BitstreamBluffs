#!/usr/bin/env python3
"""Whole-source phase coherence of OGG spectral flux, distinct from local ACF.

An oscillator locked to a repeated rhythmic source event is not proof of the
actual tempo, musical quarter note or meter. Do not release these hypotheses.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np

from research_variable_tempo import validate_source_manifest
from research_spectral_rhythm import (
	SOURCE_RATE, TICK, ROLES, expected_original_hashes, source_spectral_envelopes
)

FORMAT='bitstream-source-global-pulse-coherence-UNVERIFIED-v1'
STATUS='NO_VERIFIED_MUSICAL_BEATS_OR_TEMPO_DRIFT'
BPM_VALUES=np.arange(155.,173.001,.05)


def phase_vector(env:np.ndarray,bpm:float,start_tick=0):
	"""Normalized source onset Fourier phasor and relative period coherence."""
	x=np.asarray(env,dtype=float)
	if not len(x) or not np.isfinite(x).all() or (x<0).any():
		raise ValueError('Finite nonnegative source onsets required')
	weight=np.maximum(0,x-np.percentile(x,25))
	if weight.sum()<max(1,len(x)*.015):
		return complex(0)
	t=(np.arange(len(weight))+start_tick)*TICK
	return complex(np.dot(weight,np.exp(-2j*np.pi*(bpm/60.)*t))/weight.sum())


def scan(env:np.ndarray,start_tick=0,bpms=BPM_VALUES):
	rows=[]
	for bpm in bpms:
		phasor=phase_vector(env,float(bpm),start_tick)
		rows.append({'bpm':round(float(bpm),4),
			'relativeCoherence':round(abs(phasor),6),
			'phaseRadians':round(float(np.angle(phasor)),6)})
	rows.sort(key=lambda r:-r['relativeCoherence'])
	if rows[0]['relativeCoherence']<.02:
		return {'candidateOnly':True,'status':'INSUFFICIENT_PHASE_EVIDENCE',
			'best':None,'rivalSeparatedCandidates':[]}
	selected=[]
	for row in rows:
		if all(abs(row['bpm']-r['bpm'])>=.5 for r in selected):
			selected.append(row)
		if len(selected)==5:break
	return {'candidateOnly':True,'status':('WEAK_CANDIDATES_UNVERIFIED' if
		rows[0]['relativeCoherence']<.10 else 'CANDIDATES_UNVERIFIED'),
		'best':rows[0],'rivalSeparatedCandidates':selected}


def compare_segments(env:np.ndarray,bpm:float,total_seconds:float):
	windows=[];reference=phase_vector(env,bpm)
	refangle=np.angle(reference)
	for start in range(0,int(total_seconds),12):
		end=min(float(start+24),total_seconds)
		if end-start<8:continue
		a=round(start/TICK);b=round(end/TICK)
		v=phase_vector(env[a:b],bpm,a)
		windows.append({'sourceStartSeconds':start,'sourceEndSeconds':round(end,4),
			'coherence':round(abs(v),5),
			'phaseOffsetRadiansToWholeSong':round(float(np.angle(v*np.exp(-1j*refangle))),5),
			'candidateOnly':True})
	return windows


def analyze(pack:Path,prior:Path,harmonic:Path):
	manifest,digest=validate_source_manifest(pack,prior)
	known,report_hashes=expected_original_hashes(prior,harmonic,digest)
	envelopes,stem_hashes=source_spectral_envelopes(pack,manifest,known)
	seconds=manifest['frameCount']/SOURCE_RATE
	regions=[(0,seconds/2),(seconds/2,seconds),(0,seconds)]
	roles={}
	for role in ROLES:
		x=envelopes[role]
		runs=[]
		for a,b in regions:
			t0=round(a/TICK);t1=min(len(x),round(b/TICK))
			runs.append(scan(x[t0:t1],t0))
		best=runs[2]['best']['bpm']
		roles[role]={'firstHalf':runs[0],'secondHalf':runs[1],'full':runs[2],
			'fullSongBestPhaseOffsetWindows':compare_segments(x,best,seconds),
			'firstVsSecondHalfBestBpmDifference':round(runs[1]['best']['bpm']-runs[0]['best']['bpm'],3)}
	# Select frequency from drums alone; evaluate the phase coherence at that
	# frequency on each remaining stem without refitting those stem frequencies.
	reference=roles['drums']['full']['best']['bpm']
	fixed_cross={r:{'relativeCoherenceAtDrumChosenBpm':round(abs(phase_vector(envelopes[r],reference)),6),
		'candidateOnly':True} for r in ROLES}
	return {'format':FORMAT,'status':STATUS,'originalSourceManifestSha256':digest,
		**report_hashes,'originalSourceStemSha256':stem_hashes,
		'frameCount':manifest['frameCount'],'sampleRate':SOURCE_RATE,
		'method':'Whole-song complex Fourier phasor scanning 155-173 BPM on original high-band onset spectral flux; first/second half phase checks, not a downbeat detector',
		'candidateSourcePulseReferenceBpm':reference,
		'roles':roles,'heldOutAtDrumSelectedBpm':fixed_cross,
		'limitations':['Onset periodicity phase is NOT musical beat-one, actual quarter note, local tempo or musical meter',
			'Full-song coherent pulse can arise from repeated drum-machine-like beat patterns, rather than constant underlying composition tempo',
			'Variable musical timing, phrasing, instrumentation offsets and source separation artifacts can reduce phasor magnitude',
			'Scan grid is oversampled relative to short-segment frequency resolution; do not interpret 0.05 BPM steps as measurement accuracy',
			'Five original separated stems come from the same mix, not independent recording sources',
			'Strong whole-song phasor alone cannot prove there is no drift or locate the bridge/downbeat',
			'No production timing, RELEASE_BEAT_GRIDS or gameplay usage may follow from algorithmic candidates']}


def main():
	p=argparse.ArgumentParser()
	p.add_argument('--source-pack',type=Path,required=True)
	p.add_argument('--prior-report',type=Path,required=True)
	p.add_argument('--harmonic-report',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	a=p.parse_args()
	if a.out.exists():raise SystemExit('Refusing overwrite')
	result=analyze(a.source_pack,a.prior_report,a.harmonic_report)
	a.out.parent.mkdir(parents=True,exist_ok=True)
	a.out.write_text(json.dumps(result,indent=2)+'\n')
	print('REPORT_SHA256',hashlib.sha256(a.out.read_bytes()).hexdigest(),flush=True)
	print('DRUM_SELECTED_RHYTHMIC_BPM',result['candidateSourcePulseReferenceBpm'],flush=True)
	for role,model in result['roles'].items():
		print('ROLE',role,'whole',model['full']['best'],'first',model['firstHalf']['best'],
			'second',model['secondHalf']['best'],flush=True)
	print('CROSS_STEM_COHE',result['heldOutAtDrumSelectedBpm'],flush=True)
if __name__=='__main__':main()
