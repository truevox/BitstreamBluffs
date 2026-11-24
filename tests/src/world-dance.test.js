import {WorldDanceEnvelope,worldDanceMotionAllowed,sunDanceGeometry,biomeDanceStyle,visibleDanceStrength}
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
 expect(kick.widthRadius).toBeCloseTo(59.2);
 expect(kick.heightRadius).toBeCloseTo(25.6);
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
 expect(moving[3]).toBeCloseTo(118.4,2);
 expect(moving[4]).toBeCloseTo(51.2,2);
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
 expect(first).toMatchObject({bass:.42,mid:.22,treble:.88,timeMs:3000});
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

test('audition transfer lifts small accents smoothly without changing the detector or exceeding unity',()=>{
 expect(visibleDanceStrength(0)).toBe(0);
 expect(visibleDanceStrength(NaN)).toBe(0);
 expect(visibleDanceStrength(1)).toBe(1);
 expect(visibleDanceStrength(.04)).toBeGreaterThan(.14);
 expect(visibleDanceStrength(.11)).toBeGreaterThan(visibleDanceStrength(.04)*2);
 for(let i=1;i<=100;i++)expect(visibleDanceStrength(i/100)).toBeGreaterThan(visibleDanceStrength((i-1)/100));
});
test.each(['stars','candy-stripes','jellyfish','brass-pipes','dew-drops','vents'])('%s receives a distinct visible decor response at realistic accent strength',motif=>{
 const style=biomeDanceStyle(motif,.26);
 const before=motifDecor(motif,400,1234,0,{bees:false});
 const after=motifDecor(motif,400,1234,0,{bees:false,dance:style.decor,horizonDance:style.horizon});
 expect(after).toHaveLength(before.length);
 let max=0;
 for(let i=0;i<before.length;i++){
  for(const key of ['x','y','r'])if(Number.isFinite(before[i][key]))max=Math.max(max,Math.abs(after[i][key]-before[i][key]));
  for(let j=0;j<(before[i].pts||[]).length;j++){
   max=Math.max(max,Math.hypot(after[i].pts[j].x-before[i].pts[j].x,after[i].pts[j].y-before[i].pts[j].y));
  }
 }
 expect(max).toBeGreaterThan(8);
 expect(max).toBeLessThan(65);
 expect(motifDecor(motif,400,1234,0,{bees:false,dance:0,horizonDance:0})).toEqual(before);
});

test('scenery retains a readable accent independently of audio onset decay and resets immediately',()=>{
 const w=new WorldDanceEnvelope();
 w.update(audio(0,.1),40);
 const raw=w.update(audio(40,.9,.6),40);
 expect(w.visualStrength).toBeGreaterThan(raw*.6);
 const peak=w.visualStrength;
 w.update(audio(80,.9,.6),40);
 w.update(audio(120,.9,.6),40);
 expect(w.visualStrength).toBeGreaterThanOrEqual(peak);
 for(let t=160;t<=400;t+=40)w.update(audio(t,.9,.6),40);
 expect(w.visualStrength).toBeGreaterThan(w.strength);
 expect(w.update(null,16)).toBe(0);expect(w.visualStrength).toBe(0);
 w.update(audio(440,.1),40);w.update(audio(480,.9),40);
 expect(w.visualStrength).toBeGreaterThan(0);
 w.update(audio(520,.9,.1,'new'),40);expect(w.visualStrength).toBe(0);
});

test.each(['ridges','drift','terraces','currents','facets','stars','candy-stripes','jellyfish','brass-pipes','dew-drops','vents'])('%s actual ridge outlines have readable motion on a typical accent',motif=>{
 const {scene,calls}=gfxScene();
 const bg=new Background(scene,green);bg.setMotif(motif);
 const outlines=()=>{
  const out=calls.filter(c=>c[0]==='strokePoints').map(c=>c[1]);
  calls.length=0;
  return out.filter(p=>p.length>=60&&p[0].x===0);
 };
 bg.update(400,1234,0,0);const still=outlines();
 bg.update(400,1234,0,.26);const moving=outlines();
 expect(still.length).toBeGreaterThanOrEqual(2);
 expect(moving).toHaveLength(still.length);
 let max=0;
 for(let i=0;i<still.length;i++)
  for(let j=0;j<still[i].length;j++)
   max=Math.max(max,Math.abs(still[i][j].y-moving[i][j].y));
 expect(max).toBeGreaterThan(8);
 expect(max).toBeLessThanOrEqual(45);
 bg.update(400,1234,0,0);expect(outlines()).toEqual(still);
});

