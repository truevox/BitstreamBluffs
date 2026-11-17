#!/usr/bin/env python3
"""V8 independent controlled stock/current/aligned/retriggered A/B renders.

One fixed 48 kHz backing, one shared mastering gain, and a deterministic
per-source-note synth key across all styles. A/B comparisons are additive,
private, source-preserving, and NOT a verified musical transcription.
"""
import argparse
import json
import math
import shutil
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

import render_reattack_comparisons_v1 as old

RATE=old.RATE
SYNTH_RATE=old.SYNTH_RATE
FRAMES=old.FRAMES
SYNTH_FRAMES=old.SYNTH_FRAMES
SONGS=old.SONGS
BIOMES=old.BIOMES
STYLES=('stock','new','aligned','reattacks')

def note_id(note):
	index=note.get('sourceIndex')
	if index is None:
		raise ValueError('Every note must carry stable original sourceIndex')
	if note.get('expression',{}).get('recoveredAttackSource'):
		return ('recovered',int(index),round(float(note['start']),4))
	return ('source',int(index))

def annotated(events):
	return [dict(event,sourceIndex=i) for i,event in enumerate(events)]

def stable_render_featured(events,biome,revision='rhythm'):
	"""Unchanged source notes have identical panning/timbre across variants.

	All RNG is keyed to immutable original note identity, not loop index.
	Extra note events cannot affect other notes' RNG streams. The 1.45 s
	crystal-bell allowance is selected from ORIGINAL note events only.
	"""
	_,_,mode,_,_=old.CHARACTERS[biome]
	out=np.zeros((SYNTH_FRAMES,2),dtype='float32')
	count=0
	last_bong=-2.
	for note in events:
		if float(note.get('confidence',1))<.32:
			continue
		midi=int(note['midi'])
		if not 37<=midi<=98:
			continue
		start=float(note['start'])
		end=float(note['end'])
		if not 0<=start<old.SECONDS or end-start<.085:
			continue
		attack=round(start*SYNTH_RATE)
		if attack>=SYNTH_FRAMES:
			continue
		identity=note_id(note)
		rng=np.random.default_rng(old.stable_seed('fixed-note-v8',biome,*identity))
		velocity=int(note.get('expression',{}).get('estimatedVelocity',85))
		voice=old.corrected_note(midi,max(.09,end-start),
			velocity,mode,rng,revision)
		n=min(len(voice),SYNTH_FRAMES-attack)
		pan_fraction=old.stable_seed('fixed-pan-v8',biome,*identity)/0xffffffff
		pan=.19+.62*pan_fraction
		out[attack:attack+n,0]+=voice[:n]*math.cos(pan*math.pi/2)
		out[attack:attack+n,1]+=voice[:n]*math.sin(pan*math.pi/2)
		count+=1
		# An inserted re-attack does not steal the sparse Crystal bong
		# from an already-scored note.
		is_new=bool(note.get('expression',{}).get('recoveredAttackSource'))
		if revision in ('orchestral','rhythm') and mode=='holopad' and midi<=79 and not is_new:
			if start-last_bong>=1.45:
				bong=old.crystal_bong(midi,velocity,rng)
				size=min(len(bong),SYNTH_FRAMES-attack)
				out[attack:attack+size,0]+=bong[:size]*.39
				out[attack:attack+size,1]+=bong[:size]*.48
				last_bong=start
	# Effects retain the deterministic rendered-note layout. Notes changed
	# intentionally affect the reverb tail of their own added/different audio.
	if mode in ('holopad','hydroglass','windharp','telemetry'):
		d=int(.18*SYNTH_RATE)
		out[d:,0]+=.18*out[:-d,1].copy()
		out[d:,1]+=.14*out[:-d,0].copy()
	elif mode in ('scrap','clockwork','bowedsteel'):
		d=int(.09*SYNTH_RATE)
		out[d:,1]+=.13*out[:-d,0].copy()
	return resample_poly(out,2,1,axis=0).astype('float32'),count

def prepare_scores(song,conf,a):
	doc=json.loads((a.expression/(conf['notes']+'.json')).read_text())
	base=annotated(doc['events'])
	aligned_doc=json.loads((a.aligned_events/(conf['notes']+'-aligned.json')).read_text())
	assert aligned_doc['sourceNoteCount']==len(base)
	assert aligned_doc['excerptStartSeconds']==conf['start']
	aligned=annotated(aligned_doc['events'])
	for b,c in zip(base,aligned):
		assert b['midi']==c['midi']
		assert b['sourceIndex']==c['sourceIndex']
		assert abs((b['end']-b['start'])-(c['end']-c['start']))<.0003
	recovered=base
	if song=='pope':
		reattacks_doc=json.loads(a.reattack_events.read_text())
		assert reattacks_doc['excerptStartSeconds']==conf['start']
		recovered=reattacks_doc['events']
		assert len(recovered)>=len(base)
		assert all(0<=int(e['sourceIndex'])<len(base) for e in recovered)
		assert all(e['midi']==base[int(e['sourceIndex'])]['midi'] for e in recovered)
	return {'new':base,'aligned':aligned,'reattacks':recovered}

