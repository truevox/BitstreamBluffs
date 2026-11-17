#!/usr/bin/env python3
"""Canonical, versioned source-event score shared by game and offline rendering.

No detector is called from here. Scores contain the exact events the released
renderer consumed, now with integer 48kHz frames, uncalibrated detector
provenance, stable event identities and a fingerprint for correction layers.

An event ID is source-anchor based, not a random UUID. When a re-transcription
moves an onset, an old correction must report a conflict rather than silently
attaching to a different note. No private paths or raw source audio embedded.
"""
import copy
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

FORMAT='bitstream-performance-v1'
ROLES=('melody','bass','drums','guitar','piano','other')
STEMS=('vocals','bass','drums','guitar','piano','other')
RATE=48000
DETECTORS={
	'melody':'release-v1-vocal-YIN-median9-45ms-merge',
	'bass':'release-v1-bass-YIN-median5-pitch-change',
	'drums':'release-v1-broadband-flux-10ms-one-hit-class',
	'guitar':'release-v1-fft1024-onset10ms-no-harmonic-summation',
	'piano':'release-v1-fft1024-onset10ms-no-harmonic-summation',
	'other':'release-v1-fft1024-onset10ms-no-harmonic-summation',
}
MAX_EVENTS_PER_ROLE=150000

def sha256_file(path):
	digest=hashlib.sha256()
	with Path(path).open('rb') as f:
		for block in iter(lambda:f.read(1024*1024),b''):
			digest.update(block)
	return digest.hexdigest()

def verify_origin(record,song_id,frame_count,featured,stems):
	"""Hard-fail when an archive's audio differs from captured score inputs."""
	validate(record)
	if record['songId']!=song_id or record['frameCount']!=frame_count:
		raise ValueError('song or sample count mismatch for score')
	if record['featuredStem']!=featured:
		raise ValueError('featured role mismatch for score')
	if set(stems)!=set(STEMS):raise ValueError('incomplete source stems')
	for role,path in stems.items():
		if sha256_file(path)!=record['provenance']['sourceStemSha256'][role]:
			raise ValueError('original source hash changed: '+role)
	return record

def verify_melody_audit(record,path):
	"""Source-YIN audit JSON is a necessary seventh provenance input."""
	actual=sha256_file(path)
	expected=record.get('provenance',{}).get('evidence',{}).get('melodyAuditSha256')
	if expected!=actual:
		raise ValueError('source melody audit changed since score capture')
	return record

def canonical(data):
	return json.dumps(data,ensure_ascii=False,sort_keys=True,
		separators=(',',':'),allow_nan=False).encode('utf-8')

def content_hash(data):
	return hashlib.sha256(canonical(data)).hexdigest()

def stable_id(song_id,role,event,collision):
	anchor={k:event[k] for k in ('startFrame','endFrame','pitch','class')
		if k in event}
	return role[:2]+'-'+hashlib.sha256(canonical(
		[song_id,role,anchor,collision])).hexdigest()[:20]

def _seconds_to_frame(value,frames):
	if not isinstance(value,(float,int)) or isinstance(value,bool) or not math.isfinite(value):
		raise ValueError('nonfinite event time')
	frame=round(value*RATE)
	if frame<0:return 0
	return min(frame,frames)

