#!/usr/bin/env python3
"""Research-only V3: anchor provisional drum-family co-hits to the original
broadband onset proposals. This is a test of disagreement/false-event
containment, NOT a gold-verified new drum renderer.

The released v1 detector is deliberately left unchanged. No output here is
eligible for game playback, and no calibrated confidence is supplied.
"""
from bisect import bisect_left

from detector_candidate_v2 import drum_simultaneous, RATE


def drum_anchor_fusion(y, *, candidate_echo_guard='none',
	join_window_ms=38, merge_same_class_ms=32, preserve_baseline=True):
	from render_full_dynamic_orchestra_v1 import choose_drum_events
	baseline, bdiag=choose_drum_events(y)
	candidates, cdiag=drum_simultaneous(y,echo_guard=candidate_echo_guard)
	if not baseline:
		return [], {'algorithm':'v3-release-anchored-cohit-probe',
			'status':'no-baseline-anchors-no-claims','candidateEvents':len(candidates)}
	tolerance=join_window_ms/1000
	redundancy=merge_same_class_ms/1000
	events=[]
	used=set()
	for original in baseline:
		origin=original['t']
		nearest={}
		for index,hit in enumerate(candidates):
			delta=abs(hit['t']-origin)
			if delta>tolerance:continue
			role=hit['type']
			if role not in nearest or delta<nearest[role][0]:
				nearest[role]=(delta,index,hit)
		# Deliberately test v1 fallback since independent V2 onset streams
		# can lose true low-amplitude re-strikes during echo filtering.
		if preserve_baseline:
			key=original['type']
			if key in nearest:
				distance,idx,hit=nearest.pop(key)
				events.append({'t':hit['t'],'type':key})
				used.add(idx)
			else:
				events.append({'t':origin,'type':key})
		for role,(distance,idx,hit) in nearest.items():
			if idx in used:continue
			events.append({'t':hit['t'],'type':role})
			used.add(idx)
	events.sort(key=lambda x:(x['t'],x['type']))
	# no double same-class hit when adjacent v1 anchors share a V2 event.
	merged=[]
	for item in events:
		if merged and any(
			e['type']==item['type'] and 0<=item['t']-e['t']<redundancy
			for e in merged[-5:]
		):
			continue
		merged.append(item)
	return merged, {'algorithm':'v3-release-anchored-cohit-probe',
		'baselineEvents':len(baseline),'candidateEvents':len(candidates),
		'outputEvents':len(merged),'experimentalEchoGuard':candidate_echo_guard,
		'confidenceCalibrated':False,'status':'synthetic-research-only'}
