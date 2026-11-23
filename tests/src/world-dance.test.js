import { jest } from '@jest/globals';
import {WorldDanceEnvelope,worldDanceMotionAllowed,sunDanceGeometry,biomeDanceStyle}
 from '../../src/systems/WorldDance.js';
import {Background,motifDecor} from '../../src/entities/Background.js';
import {AudioSynth} from '../../src/systems/AudioSynth.js';

const audio=(timeMs,bass,mid=0.08,revision='song1:1')=>({timeMs,bass,mid,revision});
const green={bg:0x000102,bgAlt:0x000202,cyan:0x003333,magenta:0x330033,
  lime:0x003300,amber:0x333300,text:0xffffff,danger:0xff0000};

function gfxScene(){
 const calls=[];
 const gfx=new Proxy({}, {get(_,name){
  if(name==='setScrollFactor'||name==='setDepth')return ()=>gfx;
  return (...args)=>{calls.push([name,...args]);return gfx;};
 }});
 return {scene:{add:{graphics:()=>gfx}},calls};
}

test('Steampunk cosmetic click only accepts the exact original live recording sample, not a fake meter',()=>{
 const source={revision:'song:1',timeMs:1200,bass:.6,mid:.2};
 const player={onSteampunkMusicAccent:jest.fn(()=>true)};
 const synth=Object.create(AudioSynth.prototype);
 synth._musicMode='run';synth._paused=false;synth._musicWanted=true;
 synth._vinylAudible=()=>true;
 synth._worldDanceSample=source;synth._stemMusic=player;
 expect(synth.onSteampunkRecordedAccent(source)).toBe(true);
 expect(player.onSteampunkMusicAccent).toHaveBeenCalledWith(source);
 expect(synth.onSteampunkRecordedAccent({...source})).toBe(false);
 expect(synth.onSteampunkRecordedAccent({timingKind:'synthetic-unverified',beatIndex:7})).toBe(false);
 synth._paused=true;
 expect(synth.onSteampunkRecordedAccent(source)).toBe(false);
 expect(player.onSteampunkMusicAccent).toHaveBeenCalledTimes(1);
});

test('true WorldDance source accent is distinct from unverified decorative meter pulses',()=>{
 const w=new WorldDanceEnvelope();
 const meter={timingKind:'synthetic-unverified',use:'cosmetic-only',trusted:false,
  canAuthorizeGameplay:false,transportRevision:'song1:1',beatIndex:1,measureIndex:0,
  beatInMeasure:2};
 w.update(audio(0,.15),40,{...meter,beatIndex:0,beatInMeasure:1});
 w.update(audio(50,.15),50,meter);
 expect(w.lastAccentMs).toBe(-Infinity);
 const rising=audio(100,.72,.43);
 w.update(rising,50,{...meter,beatIndex:2,beatInMeasure:3});
 expect(w.lastAccentMs).toBe(rising.timeMs);
 w.update(audio(150,.72,.43),50,{...meter,beatIndex:3,beatInMeasure:4});
 expect(w.lastAccentMs).toBe(rising.timeMs); // artificial beat can't create audio clicks
});

test('actual positive music transient makes a bounded pulse, then decays; steady music does not retrigger',()=>{
 const w=new WorldDanceEnvelope();
 expect(w.update(audio(0,.1),16.7)).toBe(0);
 const hit=w.update(audio(50,.52,.25),50);
 expect(hit).toBeGreaterThan(.08);
 expect(hit).toBeLessThanOrEqual(1);
 const repeat=w.update(audio(50,.52,.25),16.7);
 expect(repeat).toBeLessThan(hit);
 expect(w.update(audio(100,.52,.25),50)).toBeLessThan(repeat);
 for(let time=150;time<=2000;time+=50)w.update(audio(time,.52,.25),50);
 expect(w.pulse).toBeLessThan(.001);
 expect(w.update(audio(2050,.52,.25),50)).toBeLessThan(.001);
 const second=w.update(audio(2250,.1,.08),50);
 expect(second).toBeLessThan(.001);
 expect(w.update(audio(2300,.56,.25),50)).toBeGreaterThan(0);
});

test('revision/mute/pause/reset/reduced motion are fail-closed and never introduce a clock',()=>{
 const w=new WorldDanceEnvelope();
 w.update(audio(0,.1),50);expect(w.update(audio(40,.8),50)).toBeGreaterThan(0);
 expect(w.update(null,50)).toBe(0);
 expect(w.update(audio(100,.8),50)).toBe(0); // fresh song starts neutral
 expect(w.update(audio(140,.85),50)).toBeGreaterThanOrEqual(0);
 expect(w.update(audio(180,.2,.1,'new-song'),50)).toBe(0);
 expect(w.update(audio(220,.8,.1,'new-song'),50)).toBeGreaterThan(0);
 expect(w.update(audio(0,.2,.1,'new-song'),50)).toBe(0); // seek/backward
 expect(w.update({timeMs:Infinity,revision:'song',bass:1,mid:1},50)).toBe(0);
 expect(w.update({timeMs:40,revision:'song',bass:NaN,mid:1},50)).toBe(0);
 expect(worldDanceMotionAllowed({},false)).toBe(true);
 expect(worldDanceMotionAllowed({reduceMotion:true},false)).toBe(false);
 expect(worldDanceMotionAllowed({reduceMotion:'on'},false)).toBe(false);
 expect(worldDanceMotionAllowed({reduceMotion:'on'},true)).toBe(false);
 expect(worldDanceMotionAllowed({reduceMotion:'off'},true)).toBe(true);
 expect(worldDanceMotionAllowed({reduceMotion:'auto'},true)).toBe(false);
 expect(worldDanceMotionAllowed({reduceMotion:'auto'},false)).toBe(true);
 expect(worldDanceMotionAllowed({worldDance:false,reduceMotion:'off'},true)).toBe(false);
 expect(worldDanceMotionAllowed({worldDance:false},false)).toBe(false);
 expect(worldDanceMotionAllowed({},true)).toBe(false);
});

