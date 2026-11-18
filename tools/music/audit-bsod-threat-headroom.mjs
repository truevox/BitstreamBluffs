/** OfflineAudioContext RMS/peak audit of the *real* shipped stem Oggs,
 * passing through the exact music BsodThreatProcessor module source.
 * No song edits, no local gameplay simulation, no listening approval.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright';
const url=process.env.GAME_URL||'http://100.115.120.66:8202/';
const out=process.env.REPORT_OUT||'/home/hermes/experiments/bitstream-bsod-threat-headroom-20261118.json';
if(existsSync(out))throw Error('Refusing to overwrite evidence '+out);
const moduleSource=readFileSync(new URL('../../src/systems/music/BsodThreatProcessor.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,args:['--no-sandbox',
	'--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:800,height:600}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
	await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
	const findings=await page.evaluate(async({moduleSource})=>{
		const blob=URL.createObjectURL(new Blob([moduleSource],{type:'text/javascript'}));
		let imported;
		try{imported=await import(blob)}finally{URL.revokeObjectURL(blob)}
		const {createBsodThreatProcessor}=imported;
		const songs=['01_FEsxYVStla4','03_WRBGQUqD54U','31_FYImnz5-hXs',
			'33_local-one-more-run-bitstream-bluffs'];
		const stems=['guitar','piano','other'];
		const segmentIndices=[0,3,12];
		const dangers=[0,.5,.97];
		const analysisHz=48000, length=analysisHz*3.5, skip=.5;
		const decoder=new OfflineAudioContext(2,1,analysisHz);
		const analysis=(audio)=>{
			let sum=0,peak=0,n=0;
			for(let channel=0;channel<audio.numberOfChannels;channel++){
				const data=audio.getChannelData(channel);
				for(let i=Math.round(skip*analysisHz);i<data.length;i++){
					const v=data[i];sum+=v*v;peak=Math.max(peak,Math.abs(v));n++;
				}
			}
			return {rms:Math.sqrt(sum/Math.max(1,n)),peak};
		};
		const render=async(buffer,danger)=>{
			const offline=new OfflineAudioContext(2,length,analysisHz);
			const src=offline.createBufferSource();src.buffer=buffer;
			const processor=createBsodThreatProcessor(offline,offline.destination);
			src.connect(processor.input);
			processor.setDanger(danger);
			src.start(0);src.stop(length/analysisHz);
			const rendered=await offline.startRendering();
			processor.destroy();
			return analysis(rendered);
		};
		const rows=[];
		for(const song of songs)for(const segmentIndex of segmentIndices)for(const stem of stems){
			const file='/music/packs/'+song+'/'+String(segmentIndex).padStart(4,'0')+'-'+stem+'.ogg';
			const response=await fetch(file,{cache:'no-store'});
			if(!response.ok)throw Error('Stem fetch '+response.status+' '+file);
			const bytes=await response.arrayBuffer();
			const audio=await decoder.decodeAudioData(bytes.slice(0));
			if(audio.length<length)throw Error('Too-short source '+file+' '+audio.length);
			const levels={};
			for(const danger of dangers)levels[String(danger)]=await render(audio,danger);
			const reference=levels['0'];
			if(reference.rms<=0)throw Error('Completely silent source '+file);
			const deltas=Object.fromEntries(dangers.filter(d=>d>0).map(d=>{
				const data=levels[String(d)];
				return [String(d),{
					rmsDb:20*Math.log10(data.rms/reference.rms),
					peakDb:20*Math.log10(data.peak/reference.peak),
					peakDbfs:20*Math.log10(Math.max(data.peak,1e-12)),
				}];
			}));
			rows.push({song,segmentIndex,stem,file,oggSha256:null,
				analysis:{sampleRate:analysisHz,durationSeconds:3.5,skipSeconds:skip},
				levels,deltas});
		}
		return rows;
	},{moduleSource});
	assert.equal(findings.length,36);
	assert.equal(errors.length,0,'Web page errors');
	const report={format:'bitstream-bsod-real-stem-offline-headroom-v2',
		status:'automated-amplitude-measurement-not-listening-approval',
		segmentIndices:[0,3,12],
		branch:'feature/music-bsod-corruption-20261118',
		moduleSourceSha256:null,rows:findings};
	const {createHash}=await import('node:crypto');
	for(const item of findings){
		const localFile=readFileSync(new URL('../../public'+item.file,import.meta.url));
		item.oggSha256=createHash('sha256').update(localFile).digest('hex');
		const response=await fetch(new URL(item.file,url));
		if(!response.ok)throw Error('Audit preview Ogg fetch failed '+item.file);
		const served=Buffer.from(await response.arrayBuffer());
		assert.equal(createHash('sha256').update(served).digest('hex'),item.oggSha256,
			'Preview Ogg differs from pinned local release source: '+item.file);
	}
	report.moduleSourceSha256=createHash('sha256').update(moduleSource).digest('hex');
	console.log('REAL-OGG HEADROOM AUDIT',out,'SOURCES',findings.length);
	for(const x of findings)console.log(x.song,'segment',x.segmentIndex,x.stem,
		'near RMS dB',x.deltas['0.97'].rmsDb.toFixed(2),
		'near PEAK dB',x.deltas['0.97'].peakDb.toFixed(2),
		'near PEAK dBFS',x.deltas['0.97'].peakDbfs.toFixed(2));
	const rms=findings.map(x=>x.deltas['0.97'].rmsDb);
	const pk=findings.map(x=>x.deltas['0.97'].peakDb);
	const peakDbfs=findings.map(x=>x.deltas['0.97'].peakDbfs);
	const midRms=findings.map(x=>x.deltas['0.5'].rmsDb);
	const midPeak=findings.map(x=>x.deltas['0.5'].peakDb);
	const midPeakDbfs=findings.map(x=>x.deltas['0.5'].peakDbfs);
	const maxRms=Math.max(...rms),minRms=Math.min(...rms);
	const maxPeak=Math.max(...pk),maxPeakDbfs=Math.max(...peakDbfs);
	console.log('RMS_CHANGE_DB min',minRms.toFixed(2),'max',maxRms.toFixed(2),
		'MAX_PEAK_GAIN_DB',maxPeak.toFixed(2),'MAX_PEAK_DBFS',maxPeakDbfs.toFixed(2));
	// These are engineering limits for these 36 exact source excerpts,
	// not a claim about a full six-stem mixed program or listening quality.
	const limits={maxRmsBoostDb:4,maxRmsAttenuationDb:4,
		maxPeakBoostDb:4,maxIndividualStemPeakDbfs:-6,
		maxMidRmsBoostDb:4,maxMidRmsAttenuationDb:4,maxMidPeakBoostDb:4};
	report.headroomLimits=limits;
	report.headroomStatus=maxRms<=limits.maxRmsBoostDb&&
		minRms>=-limits.maxRmsAttenuationDb&&
		maxPeak<=limits.maxPeakBoostDb&&
		maxPeakDbfs<=limits.maxIndividualStemPeakDbfs&&
		Math.max(...midRms)<=limits.maxMidRmsBoostDb&&
		Math.min(...midRms)>=-limits.maxMidRmsAttenuationDb&&
		Math.max(...midPeak)<=limits.maxMidPeakBoostDb&&
		Math.max(...midPeakDbfs)<=limits.maxIndividualStemPeakDbfs?'PASS':'FAIL';
	writeFileSync(out,JSON.stringify(report,null,2)+'\n');
	assert.equal(report.headroomStatus,'PASS',
		'Corrected BSOD effect exceeded pinned real-stem headroom limits');
	console.log('MID_DANGER_RMS_DB',Math.min(...midRms).toFixed(2),
		Math.max(...midRms).toFixed(2),'MAX_MID_PEAK_BOOST_DB',
		Math.max(...midPeak).toFixed(2),'MAX_MID_PEAK_DBFS',
		Math.max(...midPeakDbfs).toFixed(2));
	console.log('PINNED_REAL_STEM_HEADROOM_GATE_PASS',limits);
}finally{await browser.close()}
