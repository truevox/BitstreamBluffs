#!/usr/bin/env python3
"""Read-only QA audit of a 33-song / six-stem archive. No source alterations.
Reports metadata, timing drift, short-window sampled audio quality and exceptions.
A short-window diagnostic is NOT proof of full-song separation quality.
"""
import argparse
import concurrent.futures
import datetime
import json
import math
import subprocess
from pathlib import Path

ROLES=('vocals','drums','bass','guitar','piano','other')

def command(argv,timeout=60):
	return subprocess.run(argv,capture_output=True,check=True,timeout=timeout).stdout

def inspect(path,window=2.0):
	row={'path':str(path),'exists':path.is_file()}
	if not row['exists']:
		return row
	row['bytes']=path.stat().st_size
	try:
		probe=json.loads(command(['ffprobe','-v','error','-select_streams','a:0',
			'-show_entries','stream=sample_rate,channels,codec_name,duration:format=duration',
			'-of','json',str(path)],timeout=20))
		stream=probe['streams'][0]
		row.update({'codec':stream.get('codec_name'),'rate':int(stream['sample_rate']),
			'channels':int(stream['channels']),'duration':round(float(
				stream.get('duration') or probe['format']['duration']),3)})
		at=max(0,min(row['duration']-window,row['duration']*.37))
		pcm=command(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-ss',str(at),
			'-i',str(path),'-t',str(window),'-ac','1','-ar','8000',
			'-f','f32le','pipe:1'],timeout=40)
		import numpy as np
		audio=np.frombuffer(pcm,dtype='<f4')
		if not len(audio):
			row['error']='No samples decoded'
		else:
			rms=float(np.sqrt(np.mean(audio.astype('float64')**2)))
			peak=float(np.max(np.abs(audio)))
			row.update({'sampleAt':round(at,2),'sampleRmsDb':round(
				20*math.log10(max(rms,1e-10)),2),'samplePeak':round(peak,5),
				'sampleZeroFraction':round(float(np.mean(np.abs(audio)<1e-5)),4)})
	except Exception as exc:
		row['error']=str(exc)[:240]
	return row

def audit(root,workers):
	roster=json.loads((root/'roster.json').read_text())
	tasks=[]
	for item in roster['tracks']:
		slot=int(item['slot'])
		slug='33_one_more_run' if slot==33 else f"{slot:02}_{item['id']}"
		group='grouped_6s' if slot==33 else 'htdemucs_6s'
		folder=root/'stems'/group/slug
		for role in ROLES:
			tasks.append(((slot,role),folder/(role+'.flac')))
		if slot==33:
			for path in sorted((root/'stems/original_11s/33_one_more_run').glob('*.wav')):
				tasks.append(((slot,'raw:'+path.stem),path))
	with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
		pending={pool.submit(inspect,path):key for key,path in tasks}
		results={pending[fut]:fut.result() for fut in concurrent.futures.as_completed(pending)}
	rows=[]
	for item in roster['tracks']:
		slot=int(item['slot'])
		stems={role:results[(slot,role)] for role in ROLES}
		extra={name:val for (s,name),val in results.items() if s==slot and name.startswith('raw:')}
		warnings=[]
		if any(not v['exists'] for v in stems.values()):
			warnings.append('missing_six_stem_source')
		if any('error' in v for v in stems.values()):
			warnings.append('decode_or_probe_error')
		durations=[v['duration'] for v in stems.values() if 'duration' in v]
		drift=round(max(durations)-min(durations),4) if len(durations)==6 else None
		if drift is not None and drift>.10:
			warnings.append('duration_drift_over_100ms')
		rates={v.get('rate') for v in stems.values() if v.get('rate')}
		if len(rates)>1:
			warnings.append('different_stem_sample_rates')
		for role,v in stems.items():
			if v.get('sampleRmsDb',0)<-55:
				warnings.append(role+'_low_sample_activity')
			if v.get('samplePeak',0)>.999:
				warnings.append(role+'_sample_peak_near_fullscale')
		if slot==33:
			if len(extra)!=11:
				warnings.append('expected_11_raw_stems_got_'+str(len(extra)))
			if any('error' in v for v in extra.values()):
				warnings.append('raw_stem_probe_error')
		rows.append({'slot':slot,'id':item.get('id'),'title':item.get('title'),
			'sourceType':'grouped_11_to_6' if slot==33 else 'htdemucs_6s',
			'stems':stems,'rawSources':extra,'durationDriftSeconds':drift,
			'warnings':warnings})
	return {'schemaVersion':1,'generatedUtc':datetime.datetime.now(
		datetime.timezone.utc).isoformat(),'root':str(root),'songCount':len(rows),
		'expectedRoles':ROLES,'notes':[
		'This is a READ-ONLY technical audit, not a music-quality endorsement.',
		'RMS and peaks come from a short sample and do not describe the full song.',
		'Low sample activity does not prove a stem is missing or broken.',
		'Separation bleed and note accuracy require independent musical analysis.'],
		'songs':rows}

def markdown(report):
	lines=['# Bitstream Bluffs: source library audit','',
		f"Generated: {report['generatedUtc']}",'',
		f"Tracks: **{report['songCount']}**; canonical six roles per track. " +
		"Slot 33 additionally preserves eleven supplied raw WAV stems.",'',
		'| Slot | Track | Source | Duration drift | Findings |',
		'| --- | --- | --- | ---: | --- |']
	for row in report['songs']:
		warnings=', '.join(row['warnings']) or 'none'
		lines.append('| '+str(row['slot'])+' | '+str(row['title']).replace('|','/')+
			' | '+row['sourceType']+' | '+str(row['durationDriftSeconds'])+
			' s | '+warnings+' |')
	lines.extend(['','## Interpretation','',
		'Red flags in this report are automated screening observations, not diagnoses.',
		'Clean duration/rate checks do not establish correct notes or a clean stem separation.',
		'The linked JSON includes per-stem paths and sampled levels.',
		'No original source files were modified or re-rendered.'])
	return '\n'.join(lines)+'\n'

def main():
	p=argparse.ArgumentParser(description=__doc__)
	p.add_argument('--root',type=Path,required=True)
	p.add_argument('--out',type=Path,required=True,help='New output folder OUTSIDE the source archive')
	p.add_argument('--workers',type=int,default=5)
	a=p.parse_args()
	if a.out.exists():
		raise SystemExit('Refusing to replace an earlier audit: '+str(a.out))
	if not (a.root/'roster.json').is_file():
		raise SystemExit('Missing archive roster')
	report=audit(a.root,max(1,min(12,a.workers)))
	a.out.mkdir(parents=True,exist_ok=False)
	(a.out/'audit.json').write_text(json.dumps(report,indent=2)+'\n')
	(a.out/'README.md').write_text(markdown(report))
	print('ARCHIVE_AUDIT',a.out,'songs',report['songCount'],
		'with_flags',sum(bool(x['warnings']) for x in report['songs']))
	for row in report['songs']:
		if row['warnings']:
			print('FLAG',row['slot'],row['title'],';'.join(row['warnings']))

if __name__=='__main__':
	main()