def master_gain(reference,mixes,target=.145,peak_ceiling=.74):
	"""ONE scalar for the whole style family, not a limiter per mix."""
	ref_rms=old.rms(reference)
	if ref_rms<.001:
		raise ValueError('Baseline mix is silent')
	max_peak=max(float(np.max(np.abs(mix))) for mix in mixes.values())
	return min(2.5,target/ref_rms,peak_ceiling/max_peak)

def build_biome(original,folder,biome,song,scores,bass_doc,drum_events,a):
	"""Produces all style/terrain mixes from numerically shared backing."""
	featured=SONGS[song]['featured']
	unchanged=[name for name in ('guitar','piano','other') if name!=featured]
	source_feature=original[featured]
	sampled=old.read_audio(folder/'featured-sampled'/(biome+'.ogg'))
	_,base_count=0,0
	voices={}
	counts={}
	for style in ('new','aligned','reattacks'):
		voice,count=stable_render_featured(scores[style],biome)
		voices[style]=voice
		counts[style]=count
	# All synth versions share EXACTLY the baseline instrument amplification.
	target=max(.048,min(.070,old.rms(source_feature)*1.75))
	voice_gain=min(4.,target/max(old.rms(voices['new']),1e-9))*1.22
	scaffold=(source_feature*.07+old.loudness_match(sampled,target)*.07).astype('float32')
	features={'stock':source_feature.copy()}
	for style in ('new','aligned','reattacks'):
		features[style]=(scaffold+voices[style]*voice_gain).astype('float32')
	fixed=(original[unchanged[0]]+original[unchanged[1]]).astype('float32')
	melody_file=(folder/'melody-candy-v3/candy-cane-canyon.ogg'
		if biome=='candy-cane-canyon' else folder/'melody'/(biome+'.ogg'))
	melody=old.read_audio(melody_file)
	bass_sample=old.read_audio(folder/'bass'/(biome+'.ogg'))
	bass_overlay=old.render_bass_notes(bass_doc['notes'],biome)
	bass=original['bass']*.06+bass_sample*.65
	if old.rms(bass_overlay)>.0001:
		bass+=old.loudness_match(bass_overlay,
			max(.02,old.rms(original['bass'])*.81))*.50
	lead=old.loudness_match(melody,
		max(.066,min(.092,old.rms(original['vocals'])*.73)),limit=1.7)
	# Additive common non-feature stems are IDENTICAL for ALL four mixes.
	common_bed=(fixed+bass+lead).astype('float32')
	drum_sample=old.read_audio(a.drums_v3_root/song/(biome+'.ogg'))
	foley,foley_hits=old.render_foley(original['drums'],biome,drum_events)
	airdrums=old.loudness_match(drum_sample,
		max(.073,min(.133,old.rms(original['drums'])*.81)),limit=4.3)
	airdrums*=.66
	airdrums+=old.loudness_match(foley,max(.023,old.rms(original['drums'])*.32))*.94
	backings={
		'ground':(common_bed+original['drums']*.91).astype('float32'),
		'air':(common_bed+airdrums).astype('float32')}
	result={}
	qa={}
	for terrain,backing in backings.items():
		raws={style:(backing+feature).astype('float32')
			for style,feature in features.items()}
		gain=master_gain(raws['new'],raws)
		# Common backing is *exactly* one array. Pure additive comparison.
		# The differences between raw mixes are exactly feature deltas
		# modulo float32 roundoff, never a transformed shared stem.
		for style in STYLES:
			expected=features[style]-features['new']
			actual=raws[style]-raws['new']
			maxerr=float(np.max(np.abs(actual-expected)))
			if maxerr>1e-5:
				raise AssertionError((song,biome,terrain,style,'backing_drift',maxerr))
			result[(style,terrain)]=(raws[style]*gain).astype('float32')
		qa[terrain]={
			'commonGain':round(float(gain),9),
			'commonBackingSha256':__import__('hashlib').sha256(backing.tobytes()).hexdigest(),
			'maxRawBackingDifference':round(max(float(np.max(np.abs(
				raws[s]-raws['new']-(features[s]-features['new'])))) for s in STYLES),10),
			'preMasteringReferenceRms':round(old.rms(raws['new']),7),
			'preMasteringPeaks':{s:round(float(np.max(np.abs(raws[s]))),6) for s in STYLES},
		}
	return result,qa,counts,foley_hits

