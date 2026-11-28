/* A/B audition: all decoded buffers use the same AudioContext timeline. */
const options = [
	{id:"recorded",name:"Recorded game MIDI",tag:"REFERENCE",desc:"Existing Debumont MIDI-derived recorded stems with original vocals."},
	{id:"dense",name:"Dense synth control",tag:"ALL EXTRACTED NOTES",desc:"Same experimental synth and original vocals, without note removal."},
	{id:"beats",name:"Beats only",tag:"QUARTER-NOTE GRID",desc:"Retain attacks near the provisional beat positions; preserve each retained chord."},
	{id:"eighths",name:"Beats + half-beats",tag:"EIGHTH-NOTE GRID",desc:"Retain attacks near beats and halfway positions. More motion, less clutter."},
	{id:"selective",name:"Musically selective",tag:"RHYTHM-BUDGET HEURISTIC",desc:"Prioritize beats, chords, kick/snare and sustained notes within per-beat budgets."},
	{id:"hybrid",name:"Hybrid original + MIDI",tag:"RECORDED + ACCENTS",desc:"Real source stems underpin the selected synthesized MIDI accents."}
];
const el = id => document.getElementById(id);
let manifest=null, ctx=null, master=null, buffers={}, nodes=[], gates={};
let active="recorded", playing=false, offset=0, anchor=0, blind=false;
let blindKeys=options.map(x=>x.id);
const choices=el("choices"), playBtn=el("play"), seek=el("seek");
const status=el("status"), disc=document.querySelector(".disc");
const setStatus=(s,ok=false)=>{status.textContent=s;status.parentNode.classList.toggle("ready",ok);};
function countRatio(key){
	if(!manifest || !manifest.counts[key])return null;
	const all=Object.values(manifest.counts[key]);
	const total=all.reduce((a,v)=>a+v.from,0),kept=all.reduce((a,v)=>a+v.retained,0);
	return {total,kept,pct:Math.round(100*kept/total)};
}
function makeChoices(){
	choices.replaceChildren();
	blindKeys.forEach((id,index)=>{
		const info=options.find(o=>o.id===id);
		const ratio=countRatio(id),name=blind?("Candidate "+String.fromCharCode(65+index)):info.name;
		const desc=blind?"Listen without knowing which treatment is playing.":info.desc;
		const button=document.createElement("button");
		button.type="button";button.className="choice";button.dataset.mode=id;
		button.setAttribute("aria-pressed",String(active===id));
		const top=document.createElement("div");top.className="choice-top";
		const h=document.createElement("h3");h.textContent=name;
		const shortcut=document.createElement("span");shortcut.className="shortcut";shortcut.textContent=index+1;
		top.append(h,shortcut);
		const p=document.createElement("p");p.textContent=desc;
		const tagline=document.createElement("div");tagline.className="tagline";
		tagline.textContent=blind?"BLIND CONDITION":ratio?(ratio.pct+"% retained • "+ratio.kept+" / "+ratio.total+" notes"):info.tag;
		button.append(top,p,tagline);
		if(!blind && ratio){
			const track=document.createElement("div");track.className="meter";
			const amount=document.createElement("span");amount.style.width=ratio.pct+"%";
			track.append(amount);button.append(track);
		}
		button.onclick=()=>choose(id);
		choices.append(button);
	});
	setTitle();
}
function setTitle(){
	const opt=options.find(x=>x.id===active);
	const index=blindKeys.indexOf(active);
	el("current-name").textContent=blind?("Candidate "+String.fromCharCode(65+index)):opt.name;
	el("current-description").textContent=blind?"One More Run • randomized blind playback":opt.desc;
}
function choose(id){
	if(active===id)return;
	const old=active;active=id;
	if(playing){
		const now=ctx.currentTime;
		for(const [key,target] of [[old,0],[active,1]]){
			const g=gates[key].gain;g.cancelScheduledValues(now);g.setValueAtTime(g.value,now);
			g.linearRampToValueAtTime(target,now+.04);
		}
	}
	makeChoices();
}
function currentOffset(){
	if(!playing)return offset;
	return Math.min(manifest.duration,Math.max(0,offset+ctx.currentTime-anchor));
}
function stopVoices(){
	for(const src of nodes){try{src.stop();}catch{}src.disconnect();}
	nodes=[];gates={};
}
function startVoices(){
	stopVoices();
	if(offset>=manifest.duration-.02)offset=0;
	anchor=ctx.currentTime+.055;
	for(const opt of options){
		const src=ctx.createBufferSource();
		src.buffer=buffers[opt.id];
		const gain=ctx.createGain();gain.gain.value=opt.id===active?1:0;
		src.connect(gain).connect(master);
		src.start(anchor,offset,Math.max(.01,manifest.duration-offset));
		nodes.push(src);gates[opt.id]=gain;
	}
	playing=true;playBtn.innerHTML="Ⅱ <span>Pause</span>";disc.style.animation="spin 2.2s linear infinite";
	window.requestAnimationFrame(tick);
}
function pause(){
	if(!playing)return;
	offset=currentOffset();playing=false;stopVoices();
	playBtn.innerHTML="▶ <span>Play</span>";disc.style.animation="";
	tick();
}
async function toggle(){
	if(!manifest)return;
	if(playing){pause();return;}
	await ctx.resume();
	startVoices();
}
function timeFmt(sec){
	const s=Math.max(0,Math.round(sec));
	return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
}
function tick(){
	const t=currentOffset();
	seek.value=String(t);
	el("elapsed").textContent=timeFmt(manifest.start+t);
	el("remaining").textContent=timeFmt(manifest.start+manifest.duration);
	if(playing&&t>=manifest.duration-.03){pause();offset=0;tick();return;}
	if(playing)window.requestAnimationFrame(tick);
}
function drawWaveform(){
	const audio=buffers.recorded,canvas=el("waveform");
	const context=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
	context.clearRect(0,0,w,h);
	context.fillStyle="#132534";context.fillRect(0,0,w,h);
	const data=audio.getChannelData(0);
	const step=Math.floor(data.length/w);
	context.fillStyle="#33cdb6";
	for(let x=0;x<w;x++){
		let peak=0;
		for(let j=0;j<step;j+=Math.max(1,Math.floor(step/64))){
			peak=Math.max(peak,Math.abs(data[x*step+j]||0));
		}
		const bar=Math.max(1,Math.min(h/2,peak*(h*.62)));
		context.fillRect(x,Math.floor(h/2-bar),1,2*Math.ceil(bar));
	}
	context.strokeStyle="#5ee5d8";context.globalAlpha=.35;
	context.beginPath();context.moveTo(0,h/2);context.lineTo(w,h/2);context.stroke();context.globalAlpha=1;
}
function shuffle(ids){
	const a=[...ids];
	for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
	return a;
}
async function load(){
	try{
		const response=await fetch("manifest.json",{cache:"no-store"});
		if(!response.ok)throw new Error("Missing audition manifest");
		manifest=await response.json();
		ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});
		master=ctx.createGain();master.gain.value=.75;master.connect(ctx.destination);
		seek.max=String(manifest.duration);offset=0;
		let done=0;
		await Promise.all(options.map(async opt=>{
			const res=await fetch(manifest.files[opt.id].file);
			if(!res.ok)throw new Error("Missing audio "+opt.id);
			const bytes=await res.arrayBuffer();
			buffers[opt.id]=await ctx.decodeAudioData(bytes);
			if(Math.abs(buffers[opt.id].duration-manifest.duration)>.035)
				throw new Error("Misaligned audio buffer "+opt.id);
			done++;setStatus("Decoded "+done+" / "+options.length+" versions…");
		}));
		drawWaveform();makeChoices();tick();
		playBtn.disabled=false;setStatus("Ready • all versions aligned on one audio clock",true);
	}catch(err){setStatus("Could not load preview: "+err.message);console.error(err);}
}
playBtn.onclick=toggle;
seek.addEventListener("input",()=>{
	if(!manifest)return;
	const requested=Number(seek.value);
	const wasPlaying=playing;
	if(wasPlaying)pause();
	offset=Math.min(manifest.duration,requested);tick();
	if(wasPlaying)startVoices();
});
el("volume").addEventListener("input",ev=>{if(master)master.gain.value=Number(ev.target.value)/100;});
el("blind").addEventListener("change",ev=>{
	blind=ev.target.checked;blindKeys=blind?shuffle(options.map(x=>x.id)):options.map(x=>x.id);
	makeChoices();
});
document.addEventListener("keydown",ev=>{
	if(ev.altKey||ev.ctrlKey||ev.metaKey||["INPUT","TEXTAREA","BUTTON"].includes(document.activeElement?.tagName))return;
	const n=Number(ev.key);
	if(n>=1 && n<=6){ev.preventDefault();choose(blindKeys[n-1]);}
	if(ev.code==="Space"){ev.preventDefault();toggle();}
});
load();
