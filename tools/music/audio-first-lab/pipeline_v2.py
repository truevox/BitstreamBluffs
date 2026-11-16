#!/usr/bin/env python3
"""Versioned additive 33-song research pipeline: plan, optional note/drum runs.
NO game-engine work, NO owner approval inferred, NO full-song mixing/release.
Private source paths and generated notes must remain outside public Git.
"""
import argparse
import datetime
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROLES=('vocals','drums','bass','guitar','piano','other')
SCRIPT_DIR=Path(__file__).resolve().parent
EXCERPTS={1:150.0,3:4.5,33:92.0}

def digest(value):
	return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()

def slotset(value):
	if value=='all':
		return None
	return {int(x) for x in value.split(',')}

def paths(root,record):
	slot=int(record['slot'])
	folder=(root/'stems'/'grouped_6s'/'33_one_more_run') if slot==33 else (
		root/'stems'/'htdemucs_6s'/f"{slot:02}_{record['id']}")
	return {role:folder/(role+'.flac') for role in ROLES}

def ranking(root):
	file=root/'guitar-showcase-ranking-20261116.json'
	if not file.is_file():
		return {}
	return {int(r['slot']):r for r in json.loads(file.read_text())}

def code_digest():
	return {name:hashlib.sha256((SCRIPT_DIR/name).read_bytes()).hexdigest()
		for name in ('transcribe_polyphonic_v2.py','transcribe_drums_v2.py')}

def plan(root,slots=None):
	records=json.loads((root/'roster.json').read_text())['tracks']
	ranks=ranking(root)
	scripts=code_digest()
	result=[]
	for record in records:
		slot=int(record['slot'])
		if slots is not None and slot not in slots:
			continue
		source=paths(root,record)
		inventory={}
		for role,path in source.items():
			if not path.is_file():
				raise FileNotFoundError(path)
			stat=path.stat()
			inventory[role]={'path':str(path),'sizeBytes':stat.st_size,
				'mtimeNs':stat.st_mtime_ns}
		winner=ranks.get(slot,{}).get('winner','piano' if slot==33 else 'other')
		if winner not in ('guitar','piano','other'):
			raise ValueError('Unknown instrument winner: '+str(winner))
		start=EXCERPTS.get(slot)
		if start is None:
			start=float(ranks.get(slot,{}).get(winner,{}).get('best32',[0,0])[1])
		identity=digest({'slot':slot,'instrument':winner,'start':start,
			'files':inventory,'scripts':scripts})[:16]
		folder=f'{slot:02d}-{identity}'
		tasks=[
			{'id':f'{slot:02d}:drum_events','stage':'drums-v2','input':'drums',
			'output':folder+'/drums-v2.json','dependsOn':[],'status':'ready'},
			{'id':f'{slot:02d}:featured_notes','stage':'basic-pitch-v2','input':winner,
			'output':folder+'/'+winner+'-notes-v2.json',
			'dependsOn':[],'status':'ready'},
			{'id':f'{slot:02d}:candidate_render','stage':'render-biome-audio',
			'dependsOn':[f'{slot:02d}:drum_events',f'{slot:02d}:featured_notes'],
			'status':'blocked_owner_audio_approval',
			'notes':'Renderers only after source-vs-v2 evidence review. Old clips never replaced.'},
			{'id':f'{slot:02d}:game_mix','stage':'release-integration',
			'dependsOn':[f'{slot:02d}:candidate_render'],
			'status':'blocked_owner_audio_approval',
			'notes':'Do not touch existing game/BSOD until approved.'}
		]
		result.append({'slot':slot,'title':record['title'],'id':record.get('id'),
			'sourceType':'grouped_11_to_6' if slot==33 else 'demucs_6s',
			'featured':winner,'excerptStart':start,'excerptSeconds':32,
			'identity':identity,'sourceInventory':inventory,'tasks':tasks})
	return {'schemaVersion':2,'mode':'non-destructive-audio-research',
		'archive':str(root),'toolHash':scripts,'songs':result,
		'limitations':['Existing original stems are read-only.',
			'Automation only generates research event JSON; no release audio.',
			'Source-derived pitch/onset scores are proxies, not ground truth.',
			'Sample choices and game integration are owner-gated.']}

def write_json_atomic(path,doc):
	if path.exists():
		raise FileExistsError('Refusing to overwrite: '+str(path))
	tmp=path.with_name('.'+path.name+'.partial')
	if tmp.exists():
		raise FileExistsError('Previous incomplete partial: '+str(tmp))
	tmp.write_text(json.dumps(doc,indent=2)+'\n')
	tmp.rename(path)

def run(plan_doc,out,resume):
	python=sys.executable
	for song in plan_doc['songs']:
		sources=song['sourceInventory']
		slot=int(song['slot'])
		for task in song['tasks']:
			if task['status']!='ready':
				continue
			file=out/task['output']
			file.parent.mkdir(parents=True,exist_ok=True)
			if file.exists():
				if resume:
					meta=json.loads(file.read_text())
					assert meta.get('events') is not None,('bad cached result',file)
					print('CACHE_HIT',task['id'],file,flush=True)
					continue
				raise FileExistsError('Refusing overwrite: '+str(file))
			role=task['input']
			start=str(song['excerptStart'])
			if task['stage']=='drums-v2':
				command=[python,str(SCRIPT_DIR/'transcribe_drums_v2.py'),
					'--source',sources['drums']['path'],'--start',start,'--out',str(file)]
			elif task['stage']=='basic-pitch-v2':
				command=[python,str(SCRIPT_DIR/'transcribe_polyphonic_v2.py'),
					sources[role]['path'],str(file),'--role',role,'--start',start]
			else:
				raise ValueError(task['stage'])
			print('RUN',task['id'],'source',sources[role]['path'],flush=True)
			subprocess.run(command,check=True)
			assert file.exists() and file.stat().st_size>80,('empty output',file)
	print('RESEARCH_TASKS_DONE',len(plan_doc['songs']),flush=True)

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--root',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True,help='New private job directory')
	p.add_argument('--slots',default='all',help='Comma-delimited slot numbers, or all')
	p.add_argument('--execute',action='store_true',help='Only note and drum event tasks')
	p.add_argument('--resume',action='store_true',help='Resume exact matching plan; never rewrite files')
	a=p.parse_args()
	if not (a.root/'roster.json').is_file():
		raise SystemExit('Missing 33-track roster')
	doc=plan(a.root,slotset(a.slots))
	if not doc['songs']:
		raise SystemExit('No matching slots')
	doc['planHash']=digest(doc)
	manifest=a.out/'pipeline-plan.json'
	if a.out.exists():
		if not a.resume:
			raise SystemExit('Refuse existing workspace: '+str(a.out))
		previous=json.loads(manifest.read_text())
		if previous.get('planHash')!=doc['planHash']:
			raise SystemExit('Source/scripts changed; create NEW versioned output workspace')
	else:
		a.out.mkdir(parents=True,exist_ok=False)
		write_json_atomic(manifest,doc)
	print('PLAN',manifest,'songs',len(doc['songs']),
		'ready_tasks',2*len(doc['songs']),
		'approval_blocked',2*len(doc['songs']),'hash',doc['planHash'][:16],
		flush=True)
	if a.execute:
		run(doc,a.out,a.resume)

if __name__=='__main__':
	main()
