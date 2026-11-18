/** Static, read-only offline WebAudio sample-rate/stereo QA. Does not alter game. */
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const target=process.env.REPORT_OUT||
	'/home/hermes/experiments/bitstream-master-guard-samplerates-20261118.json';
if(existsSync(target))throw Error('Refusing to overwrite QA evidence '+target);
const code=readFileSync(new URL('../../src/systems/music/MasterPeakGuard.js',import.meta.url),'utf8');
const digest=createHash('sha256').update(code).digest('hex');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(String(e)));
try{
	const cases=await page.evaluate(async({code})=>{
		const blob=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
		let module;
		try{module=await import(blob)}finally{URL.revokeObjectURL(blob)}
		const {createMasterPeakGuard,createFinalSampleCeiling}=module;
		const hzList=[44100,48000,96000];
		const oversamplingModes=['none','2x','4x','4x+ceiling'];
		const testCases=[
			{name:'quiet',left:.24,right:-.17,kind:'sine'},
			{name:'moderate',left:.73,right:-.79,kind:'sine'},
			{name:'overfull',left:1.8,right:-1.65,kind:'sine'},
			{name:'stereo-opposite',left:1.9,right:-1.9,kind:'sine'},
			{name:'pulsed-overdrive',left:2.1,right:-2.0,kind:'pulses'},
		];
		const result=[];
		function stats(a){
			let peak=0,sum=0;
			for(const x of a){peak=Math.max(peak,Math.abs(x));sum+=x*x;}
			return {peak,rms:Math.sqrt(sum/a.length),
				peakDbfs:20*Math.log10(Math.max(peak,1e-12))};
		}
		for(const hz of hzList)for(const item of testCases)for(const oversampling of oversamplingModes){
			const frames=Math.round(hz*.45);
			const inputBuffer=new AudioBuffer({length:frames,
				sampleRate:hz,numberOfChannels:2});
			for(let channel=0;channel<2;channel++){
				const data=inputBuffer.getChannelData(channel);
				const amplitude=channel===0?item.left:item.right;
				for(let i=0;i<frames;i++){
					const env=Math.min(1,i/(hz*.015),
						(frames-1-i)/(hz*.015));
					const wave=item.kind==='sine'?
						Math.sin(2*Math.PI*997*i/hz):
						(i%Math.round(hz*.007)<7?1:-.05);
					data[i]=amplitude*wave*Math.max(0,env);
				}
			}
			const c=new OfflineAudioContext(2,frames,hz);
			const src=c.createBufferSource();src.buffer=inputBuffer;
			const guard=createMasterPeakGuard(c);
			guard.oversample=oversampling==='4x+ceiling'?'4x':oversampling;
			src.connect(guard);
			if(oversampling==='4x+ceiling'){
				const final=createFinalSampleCeiling(c);
				guard.connect(final);final.connect(c.destination);
			}else guard.connect(c.destination);
			src.start();
			const output=await c.startRendering();
			const before=Array.from({length:2},(_,i)=>
				stats(inputBuffer.getChannelData(i)));
			const after=Array.from({length:2},(_,i)=>
				stats(output.getChannelData(i)));
			const left=output.getChannelData(0),right=output.getChannelData(1);
			const sum=stats(Float32Array.from(left,(v,i)=>(v+right[i])*.5));
			result.push({hz,case:item.name,oversampling,
				before,after,monoDownmix:sum});
		}
		return result;
	},{code});
	assert.equal(cases.length,60);
	assert.deepEqual(errors,[]);
	const violations=[];const candidateViolations=[];
	for(const c of cases){
		assert.ok(['none','2x','4x','4x+ceiling'].includes(c.oversampling));
		for(let channel=0;channel<2;channel++){
			const x=c.after[channel],b=c.before[channel];
			if(x.peak>.90){
				const entry={hz:c.hz,case:c.case,oversampling:c.oversampling,
					channel,peak:x.peak};
				violations.push(entry);
				if(c.oversampling==='4x+ceiling')candidateViolations.push(entry);
			}
			if(c.case==='quiet'||c.case==='moderate'){
				assert.ok(Math.abs(x.rms-b.rms)/b.rms<.018,
					'Normal-level amplitude altered >1.8% at '+c.hz+'/'+c.case);
			}
			if(c.case==='overfull'||c.case==='stereo-opposite'){
				assert.ok(x.rms>.35,
					'Output went missing at '+c.hz+'/'+c.case+' channel '+channel);
			}
		}
	}
	const report={format:'bitstream-master-guard-web-audio-3rates-stereo-v1',
		status:candidateViolations.length?'CANDIDATE_FAIL':'CANDIDATE_PASS',
		violations,candidateViolations,
		guardSourceSha256:digest,rates:[44100,48000,96000],
		testCaseCount:5,stereoStates:60,oversamplingModes:['none','2x','4x','4x+ceiling'],renderedSource:'OfflineAudioContext real browser',
		cases};
	writeFileSync(target,JSON.stringify(report,null,2)+'\n');
	console.log('OFFLINE_STEREO_SAMPLERATES_DIAGNOSTIC','states',cases.length,'rates',report.rates);
	console.log('VIOLATIONS_OF_OLD_OVERSAMPLING',JSON.stringify(violations));
	console.log('CANDIDATE_STEREO_CEILING',report.status);
	console.log('GUARD_SOURCE_SHA',digest);
	for(const hz of report.rates)for(const mode of report.oversamplingModes){
		const rows=cases.filter(x=>x.hz===hz&&x.oversampling===mode);
		console.log('RATE',hz,'MODE',mode,
			'MAX_SAMPLE_PEAK_DBFS',
			Math.max(...rows.flatMap(x=>x.after.map(a=>a.peakDbfs))).toFixed(3),
			'OPPOSITE_MONO_PEAK_DBFS',
			rows.find(x=>x.case==='stereo-opposite').monoDownmix.peakDbfs.toFixed(2));
	}
	console.log('EVIDENCE_SHA256',createHash('sha256')
		.update(readFileSync(target)).digest('hex'));
	assert.equal(candidateViolations.length,0,
		'Two-stage source implementation exceeded .9 sampled amplitude');
}finally{await browser.close()}