def from_legacy(song_id,frame_count,featured,events_by_role,source_hashes,extra_provenance=None):
	"""Losslessly preserve legacy 4-decimal event times as integer samples.

	Return values reconstitute source times at 4 decimals and reproduce
	round(start * 48000); original release rendering seeds remain unchanged.
	Source hashes cover six isolated FLAC stems, without exposing paths.
	"""
	if featured not in ('guitar','piano','other'):
		raise ValueError('invalid featured role')
	if not isinstance(frame_count,int) or frame_count<1:
		raise ValueError('invalid song duration')
	if set(events_by_role)!=set(ROLES):raise ValueError('missing score roles')
	if set(source_hashes)!=set(STEMS):raise ValueError('missing source stems')
	layers={}
	for role in ROLES:
		collisions=Counter()
		events=[]
		for idx,event in enumerate(events_by_role[role]):
			if role=='drums':
				start=_seconds_to_frame(event['t'],frame_count)
				if start>=frame_count:continue
				kind=event['type']
				if kind not in ('kick','snare','hat','tom','cymbal'):
					raise ValueError('unrecognized percussion family')
				item={'startFrame':start,'class':kind,'renderOrdinal':idx,
					'velocity':event.get('velocity') if isinstance(event.get('velocity'),int) else None,
					'confidence':None}
			else:
				start=_seconds_to_frame(event['start'],frame_count)
				end=_seconds_to_frame(event['end'],frame_count)
				if start>=frame_count or end<=start:continue
				pitch=int(event['midi'])
				if not 0<=pitch<=127:raise ValueError('out-of-range pitch')
				item={'startFrame':start,'endFrame':end,'pitch':pitch,
					'class':'note','renderOrdinal':idx,
					'velocity':None,'confidence':None}
				expression=event.get('expression')
				if expression and isinstance(expression.get('estimatedVelocity'),int):
					item['reportedHeuristicVelocity']=expression['estimatedVelocity']
				if 'confidence' in event:
					item['reportedHeuristicConfidence']=event['confidence']
			key=canonical({k:v for k,v in item.items() if k not in (
				'renderOrdinal','velocity','confidence','reportedHeuristicVelocity',
				'reportedHeuristicConfidence')})
			ordinal=collisions[key]
			collisions[key]+=1
			item['id']=stable_id(song_id,role,item,ordinal)
			events.append(item)
		layers[role]=events
	record={
		'format':FORMAT,'songId':song_id,'sampleRate':RATE,
		'frameCount':frame_count,'featuredStem':featured,
		'quality':'provisional-unreviewed',
		'calibratedConfidence':False,
		'clock':{'status':'unannotated','beats':[],'sections':[]},
		'harmony':{'status':'unannotated','chords':[]},
		'texture':{'status':'source-only','sourceRoles':['other']},
		'provenance':{
			'encoderRevision':'release-v1-score-capture',
			'sourceStemSha256':dict(sorted(source_hashes.items())),
			'evidence':dict(sorted((extra_provenance or {}).items())),
			'detectors':dict(sorted(DETECTORS.items())),
			'notes':'The release FFT/YIN estimators are approximate, NOT calibrated. '
				'No guessed confidence is treated as a probability; '
				'original note times, durations, pitches and order preserved.',
		},
		'events':layers,
	}
	record['scoreHash']=content_hash(record)
	validate(record)
	return record

def validate(record):
	if not isinstance(record,dict):raise ValueError('score not object')
	if record.get('format')!=FORMAT:raise ValueError('incorrect score format')
	if record.get('sampleRate')!=RATE:raise ValueError('wrong source sample rate')
	if not isinstance(record.get('songId'),str) or not record['songId']:
		raise ValueError('missing song id')
	if not isinstance(record.get('frameCount'),int) or record['frameCount']<1:
		raise ValueError('wrong duration')
	if record.get('quality') not in ('provisional-unreviewed','human-correction-layer-applied'):
		raise ValueError('unexpected approval metadata')
	if record['quality']=='human-correction-layer-applied' and (
		not isinstance(record.get('derivedFromScoreHash'),str) or
		len(record['derivedFromScoreHash'])!=64):
		raise ValueError('missing correction source hash')
	if record.get('calibratedConfidence') is not False:
		raise ValueError('uncalibrated score falsely claimed confidence')
	if record.get('featuredStem') not in ('guitar','piano','other'):
		raise ValueError('featured role invalid')
	if not isinstance(record.get('events'),dict) or set(record['events'])!=set(ROLES):
		raise ValueError('missing event families')
	prov=record.get('provenance',{})
	hashes=prov.get('sourceStemSha256',{})
	if not isinstance(hashes,dict) or set(hashes)!=set(STEMS):
		raise ValueError('incomplete source provenance')
	if any(not isinstance(v,str) or len(v)!=64 or any(c not in '0123456789abcdef' for c in v)
		for v in hashes.values()):
		raise ValueError('bad original source stem fingerprint')
	evidence=prov.get('evidence',{})
	if not isinstance(evidence,dict):
		raise ValueError('bad provenance evidence')
	for key,value in evidence.items():
		if key.endswith('Sha256') and (
			not isinstance(value,str) or len(value)!=64 or
			any(c not in '0123456789abcdef' for c in value)):
			raise ValueError('bad provenance evidence hash')

	seen=set()
	for role,events in record['events'].items():
		if not isinstance(events,list) or len(events)>MAX_EVENTS_PER_ROLE:
			raise ValueError('implausible role event count')
		for item in events:
			if not isinstance(item,dict):raise ValueError('event not object')
			start=item.get('startFrame')
			if not isinstance(start,int) or isinstance(start,bool) or not 0<=start<record['frameCount']:
				raise ValueError('invalid event start')
			end=item.get('endFrame')
			if role=='drums':
				if end is not None or item.get('class') not in ('kick','snare','hat','tom','cymbal'):
					raise ValueError('invalid percussion hit')
			else:
				if not isinstance(end,int) or end<=start or end>record['frameCount']:
					raise ValueError('invalid note release')
				if item.get('class')!='note' or not isinstance(item.get('pitch'),int) or not 0<=item['pitch']<=127:
					raise ValueError('invalid melodic note')
			if not isinstance(item.get('id'),str) or item['id'] in seen:
				raise ValueError('missing/duplicate event identity')
			seen.add(item['id'])
			if item.get('confidence') is not None:
				raise ValueError('uncalibrated confidence must be null')
			if item.get('velocity') is not None and (
				not isinstance(item['velocity'],int) or not 1<=item['velocity']<=127):
				raise ValueError('invalid velocity')
	expected=content_hash({k:v for k,v in record.items() if k!='scoreHash'})
	if expected!=record.get('scoreHash'):
		raise ValueError('score fingerprint mismatch')
	return record

