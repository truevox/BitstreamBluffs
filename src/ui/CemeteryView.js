/** #68 visual-only local graveyard montage. No Matter bodies, input replay,
 * public verification, account, score changes or network. The archive stores
 * only opaque recent run pose traces, not the five GhostLibrary role tapes.
 */
import {View} from './View.js';
import {NeonText} from './Neon.js';
import {Button} from './Button.js';
import {isReducedMotion,onTick} from './Motion.js';
import {cemeteryFrame,CemeteryArchive,CEMETERY_CAPTURE_STATUS_KEY} from '../systems/ghost/CemeteryArchive.js';
import {CEMETERY_RENDER_LIMIT,CEMETERY_MAX_ATTEMPTS} from '../systems/ghost/CemeteryPolicy.js';
import {decodeTrace} from '../systems/ghost/GhostTape.js';
import {uiSfx} from './Sound.js';

const HZ=120;
const X0=18,X1=428,Y0=65,Y1=176;
const norm=(v,a,b,lo,hi)=>lo+(b>a?(v-a)/(b-a):0.5)*(hi-lo);

export class CemeteryView extends View{
 constructor(scene,theme,{tape,onClose,archive=new CemeteryArchive()}={}){
  super(scene,theme,{w:448,h:230,title:'GHOST GRAVEYARD',color:'magenta',onClose,
    hints:[{keys:['←','→'],label:'SCRUB'},{keys:['ENTER'],label:'PLAY'}]});
  this.archive=archive;
  this.tape=tape;
  this.entries=[];
  this.maxTick=0;
  this.tick=0;
  this.playing=!isReducedMotion(scene);
  this._elapsed=0;
  this._loaded=false;
  this._winner=null;
  this._bounds=null;
  this.focus=0;this._clearArmedAt=0;this._clearing=false;
  this.paths=scene.add.graphics();this.panel.add(this.paths);
  this.gfx=scene.add.graphics();this.panel.add(this.gfx);
  const text=(x,y,value,color='text')=>this.panel.add(new NeonText(scene,theme,x,y,value,{color,outline:'none'}));
  text(12,24,'PRIVATE POSE TRACES - NO INPUTS / UPLOAD','cyan');
  text(12,35,'CURRENT COURSE ONLY. 0 IN SETTINGS ERASES.', 'text');
  this.status=new NeonText(scene,theme,12,47,'READING THIS DEVICE...', {color:'lime',outline:'none'});
  this.panel.add(this.status);
  this.timeline=new NeonText(scene,theme,12,190,'', {color:'cyan',outline:'none'});
  this.panel.add(this.timeline);
  this.playBtn=new Button(scene,theme,{x:12,y:205,w:66,h:16,label:'PAUSE',color:'lime',onClick:()=>{this.focus=0;this._markFocus();this.togglePlay();}});
  this.panel.add(this.playBtn);
  text(87,209,'SCRUB. BEST GLOWS.','text');
  this.clearBtn=new Button(scene,theme,{x:296,y:205,w:68,h:16,label:'CLEAR',color:'magenta',
    onClick:()=>{this.focus=1;this._markFocus();this.clearSelected();}});
  this.panel.add(this.clearBtn);this._markFocus();
  this._stopTick=onTick(scene,(_time,delta)=>this._update(delta));
  this._load();
 }
 async _load(){
  const rows=await this.archive.list(this.tape?.seed,this.tape?.biomeMask||0);
  if(!this.alive)return;
  // Decode once per entry, never every rendered frame: dozens of long
  // traces should remain practical on Chromebook-class hardware.
  const winner=rows.reduce((best,row)=>!best||row.distanceM>best.distanceM?row:best,null);
  const visible=rows.slice(0,CEMETERY_RENDER_LIMIT);
  // Include the longest retained run even if it is older than the last twelve.
  if(winner&&visible.length===CEMETERY_RENDER_LIMIT&&!visible.some(row=>row.key===winner.key))
   visible[visible.length-1]=winner;
  this.entries=visible.map(row=>({...row,points:decodeTrace(row)}));
  this._loaded=true;
  this.maxTick=Math.max(0,...this.entries.map(r=>r.endTick));
  this._winner=winner;
  if(!rows.length){this.playing=false;this.status.setText('NO SAVED POSE TRACES YET');
   this.timeline.setText('SET PAST ATTEMPTS IN SETTINGS TO COLLECT.');
   this.playBtn.setDisabled(true);this.clearBtn.setDisabled(true);
   this._captureNotice();return;}
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const row of this.entries){
   const points=row.points;
   for(let i=0;i+2<points.length;i+=3){
    minX=Math.min(minX,points[i]);maxX=Math.max(maxX,points[i]);
    minY=Math.min(minY,points[i+1]);maxY=Math.max(maxY,points[i+1]);
   }
  }
  this._bounds={minX,maxX,minY,maxY};
  if(isReducedMotion(this.scene)){this.playing=false;this.tick=this.maxTick;}
  this.status.setText(`${rows.length} STORED / ${CEMETERY_MAX_ATTEMPTS} MAX  ${this.entries.length} SHOWN - LOCAL`);
  this._captureNotice();
  this.playBtn.setLabel(this.playing?'PAUSE':'PLAY');
  this._drawPaths();this._draw();
 }
 _captureNotice(){
  const result=this.scene?.registry?.get?.(CEMETERY_CAPTURE_STATUS_KEY);
  if(result?.runId!==this.tape?.runId)return;
  if(result?.pending===true)this.status.setText('SAVING LATEST POSE LOCALLY...');
  else if(result?.ok===false){
   const message=result.code==='quota-exceeded'||result.code==='trace-exceeds-budget'
    ?'LATEST POSE NOT SAVED: STORAGE LIMIT'
    :'LATEST POSE NOT SAVED: STORAGE UNAVAILABLE';
   this.status.setText(message);
  }
 }
 _update(delta){
  if(!this.alive||!this._loaded||!this.entries.length||!this.playing)return;
  if(isReducedMotion(this.scene)){
   this.playing=false;this.playBtn.setLabel('SCRUB');this.tick=this.maxTick;this._draw();return;
  }
  this.tick=Math.min(this.maxTick,this.tick+Math.min(Math.max(delta||0,0),100)*HZ/1000);
  this._elapsed+=Math.min(Math.max(delta||0,0),100);
  if(this.tick>=this.maxTick){this.playing=false;this.playBtn.setLabel('REPLAY');}
  if(this._elapsed>=70||this.tick>=this.maxTick){this._elapsed=0;this._draw();}
 }
 _drawPaths(){
  if(!this._bounds||!this.paths)return;
  const g=this.paths,p=this.theme.pal,{minX,maxX,minY,maxY}=this._bounds;
  const px=x=>norm(x,minX,maxX,X0,X1),py=y=>norm(y,minY,maxY,Y0,Y1);
  g.clear();
  g.lineStyle(1,p.cyan,0.13).lineBetween(X0,Y1+5,X1,Y1+5);
  // Static visual paths are painted ONCE; only rider poses move during playback.
  for(const row of this.entries){
   const trace=row.points,n=trace.length/3;
   if(n<2)continue;
   const winner=row.runId===this._winner?.runId;
   g.lineStyle(winner?2:1,winner?p.lime:p.magenta,winner?0.32:0.12);
   const stride=Math.max(1,Math.ceil(n/40));
   for(let i=stride;i<n;i+=stride){
    const a=(i-stride)*3,b=i*3;
    g.lineBetween(px(trace[a]),py(trace[a+1]),px(trace[b]),py(trace[b+1]));
   }
  }
 }
 _draw(){
  if(!this.alive||!this._bounds||!this.gfx)return;
  const g=this.gfx,p=this.theme.pal,{minX,maxX,minY,maxY}=this._bounds;
  const px=x=>norm(x,minX,maxX,X0,X1),py=y=>norm(y,minY,maxY,Y0,Y1);
  g.clear();
  const frame=cemeteryFrame(this.entries,this.tick);
  let present=0,fallen=0;
  for(const {runId,pose,died} of frame){
   const champion=runId===this._winner?.runId;
   const color=champion?p.lime:p.magenta,alpha=champion?0.92:died?0.27:0.61;
   const x=px(pose.x),y=py(pose.y),c=Math.cos(pose.angle),s=Math.sin(pose.angle);
   const dx=8*c,dy=8*s;
   g.lineStyle(champion?3:2,color,alpha).lineBetween(x-dx,y-dy,x+dx,y+dy);
   g.fillStyle(color,alpha).fillCircle(x,y-5,champion?3:2);
   if(died){fallen++;g.lineStyle(1,color,alpha*0.7).lineBetween(x-3,y+3,x+3,y+9).lineBetween(x+3,y+3,x-3,y+9);}
   else present++;
  }
  this.timeline.setText(`${(this.tick/HZ).toFixed(1)}S / ${(this.maxTick/HZ).toFixed(1)}S   ${present} RIDING  ${fallen} FALLEN`);
 }
 _markFocus(){
  this.playBtn?.setHover(this.focus===0);this.clearBtn?.setHover(this.focus===1);
 }
 _disarmClear(){
  this._clearArmedAt=0;if(this.clearBtn)this.clearBtn.setLabel('CLEAR');
 }
 async clearSelected(){
  if(!this._loaded||!this.entries.length||this._clearing)return;
  const now=Date.now();
  if(!this._clearArmedAt||now-this._clearArmedAt>4000){
   this._clearArmedAt=now;this.clearBtn.setLabel('CONFIRM?');
   this.status.setText('PRESS CLEAR AGAIN: THIS COURSE ONLY');
   return;
  }
  this._disarmClear();this._clearing=true;this.clearBtn.setDisabled(true);
  const result=await this.archive.clearCourse(this.tape.seed,this.tape.biomeMask||0);
  if(!this.alive)return;
  this._clearing=false;
  if(!result.ok){
   this.clearBtn.setDisabled(false);this.status.setText('COULD NOT CLEAR LOCAL POSES');return;
  }
  this.entries=[];this._bounds=null;this._winner=null;this.playing=false;this._loaded=true;
  this.maxTick=0;this.tick=0;this.gfx.clear();this.paths.clear();
  this.playBtn.setDisabled(true);this.clearBtn.setDisabled(true);
  this.status.setText('POSES CLEARED FROM THIS COURSE ONLY');
  this.timeline.setText('FIVE GHOST ROLES / PROTECTED EVIDENCE UNAFFECTED.');
 }
 scrub(direction){
  if(!this._loaded||!this.entries.length)return;
  this._disarmClear();
  this.playing=false;this.playBtn.setLabel('PLAY');
  this.tick=Math.max(0,Math.min(this.maxTick,this.tick+direction*HZ));
  this._draw();uiSfx(this.scene,'uiMove');
 }
 togglePlay(){
  if(!this._loaded||!this.entries.length)return;
  this._disarmClear();
  if(isReducedMotion(this.scene)){
   this.playing=false;this.playBtn.setLabel('SCRUB');this.status.setText('REDUCED MOTION: MANUAL SCRUB ONLY');return;
  }
  if(this.tick>=this.maxTick)this.tick=0;
  this.playing=!this.playing;this.playBtn.setLabel(this.playing?'PAUSE':'PLAY');
  uiSfx(this.scene,'uiSelect');
 }
 handleAction(action){
  if(action==='cancel'||action==='ghost'){this.close();return true;}
  if(action==='left'){this.scrub(-1);return true;}
  if(action==='right'){this.scrub(1);return true;}
  if(action==='up'||action==='down'){this._disarmClear();this.focus=1-this.focus;this._markFocus();return true;}
  if(action==='confirm'){if(this.focus===1)this.clearSelected();else this.togglePlay();return true;}
  return true;
 }
 destroy(){this._stopTick?.();this._stopTick=null;super.destroy();}
}