test('Steampunk keyed spokes visibly rock on a typical accent without moving their axles',()=>{
 const motif='brass-pipes', d=biomeDanceStyle(motif,.26).decor;
 const sample=dance=>motifDecor(motif,400,1234,0,{dance});
 const keyed=items=>items.filter(p=>p.kind==='line'&&p.depth===-1&&p.width===3);
 const still=keyed(sample(0)),moving=keyed(sample(d));
 expect(still.length).toBeGreaterThan(0);
 expect(moving).toHaveLength(still.length);
 for(let i=0;i<still.length;i++){
  const a=still[i].pts[1],b=moving[i].pts[1];
  expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThan(9);
 }
 const axles=items=>items.filter(p=>p.kind==='circle'&&p.depth===-1);
 expect(axles(sample(d))).toEqual(axles(sample(0)));
 expect(keyed(sample(0))).toEqual(still);
});

test('Jellyfish bells individually lift and squash without borrowing horizon motion',()=>{
 const motif='jellyfish', d=biomeDanceStyle(motif,.26).decor;
 const bells=dance=>motifDecor(motif,400,1234,0,{dance}).filter(p=>p.kind==='poly'&&p.depth===-1);
 const still=bells(0), moving=bells(d);
 expect(still.length).toBeGreaterThan(1);
 const lifts=[];
 for(let i=0;i<still.length;i++){
  const a=still[i].pts,b=moving[i].pts;
  const lift=a[0].y-b[0].y;
  lifts.push(lift);
  expect(lift).toBeGreaterThan(11);
  const width=pts=>Math.max(...pts.map(p=>p.x))-Math.min(...pts.map(p=>p.x));
  expect(width(b)/width(a)).toBeGreaterThan(1.2);
 }
 expect(Math.max(...lifts)-Math.min(...lifts)).toBeGreaterThan(1);
 expect(bells(0)).toEqual(still);
});

test('Candy canes boing in both directions with fixed roots and constant stem length',()=>{
 const motif='candy-stripes', d=biomeDanceStyle(motif,.26).decor;
 const canes=(dance,time)=>motifDecor(motif,400,time,0,{dance}).filter(p=>p.kind==='line'&&p.depth===0&&p.color==='text'&&p.width===3);
 const still=canes(0,1234);
 expect(still.length).toBeGreaterThan(1);
 const shifts=still.map(()=>[]);
 const stemLength=pts=>pts.slice(0,-7).slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-pts[i].x,p.y-pts[i].y),0);
 for(let k=0;k<=24;k++){
  const t=1234+k*Math.PI*2*165/24;
  const moving=canes(d,t);
  expect(moving).toHaveLength(still.length);
  for(let i=0;i<still.length;i++){
   const a=still[i].pts,b=moving[i].pts;
   expect(b).toHaveLength(a.length);
   expect(b[0]).toEqual(a[0]);
   shifts[i].push(b.at(-8).x-a.at(-8).x);
   expect(Math.abs(b[1].x-a[1].x)).toBeLessThan(2);
   expect(stemLength(b)/stemLength(a)).toBeCloseTo(1,2);
   // The curved stem bends down, never grows taller.
   expect(b.at(-8).y).toBeGreaterThanOrEqual(a.at(-8).y-1e-8);
   expect(Math.hypot(b.at(-1).x-b.at(-8).x,b.at(-1).y-b.at(-8).y)).toBeCloseTo(13,8);
  }
  expect(canes(0,t)).toEqual(still);
 }
 for(const x of shifts){
  expect(Math.max(...x)).toBeGreaterThan(15);
  expect(Math.min(...x)).toBeLessThan(-15);
 }
});

test('Candy lollipops independently hop, grow and spin without detaching from sticks',()=>{
 const motif='candy-stripes', d=biomeDanceStyle(motif,.26).decor;
 const sample=dance=>motifDecor(motif,400,1234,0,{dance});
 const pops=items=>items.filter(p=>p.kind==='circle'&&p.depth===1);
 const stems=items=>items.filter(p=>p.kind==='line'&&p.depth===1&&p.width===2);
 const spirals=items=>items.filter(p=>p.kind==='line'&&p.depth===1&&p.width===1);
 const still=sample(0), moving=sample(d), a=pops(still),b=pops(moving);
 expect(a.length).toBeGreaterThan(1);
 for(let i=0;i<a.length;i++){
  expect(a[i].y-b[i].y).toBeGreaterThan(15);
  expect(b[i].r/a[i].r).toBeGreaterThan(1.13);
  expect(stems(moving)[i].pts[0]).toEqual(stems(still)[i].pts[0]);
  expect(stems(moving)[i].pts[1]).toEqual({x:b[i].x,y:b[i].y+b[i].r});
  const angle=(p,c)=>Math.atan2(p.y-c.y,p.x-c.x);
  const delta=angle(spirals(moving)[i].pts[1],b[i])-angle(spirals(still)[i].pts[1],a[i]);
  expect(Math.abs(Math.sin(delta/2))).toBeGreaterThan(.3);
 }
 expect(sample(0)).toEqual(still);
});

