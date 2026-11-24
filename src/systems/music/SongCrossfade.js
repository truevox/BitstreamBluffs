/** Musical transition only. Provisional grids never become physics/Gym authority. */
import {sin,cos} from '../pmath.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function normalizeTransitionGrids(raw){
	const result=new Map();
	if(raw?.format!=='bsb-provisional-transition-grids-v1'||!Array.isArray(raw.tracks)||raw.tracks.length>500)return result;
	for(const t of raw.tracks){
		if(typeof t?.id!=='string'||result.has(t.id)||t.status!=='estimated-4/4'||
			!Number.isFinite(t.duration)||t.duration<1||!Number.isFinite(t.bpm)||t.bpm<48||t.bpm>250||
			!Array.isArray(t.downbeats)||t.downbeats.length>3000||t.downbeats.length<2||
			!t.downbeats.every((x,i,a)=>Number.isFinite(x)&&x>=0&&x<t.duration&&(i===0||x>a[i-1])))continue;
		result.set(t.id,{...t,downbeats:t.downbeats.slice()});
	}
	return result;
}
export function planSongCrossfade(duration,outgoing,incoming){
	const valid=g=>g&&Math.abs(g.duration-duration)<.25;
	const preferred=valid(outgoing)&&outgoing.quietTail?3.8:2.8;
	let start=duration-preferred,beatAligned=false;
	if(valid(outgoing)){
		// Let the first incoming estimated downbeat coincide with an outgoing bar
		// if it arrives within 1 second. Never skip or stretch the incoming recording.
		const first=incoming?.downbeats?.[0];
		const intro=Number.isFinite(first)&&first<=1?first:0;
		const options=outgoing.downbeats.map(t=>t-intro).filter(t=>t>=duration-4&&t<=duration-2);
		if(options.length){start=options.reduce((a,b)=>Math.abs(b-start)<Math.abs(a-start)?b:a);beatAligned=Number.isFinite(first)&&first<=1;}
	}
	return {start:Math.max(0,start),duration:duration-start,beatAligned};
}
export function transitionGain(role,direction,progress){
	const p=clamp(progress,0,1);
	// Separate lyrics completely; don't blend two different rhythms at full strength.
	if(role==='vocals'){
		return direction==='out'?1-clamp(p/.48,0,1):clamp((p-.52)/.48,0,1);
	}
	if(role==='drums'||role==='bass'){
		const x=clamp((p-.30)/.40,0,1);
		return direction==='out'?1-x:x;
	}
	// Equal-power melodic blend (master peak guard remains downstream).
	return direction==='out'?cos(p*Math.PI/2):sin(p*Math.PI/2);
}
export function automateTransition(param,role,direction,start,end,notBefore=start){
	const at=Math.max(start,notBefore);
	if(at>=end){param.setValueAtTime(direction==='in'?1:0,at);return;}
	const steps=32,span=end-start;
	param.setValueAtTime(transitionGain(role,direction,(at-start)/span),at);
	for(let i=1;i<=steps;i++){
		const t=at+(end-at)*i/steps;
		param.linearRampToValueAtTime(transitionGain(role,direction,(t-start)/span),t);
	}
}
