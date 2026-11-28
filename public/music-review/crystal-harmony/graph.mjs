/** Original-stem Crystal DSP graph, shared by browser audition and OfflineAudioContext QA.
 * All source note selections are unverified; this graph never touches game state.
 */
import { resonanceChanges, boundedWetMix, MAX_RESONATOR_Q } from './resonators.mjs';

export function createCrystalGraph(ctx,{destination, harmony, sourceStart, sourceEnd,
	startAt, dryGain, wetMix, onNode=()=>{}}) {
	if (!ctx || !destination || !harmony || ![sourceStart,sourceEnd,startAt,dryGain,wetMix].every(Number.isFinite)
		|| sourceEnd<=sourceStart || sourceStart<0 || dryGain<0 || dryGain>.45)
		throw new RangeError('Unsafe source-time resonator graph arguments');
	const nodes=[];
	const track=node=>{nodes.push(node);onNode(node);return node;};
	const dry=track(ctx.createGain());dry.gain.value=dryGain;dry.connect(destination);
	const input=track(ctx.createGain());input.gain.value=1;
	const filtered=track(ctx.createGain());
	const comp=track(ctx.createDynamicsCompressor());
	comp.threshold.value=-24;comp.knee.value=12;comp.ratio.value=7;
	comp.attack.value=.004;comp.release.value=.17;
	filtered.connect(comp);
	const wetControl=track(ctx.createGain());
	wetControl.gain.value=boundedWetMix(wetMix);
	comp.connect(wetControl);wetControl.connect(destination);
	const bank=()=>{
		const gain=track(ctx.createGain());gain.gain.value=0;gain.connect(filtered);
		const filters=[];
		for(let i=0;i<3;i++) {
			const node=track(ctx.createBiquadFilter());node.type='bandpass';
			node.frequency.value=600;node.Q.value=Math.min(MAX_RESONATOR_Q,13);
			input.connect(node);node.connect(gain);filters.push(node);
		}
		return {gain,filters};
	};
	const banks=[bank(),bank()];
	const changes=resonanceChanges(harmony,sourceStart,sourceEnd);
	let current=-1,level=0;
	for(const change of changes){
		const at=startAt+Math.max(0,change.atSeconds-sourceStart);
		const next=(current+1)%2, b=banks[next];
		const goal=change.notes.length?change.strength:0;
		for(let i=0;i<change.notes.length;i++)
			b.filters[i].frequency.setValueAtTime(change.notes[i].frequencyHz,at);
		b.gain.gain.setValueAtTime(0,at);
		b.gain.gain.linearRampToValueAtTime(goal,at+.07);
		if(current>=0){
			const old=banks[current].gain.gain;
			old.setValueAtTime(level,at);
			old.linearRampToValueAtTime(0,at+.07);
		}
		current=next;level=goal;
	}
	return {dry,input,filtered,wetControl,comp,banks,changeCount:changes.length,nodes};
}

export function synthesizeLanding(ctx,graph,sourceRowNotes,impact,at) {
	if (!graph || !Array.isArray(sourceRowNotes) || !sourceRowNotes.length)return [];
	if (![impact,at].every(Number.isFinite) || impact<0 || impact>1)
		throw new RangeError('Landing impact must be normalized');
	const nodes=[];
	for(let i=0;i<Math.min(3,sourceRowNotes.length);i++){
		const osc=ctx.createOscillator(),env=ctx.createGain();
		osc.type='sine';osc.frequency.setValueAtTime(sourceRowNotes[i].frequencyHz*(i===2?2:1),at);
		const level=Math.min(.055,.008+.036*impact)*[1,.75,.5][i];
		env.gain.setValueAtTime(.00001,at);
		env.gain.linearRampToValueAtTime(level,at+.013);
		env.gain.exponentialRampToValueAtTime(.00001,at+.7+i*.21);
		osc.connect(env);env.connect(graph.filtered);
		osc.start(at+i*.007);osc.stop(at+1.3);
		nodes.push(osc,env);
	}
	return nodes;
}