def run(a):
	assert not a.out.exists(),f'Refusing to overwrite: {a.out}'
	a.out.mkdir(parents=True)
	catalog={'format':'bitstream-orchestra-auditions-v1',
		'created':'2026-11-17',
		'status':'private CONTROLLED score A/B, unverified source-note hypotheses; fixed backing, common gain, stable note identities',
		'frames':FRAMES,'sampleRate':RATE,'seconds':old.SECONDS,'revision':'controlled-v1',
		'styles':list(STYLES),'biomes':[
			{'id':b,'label':b.replace('-',' ').title(),
				'orchestra':old.CHARACTERS[b][0],
				'description':old.CHARACTERS[b][1],
				'featuredInstrument':old.CHARACTERS[b][2],
				'foleyFamily':old.CHARACTERS[b][3],
				'bassCharacter':old.CHARACTERS[b][4]} for b in BIOMES],
		'songs':[]}
	global_qa={}
	for song,conf in SONGS.items():
		folder=a.input/song
		original={name:old.read_audio(folder/'original'/(name+'.ogg')) for name in (
			'vocals','drums','bass','guitar','piano','other')}
		scores=prepare_scores(song,conf,a)
		bass_doc=json.loads((a.bass_note_root/(song+'-bass-extracted-notes-v1.json')).read_text())
		drum_events=json.loads((a.drum_events_root/(song+'-drums-v3.json')).read_text())['events']
		styles_song={s:{} for s in STYLES}
		# Source references remain byte-identical to previous V3 research.
		for style in STYLES:
			dest=a.out/('controlled-'+style)/song
			dest.mkdir(parents=True)
			for name in ('vocals.ogg','original-instrumental.ogg'):
				src=a.old_reference/song/name
				shutil.copyfile(src,dest/name)
		song_qa={}
		for biome in BIOMES:
			sounds,qa,counts,foley_hits=build_biome(
				original,folder,biome,song,scores,bass_doc,drum_events,a)
			variant={}
			for style in STYLES:
				row={'ground':biome+'-ground.ogg','air':biome+'-air.ogg',
					'featureNotes':(0 if style=='stock' else counts[style]),
					'foleyEvents':foley_hits,
					'featuredVoice':old.CHARACTERS[biome][2],
					'revision':'controlled-v1','accompanimentStyle':style,
					'originalAccompanimentPreserved':[
						name for name in ('guitar','piano','other') if name!=conf['featured']]}
				for terrain in ('ground','air'):
					audio=sounds[(style,terrain)]
					assert np.all(np.isfinite(audio))
					assert float(np.max(np.abs(audio)))<.745
					path=a.out/('controlled-'+style)/song/(biome+'-'+terrain+'.ogg')
					if style=='reattacks' and song!='pope':
						# The One More Run retrigger option has not been audited.
						# Preserve identical source bytes for that intentionally disabled mode.
						previous=a.out/'controlled-new'/song/(biome+'-'+terrain+'.ogg')
						shutil.copyfile(previous,path)
						row[terrain+'Stats']=styles_song['new'][biome][terrain+'Stats']
					else:
						row[terrain+'Stats']=old.write_ogg(path,audio)
				styles_song[style][biome]=row
			song_qa[biome]={
				'ground':qa['ground'],'air':qa['air'],
				'renderedNoteCounts':counts,'foleyEvents':foley_hits}
			print('CONTROLLED_BIOME',song,biome,
				'gainAir',qa['air']['commonGain'],
				'counts',counts,flush=True)
		for style in STYLES:
			song_row={'id':song,'title':conf['title'],'featured':conf['featured'],
				'unselectedPreserved':[name for name in ('guitar','piano','other')
					if name!=conf['featured']],
				'excerptStartSeconds':conf['start'],
				'originalReference':'original-instrumental.ogg',
				'vocals':'vocals.ogg','variants':styles_song[style]}
			# Catalog lives centrally, but snapshots in style folders make
			# independent V8 audio QA possible with existing validation.
			row_doc=dict(catalog)
			row_doc['songs']=[song_row] if song=='pope' else []
			# Defer standalone catalog writing until both songs complete.
		global_qa[song]=song_qa
		catalog['songs'].append({
			'id':song,'featured':conf['featured'],
			'styles':list(STYLES),
			'baseNoteCount':len(scores['new']),
			'retriggerNoteCount':len(scores['reattacks']),
			'alignedNoteCount':len(scores['aligned'])})
	(a.out/'qa-common-backing.json').write_text(json.dumps({
		'status':'unapproved controlled comparison, source hypotheses',
		'gainPolicy':'one scalar per song/biome/terrain shared by 4 choices',
		'fixedBacking':'original unselected trio, shared melody, bass, chosen V3 drums and foley',
		'voicePolicy':'per-note stable original index, never RNG/index-of-new-score',
		'outputCounts':len(list(a.out.rglob('*.ogg'))),
		'bySong':global_qa},indent=2)+'\n')
	(a.out/'catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
	print('CONTROLLED_A_B_COMPLETE',len(list(a.out.rglob('*.ogg'))),
		'clips',a.out,flush=True)

if __name__=='__main__':
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--input',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True)
	p.add_argument('--old-reference',type=Path,required=True)
	p.add_argument('--expression',type=Path,required=True)
	p.add_argument('--aligned-events',type=Path,required=True)
	p.add_argument('--reattack-events',type=Path,required=True)
	p.add_argument('--bass-note-root',type=Path,required=True)
	p.add_argument('--drums-v3-root',type=Path,required=True)
	p.add_argument('--drum-events-root',type=Path,required=True)
	run(p.parse_args())