test('Micro Mountain grass waves bend rooted blades and carry attached dew independently of hills',()=>{
 const motif='dew-drops', d=biomeDanceStyle(motif,.26).decor;
 const sample=(dance,time=1234)=>motifDecor(motif,400,time,0,{dance,bees:false});
 const blades=items=>items.filter(p=>p.kind==='poly'&&p.color==='lime');
 const dew=items=>items.filter(p=>p.kind==='circle'&&p.color==='cyan');
 const still=sample(0), moving=sample(d);
 const a=blades(still),b=blades(moving);
 expect(a.length).toBeGreaterThan(3);
 expect(b).toHaveLength(a.length);
 const dx=[];
 for(let i=0;i<a.length;i++){
  const x=a[i].pts,y=b[i].pts;
  expect(y[0]).toEqual(x[0]);
  expect(y.at(-1)).toEqual(x.at(-1));
  dx.push(y[5].x-x[5].x);
  expect(y[5].y-x[5].y).toBeGreaterThan(2);
 }
 expect(Math.max(...dx)).toBeGreaterThan(15);
 expect(Math.min(...dx)).toBeLessThan(-15);
 const drops=dew(still), shifted=dew(moving);
 expect(drops.length).toBeGreaterThan(1);
 expect(shifted).toHaveLength(drops.length);
 expect(Math.max(...drops.map((p,i)=>Math.hypot(p.x-shifted[i].x,p.y-shifted[i].y)))).toBeGreaterThan(8);
 for(let i=0;i<drops.length;i++)expect(shifted[i].r).toBe(drops[i].r);
 const later=blades(sample(d,1234+Math.PI*330)),laterStill=blades(sample(0,1234+Math.PI*330));
 for(let i=0;i<a.length;i++)expect(later[i].pts[5].x-laterStill[i].pts[5].x).toBeCloseTo(-dx[i],6);
 expect(sample(0)).toEqual(still);
});

test('Vertigo steam breathes in width and height independently of the terrain',()=>{
 const motif='vents', d=biomeDanceStyle(motif,.26).decor;
 const sample=dance=>motifDecor(motif,400,1234,0,{dance});
 const still=sample(0), moving=sample(d);
 expect(moving).toHaveLength(still.length);
 let plumeCount=0, maxGrowth=0, maxLift=0;
 for(let i=0;i<still.length;i++){
  const a=still[i],b=moving[i];
  expect(b.x).toBe(a.x);
  expect(b.fillAlpha).toBe(a.fillAlpha);
  if(a.color==='amber'){
   expect(b.y).toBe(a.y);
   expect(b.r).toBeGreaterThan(a.r);
  }else{
   plumeCount++;
   expect(b.r).toBeGreaterThan(a.r*1.2);
   expect(b.y).toBeLessThanOrEqual(a.y);
   maxGrowth=Math.max(maxGrowth,b.r/a.r);
   maxLift=Math.max(maxLift,a.y-b.y);
  }
 }
 expect(plumeCount).toBeGreaterThan(6);
 expect(maxGrowth).toBeGreaterThan(1.5);
 expect(maxLift).toBeGreaterThan(20);
 expect(sample(0)).toEqual(still);
});

test('Arcade sun hops and squashes without moving its horizontal centre or changing veil opacity',async()=>{
 const {BiomeFx}=await import('../../src/entities/BiomeFx.js');
 const sprite={setAlpha(v){this.alpha=v;},setScale(x,y){this.scaleX=x;this.scaleY=y;}};
 const fx=Object.create(BiomeFx.prototype);
 Object.assign(fx,{arcSun:sprite,arc:{},gridG:{clear(){}},_drawVeilBlocks(){},_veilDrawn:-1,
  bg:{danceStrength:.26},root:{visible:true},_applyVisibility(){},debut:false,gdg:false});
 for(const veil of [.75,1]){
  // Cached grid isolates actual sprite transforms from unrelated draw calls.
  fx._gridKey=Math.round((veil-.6)/.4*100)+1;
  fx.bg.danceStrength=0;fx.update(0,1234,veil,false);
  const still={...sprite};
  fx.bg.danceStrength=.26;fx.update(0,1234,veil,false);
  expect(sprite.scaleX).toBeGreaterThan(1.2);
  expect(sprite.scaleY).toBeLessThan(.85);
  expect(still.y-sprite.y).toBeGreaterThan(5);
  expect(sprite.x+56*sprite.scaleX).toBeCloseTo(still.x+56,8);
  expect(sprite.alpha).toBe(still.alpha);
  fx.update(0,1234,veil,true);
  expect(sprite).toEqual(still);
  fx.bg.danceStrength=0;fx.update(0,1234,veil,false);
  expect(sprite).toEqual(still);
 }
});