test('the SAME accent moves more in a loud chorus than a quiet bridge',()=>{
 const quiet=new WorldDanceEnvelope(),loud=new WorldDanceEnvelope();
 quiet.pulse=loud.pulse=0.82;
 quiet.intensity=0.06;loud.intensity=0.95;
 expect(loud.strength).toBeGreaterThan(quiet.strength*3);
 expect(loud.strength).toBeLessThanOrEqual(1);
 expect(quiet.strength).toBeGreaterThan(0);
});

test('biomes get different bounded personalities with no fake colour or geometry inputs',()=>{
 const candy=biomeDanceStyle('candy-stripes',0.7);
 const stars=biomeDanceStyle('stars',0.7);
 const jelly=biomeDanceStyle('jellyfish',0.7);
 expect(candy.decor).toBeGreaterThan(jelly.decor);
 expect(jelly.decor).toBeGreaterThan(stars.decor);
 expect(candy.sun).toBeGreaterThan(stars.sun);
 expect(biomeDanceStyle('dew-drops',0).decor).toBe(0);
 expect(biomeDanceStyle('brass-pipes',Infinity).sun).toBe(0);
 for(const style of [candy,stars,jelly,biomeDanceStyle('vents',900)])
  for(const v of Object.values(style))expect(v>=0&&v<=1).toBe(true);
});

test('sun squash is bounded and neutral at zero/invalid input',()=>{
 expect(sunDanceGeometry(0)).toEqual({widthRadius:40,heightRadius:40});
 const kick=sunDanceGeometry(1);
 expect(kick.widthRadius).toBeCloseTo(44.8);
 expect(kick.heightRadius).toBeCloseTo(36.4);
 expect(sunDanceGeometry(1000)).toEqual(kick);
 expect(sunDanceGeometry(NaN)).toEqual(sunDanceGeometry(0));
});

test('the actual procedural sun is ellipse-shaped on musical hit and original circle at silence',()=>{
 const {scene,calls}=gfxScene();const bg=new Background(scene,green);
 bg.update(10,500,200,0);
 const still=calls.find(x=>x[0]==='strokeCircle'&&x[3]===40);
 expect(still).toBeDefined();
 expect(calls.some(x=>x[0]==='strokeEllipse')).toBe(false);
 calls.length=0;
 bg.update(10,500,200,1);
 const moving=calls.find(x=>x[0]==='strokeEllipse');
 expect(moving).toBeDefined();
 expect(moving[3]).toBeCloseTo(89.6,2);
 expect(moving[4]).toBeCloseTo(72.8,2);
 expect(calls.some(x=>x[0]==='strokeCircle'&&x[3]===40)).toBe(false);
});

test.each(['candy-stripes','jellyfish','dew-drops'])('%s decor dances but old neutral geometry is deterministic',motif=>{
 const neutral=motifDecor(motif,500,3000,0,{dance:0});
 const replay=motifDecor(motif,500,3000,0);
 const moving=motifDecor(motif,500,3000,0,{dance:1});
 expect(neutral).toEqual(replay);
 expect(moving).not.toEqual(neutral);
 expect(moving.every(d=>d.color!=='danger')).toBe(true);
});

test('AudioSynth exposes only real, currently playing, non-muted soundtrack analyser energy',()=>{
 const s=Object.create(AudioSynth.prototype);
 let polls=0;
 const mixer={energy(){polls++;return {bass:.42,mid:.22,treble:.88};}};
 s.ctx={currentTime:3.0,state:'running'};
 s._stemMusic={started:true,transportPaused:false,track:{id:'source'},pack:{id:'source'},
  clockStart:0,_token:8,activeNodes:{size:6},songEnabled:{source:true},mixer};
 s._destroyed=false;s._musicMode='run';s._paused=false;
 s._musicWanted=true;s.settings={masterVolume:1,musicVolume:1};
 s._vinylAudible=()=>true;s.getFatalCountInStatus=()=>({active:false});
 const first=s.getWorldDanceSample();
 expect(first).toMatchObject({bass:.42,mid:.22,timeMs:3000});
 expect(polls).toBe(1);
 s.ctx.currentTime=3.02;
 expect(s.getWorldDanceSample()).toBe(first);
 expect(polls).toBe(1);
 s.ctx.currentTime=3.05;
 expect(s.getWorldDanceSample()).not.toBe(first);
 expect(polls).toBe(2);
 s.settings.musicVolume=0;s._vinylAudible=()=>false;
 expect(s.getWorldDanceSample()).toBeNull();expect(polls).toBe(2);
 s.settings.musicVolume=1;s._vinylAudible=()=>true;
 s._paused=true;expect(s.getWorldDanceSample()).toBeNull();
 s._paused=false;s.getFatalCountInStatus=()=>({active:true});
 expect(s.getWorldDanceSample()).toBeNull();
 s.getFatalCountInStatus=()=>({active:false});s._stemMusic.transportPaused=true;
 expect(s.getWorldDanceSample()).toBeNull();
});
