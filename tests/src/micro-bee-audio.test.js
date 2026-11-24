import { MicroBeeAudio } from '../../src/systems/music/MicroBeeAudio.js';
import { beesAt } from '../../src/systems/MicroBees.js';
import { GAME_WIDTH } from '../../src/constants.js';

function fakeAudio(){
	const nodes=[];const osc=[];
	const param=(n=0)=>({value:n,last:n,cancelScheduledValues(){this.cancelled=(this.cancelled||0)+1;},setTargetAtTime(v){this.value=v;this.last=v;}});
	const node=(kind)=>{
		const n={kind,connected:[],disconnected:false,connect(other){this.connected.push(other);},
			disconnect(){this.disconnected=true;},
			frequency:param(0),Q:param(0),gain:param(0),pan:param(0),
			start(){this.started=true;},stop(){this.stopped=true;}};
		nodes.push(n);if(kind==='osc')osc.push(n);return n;
	};
	return {ctx:{currentTime:2.4,createOscillator:()=>node('osc'),
		createBiquadFilter:()=>node('filter'),createStereoPanner:()=>node('panner'),
		createGain:()=>node('gain')},nodes,osc,target:node('bus')};
}
describe('Micro Mountain actual visual-bee audio, no simulated new bees',()=>{
	test('exactly two bounded quiet voices; pan follows actual body position relative to rider',()=>{
		const {ctx,osc,target,nodes}=fakeAudio();
		const bees=new MicroBeeAudio(ctx,target);
		expect(osc).toHaveLength(2);
		expect(osc.every(x=>x.started)).toBe(true);
		expect(bees.intensity).toBe(1.5);
		bees.setPositions([{id:0,x:100,alpha:1},{id:1,x:GAME_WIDTH-100,alpha:.75}],
			{enabled:true,playerScreenX:GAME_WIDTH/2});
		expect(bees.voices[0].pan.pan.value).toBeLessThan(-.2);
		expect(bees.voices[1].pan.pan.value).toBeGreaterThan(.2);
		expect(bees.voices[0].level.gain.value).toBeGreaterThan(0);
		expect(bees.voices[0].level.gain.value).toBeLessThan(.03);
		bees.setIntensity(2);
		bees.setPositions([{id:0,x:GAME_WIDTH/2,alpha:1},{id:1,x:GAME_WIDTH/2,alpha:1}],
			{enabled:true,playerScreenX:GAME_WIDTH/2});
		expect(bees.voices[0].pan.pan.value).toBe(0);
		const count=bees.voices[0].pan.pan.cancelled;
		for(let i=0;i<1000;i++)bees.setPositions([{id:0,x:GAME_WIDTH/2,alpha:1}],
			{enabled:true,playerScreenX:GAME_WIDTH/2});
		expect(bees.voices[0].pan.pan.cancelled).toBe(count);
		expect(bees.voices[0].level.gain.value).toBeCloseTo(.028);
		bees.setPositions([],{enabled:false});
		expect(bees.voices.every(v=>v.level.gain.value===0)).toBe(true);
		bees.dispose();bees.dispose();
		expect(osc.every(x=>x.stopped)).toBe(true);
		expect(nodes.filter(x=>x!==target).every(x=>x.disconnected)).toBe(true);
		expect(bees.setPositions([{id:0,x:90,alpha:1}],{enabled:true})).toBe(false);
	});
	test('beesAt same actual existing deterministic coordinates; hidden bees never play',()=>{
		const {ctx,target}=fakeAudio(),sound=new MicroBeeAudio(ctx,target);
		const visible=beesAt(750,4500,0);
		const visibleAgain=beesAt(750,4500,0);
		expect(visible).toEqual(visibleAgain);
		for(const b of visible)expect(b.id).toBeLessThan(2);
		// Source is visual beesAt, and each missing/faded bee gets zero signal.
		sound.setPositions(visible,{enabled:true,playerScreenX:GAME_WIDTH/2});
		for(const voice of sound.voices){
			const bee=visible.find(b=>b.id===voice.id);
			expect(voice.level.gain.value>0).toBe(!!bee);
		}
		sound.setPositions(visible,{enabled:false});
		expect(sound.voices.every(v=>v.level.gain.value===0)).toBe(true);
		sound.dispose();
	});
});