test('Arcade EQ follows independent actual bands and clears on missing sample, silence and transport changes',()=>{
 const w=new WorldDanceEnvelope();
 const sample=(timeMs,bass,mid,treble,revision='a')=>({timeMs,bass,mid,treble,revision});
 for(let i=0;i<8;i++)w.update(sample(i*50,.85,.5,.15),50);
 expect(w.skylineBands[0]).toBeGreaterThan(.9);
 expect(w.skylineBands[1]).toBeGreaterThan(.5);
 expect(w.skylineBands[2]).toBeLessThan(.1);
 for(let i=8;i<16;i++)w.update(sample(i*50,.15,.5,.85),50);
 expect(w.skylineBands[2]).toBeGreaterThan(.9);
 expect(w.skylineBands[0]).toBeLessThan(.15);
 w.update(null,16);
 expect([...w.skylineBands]).toEqual([0,0,0]);
 w.update(sample(0,.8,.8,.8,'b'),50);
 w.update(sample(50,0,0,0,'c'),50);
 expect([...w.skylineBands]).toEqual([0,0,0]);
});

test('Arcade EQ building slices wrap, stay grounded, track bands, fade and restore original art',async()=>{
 const {BiomeFx}=await import('../../src/entities/BiomeFx.js');
 const sprite=()=>({y:118,setVisible(v){this.visible=v;return this;},setAlpha(v){this.alpha=v;return this;},setScale(x,y){this.scaleX=x;this.scaleY=y;return this;}});
 const fx=Object.create(BiomeFx.prototype);
 fx.arcSkyline=sprite();fx.arcTowers=Array.from({length:40},sprite);
 fx._drawArcadeSkyline(1000,.55,[.8,.4,0]);
 expect(fx.arcSkyline.visible).toBe(false);
 expect(fx.arcTowers[0].x).toBe(-50);
 expect(fx.arcTowers[1].x).toBe(430);
 expect(fx.arcTowers[0].scaleY).toBeCloseTo(2);
 expect(fx.arcTowers[16].scaleY).toBeCloseTo(1.5);
 expect(fx.arcTowers[38].scaleY).toBeGreaterThan(1);
 const scales=()=>fx.arcTowers.filter((_,i)=>i%2===0).map(s=>s.scaleY);
 const bass=scales();
 expect(new Set(bass.map(v=>v.toFixed(2))).size).toBeGreaterThan(10);
 expect(Math.max(...bass.slice(0,7))-Math.min(...bass.slice(0,7))).toBeGreaterThan(.45);
 expect(fx.arcTowers.every((s,i)=>i%2===0||s.scaleY===fx.arcTowers[i-1].scaleY)).toBe(true);
 fx._drawArcadeSkyline(1000,.55,[0,.4,.8]);
 const treble=scales();
 expect(treble[16]).toBeGreaterThan(bass[16]+.7);
 expect(treble[0]).toBeLessThan(bass[0]-.7);
 expect(treble.every(v=>v>=1&&v<=2.25)).toBe(true);
 fx._drawArcadeSkyline(1000,.55,[.8,.4,0]);
 expect(fx.arcTowers.every(s=>s.y===118&&s.alpha===.55)).toBe(true);
 expect(fx.arcTowers.filter(s=>s.visible).length).toBeLessThanOrEqual(21);
 expect(fx.arcTowers[0].visible).toBe(false);
 expect(fx.arcTowers[1].visible).toBe(true);
 fx._drawArcadeSkyline(1000,.2,[.8,.4,0]);
 expect(fx.arcTowers.every(s=>s.alpha===.2)).toBe(true);
 fx._drawArcadeSkyline(1000,.55,null);
 expect(fx.arcSkyline.visible).toBe(true);
 expect(fx.arcSkyline.tilePositionX).toBe(50);
 expect(fx.arcTowers.every(s=>!s.visible&&s.scaleY===1)).toBe(true);
});
