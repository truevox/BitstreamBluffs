import { jest } from '@jest/globals';
import { GAME_WIDTH, GAME_HEIGHT } from '../../src/constants.js';

const FakePhaser={
 Scene:class{},
 Physics:{ Matter:{Matter:{Bodies:{rectangle:()=>({}),circle:()=>({})},Body:{}}}},
 Renderer:{WebGL:{Pipelines:{PostFXPipeline:class{}}}},
 GameObjects:{Container:class{},Graphics:class{},BitmapText:class{},Zone:class{},Image:class{},Rectangle:class{},Text:class{}},
 BlendModes:{ADD:1},Scenes:{Events:{UPDATE:'update',SHUTDOWN:'shutdown',DESTROY:'destroy'}},
 Math:{Between:a=>a,Clamp:(v,a,b)=>Math.min(b,Math.max(a,v))},
};
jest.unstable_mockModule('phaser',()=>({default:FakePhaser}));
jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js',()=>({GlitchPipeline:{install(){}}}));
const { RunScene }=await import('../../src/scenes/RunScene.js');

const cameraScenario=(speed,gap)=>{
 const s=Object.create(RunScene.prototype);
 const cam={zoom:1,scrollX:0,scrollY:0,setZoom(z){this.zoom=z}};
 Object.assign(s,{
  sled:{x:50000,y:3000,vx:speed,vy:0,speed},
  cameras:{main:cam},_camX:50000-GAME_WIDTH*.38,
  _camY:3000-GAME_HEIGHT/3,_zoom:1,_zoomKick:0,shakeAmp:0,
  bsodState:{active:true,proximity01:Math.max(0,Math.min(1,1-gap/3400)),gapPx:gap},
  bg:null,flashRect:null,blindRect:null,
 });
 for(let i=0;i<160;i++){s.sled.x+=s.sled.vx*.016;s.updateCamera(16)}
 const left=cam.scrollX+GAME_WIDTH/2-GAME_WIDTH/(2*cam.zoom);
 const riderPx=(s.sled.x-left)*cam.zoom;
 const wallPx=riderPx-gap*cam.zoom;
 return {gap,speed,riderPx,wallPx,wallFill:Math.max(0,Math.min(1,wallPx/GAME_WIDTH)),zoom:cam.zoom};
};

describe('progressive rearward BSOD framing',()=>{
 for(const speed of [300,650,1000,1400,2500]){
  test('wall grows in a visible section near contact, while rider stays on screen at speed '+speed,()=>{
   const gaps=[3400,1500,800,500,280,180,70,0];
   const states=gaps.map(gap=>cameraScenario(speed,gap));
   for(const s of states){
    expect(s.riderPx).toBeGreaterThanOrEqual(34);
    expect(s.riderPx).toBeLessThanOrEqual(GAME_WIDTH-34);
    expect(s.wallFill).toBeLessThanOrEqual(s.riderPx/GAME_WIDTH+1e-4);
   }
   expect(states.at(-1).wallFill).toBeGreaterThan(.25);
   expect(states.at(-1).wallFill).toBeLessThan(.88);
   for(let i=1;i<states.length;i++){
    expect(states[i].wallFill+1e-3).toBeGreaterThanOrEqual(states[i-1].wallFill);
   }
   expect(states[5].wallFill).toBeGreaterThan(0);
  });
 }
});
