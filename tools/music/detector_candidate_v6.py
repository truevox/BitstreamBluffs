#!/usr/bin/env python3
"""V6 research-only: V5 family selection with attack band-dominance veto.

Thresholds fixed from synthetic development diagnostics BEFORE alternate
seed runs. Values are heuristic, NOT calibrated probabilities. Never playable.
"""
from audit_cross_band_v6 import (attack_bands,attack_features,
	source_predictions,FAMILIES)

# Candidate thresholds chosen only using 559103/71/337/1097 development.
# Low kick threshold preserves mixed low-frequency co-hit attacks.
MIN_FAMILY_SHARE={'kick':.10,'snare':.10,'hat':.10}


def cross_band_veto(wave, *, thresholds=None):
	limits=MIN_FAMILY_SHARE if thresholds is None else thresholds
	if set(limits)!=set(FAMILIES) or any(not 0<=v<=1 for v in limits.values()):
		raise ValueError('Invalid family-support thresholds')
	predicted=source_predictions(wave)
	if not predicted:
		return [],{'algorithm':'v6-cross-band-veto-unapproved',
			'input':0,'retained':0,'removed':{},'status':'synthetic-only'}
	bands=attack_bands(wave)
	kept=[]
	removed={kind:0 for kind in FAMILIES}
	for event in predicted:
		strength=attack_features(bands,event['t'])
		kind=event['type']
		total=sum(strength.values())
		fraction=strength[kind]/max(1e-10,total)
		if fraction < limits[kind]:
			removed[kind]+=1
		else:
			kept.append(event.copy())
	return kept,{'algorithm':'v6-cross-band-veto-unapproved',
		'input':len(predicted),'retained':len(kept),'removed':removed,
		'thresholds':dict(limits),'status':'synthetic-only',
		'confidenceCalibrated':False}