def to_legacy(record,role):
	"""Convert one immutable candidate layer to the exact historic renderer API.

	Keeping renderOrdinal stable is required: v1 features fixed index-dependent
	velocity/pan and pseudo-random note excitation. Do NOT sort/reorder.
	"""
	validate(record)
	if role not in ROLES:raise ValueError('invalid role')
	out=[]
	for item in record['events'][role]:
		if role=='drums':
			out.append({'t':round(item['startFrame']/RATE,4),
				'type':item['class']})
		else:
			n={'start':round(item['startFrame']/RATE,4),
				'end':round(item['endFrame']/RATE,4),'midi':item['pitch']}
			if item.get('reportedHeuristicConfidence') is not None:
				n['confidence']=item['reportedHeuristicConfidence']
			if item.get('reportedHeuristicVelocity') is not None:
				n['expression']={'estimatedVelocity':item['reportedHeuristicVelocity']}
			out.append(n)
	return out

def write_new(path,record):
	path=Path(path)
	validate(record)
	path.parent.mkdir(parents=True,exist_ok=True)
	# Exclusive create: never clobber a historical score or corrected layer.
	with path.open('x',encoding='utf-8') as f:
		json.dump(record,f,ensure_ascii=False,indent=2,allow_nan=False)
		f.write('\n')
	return path

def read(path):
	return validate(json.loads(Path(path).read_text(encoding='utf-8')))

def apply_patch_layer(record,layer):
	"""Never silently apply edits against changed automatic scores.

	Explicit revision conflicts are returned and never discarded. The editor
	and human-acceptance workflow can be built against this stable contract.
	"""
	validate(record)
	if layer.get('format')!='bitstream-performance-patches-v1':
		raise ValueError('patch format')
	if layer.get('songId')!=record['songId']:
		raise ValueError('patch song mismatch')
	if layer.get('baseScoreHash')!=record['scoreHash']:
		return None,[{'reason':'base-score-changed','wanted':layer.get('baseScoreHash'),
			'actual':record['scoreHash']}]
	clean=copy.deepcopy(record)
	by_id={event['id']:(role,event) for role,events in clean['events'].items() for event in events}
	conflicts=[]
	edited=set()
	for op in layer.get('operations',[]):
		eid=op.get('id')
		if eid in edited:
			conflicts.append({'id':eid,'reason':'double-edit'});continue
		if eid not in by_id:
			conflicts.append({'id':eid,'reason':'missing-event'});continue
		action=op.get('action')
		role,event=by_id[eid]
		if action not in ('accept','reject','retime','octave'):
			conflicts.append({'id':eid,'reason':'unsupported-operation'});continue
		if action=='retime':
			start,end=op.get('startFrame'),op.get('endFrame')
			if not isinstance(start,int) or start<0 or start>=record['frameCount'] or (
				role!='drums' and (not isinstance(end,int) or end<=start or end>record['frameCount'])):
				conflicts.append({'id':eid,'reason':'invalid-retiming'});continue
		if action=='octave' and (role=='drums' or op.get('offset') not in (-12,12)
			or not 0<=event['pitch']+op['offset']<=127):
			conflicts.append({'id':eid,'reason':'invalid-octave'});continue
		edited.add(eid)
		if action=='reject':
			clean['events'][role].remove(event)
		elif action=='accept':
			event['humanStatus']='accepted'
		elif action=='retime':
			event['startFrame']=start
			if role!='drums':event['endFrame']=end
			event['humanStatus']='corrected'
		elif action=='octave':
			event['pitch']+=op['offset']
			event['humanStatus']='corrected'
	if conflicts:return None,conflicts
	clean['quality']='human-correction-layer-applied'
	clean['derivedFromScoreHash']=record['scoreHash']
	# Preserve the source score; corrected scores are a new artifact.
	clean['scoreHash']=content_hash({k:v for k,v in clean.items() if k!='scoreHash'})
	validate(clean)
	return clean,[]
