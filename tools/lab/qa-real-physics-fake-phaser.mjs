/** #122 browser Worker QA-only Phaser shell. Physics is Phaser's own Matter 0.20 fork.
 * This module is selected via an exact Vite `phaser` alias in the QA build ONLY;
 * production Phaser imports and production game boot are unchanged.
 */
import Matter from 'phaser/src/physics/matter-js/CustomMain.js';
const Scene=class {constructor(key){this.sys={settings:{key},isActive:()=>true};}};
const GameObjects=new Proxy({}, {get:()=>class {}});
const Phaser={
 Scene,GameObjects,Physics:{Matter:{Matter}},
 Renderer:{WebGL:{Pipelines:{PostFXPipeline:class{}}}},
 BlendModes:{ADD:1,NORMAL:0,MULTIPLY:2,SCREEN:3},
 Scenes:{Events:{UPDATE:'update',SHUTDOWN:'shutdown',DESTROY:'destroy'}},
 Math:{Between:a=>a,Clamp:(v,a,b)=>Math.min(b,Math.max(a,v))},
 Display:{Color:{HexStringToColor:()=>({color:0}),IntegerToColor:()=>({rgba:''})}},
 Geom:new Proxy({}, {get:()=>class{}}),
};
export default Phaser;
