/**
 * #69 explicit, read-only incoming Ghost-in-a-Link preview. No fetch, storage,
 * official record, wallet action or live RunScene is reachable from here.
 * The caller, never location.hash or page startup, decides when to open it.
 */
import Phaser from 'phaser';
import { View } from './View.js';
import { DomTextBox } from './DomTextBox.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { ellipsize } from './PixelFont.js';
import { isReducedMotion } from './Motion.js';
import { parseGhostLink, GhostLinkError, GHOST_LINK_MAX_URL } from '../systems/ghost/GhostLink.js';
import { decodeTrace, tracePose, TRACE_EVERY } from '../systems/ghost/GhostTape.js';
import { SIM_TICK_HZ } from '../systems/SimClock.js';
import { REG, PIXELS_PER_METER } from '../constants.js';

const PLOT={x:12,y:94,w:394,h:54};
const MAX_PLOT_STEPS=300;
const SAMPLE_MS=1000*TRACE_EVERY/SIM_TICK_HZ;

/** Draw-only model. No implicit authorization to place the tape in GhostLibrary. */
export function guestPreview(tape){
 const trace=decodeTrace(tape);
 const count=Math.floor(trace.length/3);
 if(!count)throw new Error('Ghost has no trace');
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(let i=0;i<count;i++){
  const x=trace[i*3],y=trace[i*3+1],angle=trace[i*3+2];
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(angle)||
   Math.abs(x)>1e10||Math.abs(y)>1e10||Math.abs(angle)>1e10)
   throw new Error('Invalid ghost coordinates');
  minX=Math.min(minX,x);maxX=Math.max(maxX,x);
  minY=Math.min(minY,y);maxY=Math.max(maxY,y);
 }
 return {trace,count,minX,maxX,minY,maxY};
}
/** Visual distance gap only; never a trusted score or physical replay verdict. */
export function visualGuestGapM(guest,local,tick){
 if(!guest||!local)return null;
 const g=tracePose(guest.trace,tick),l=tracePose(local.trace,tick);
 if(!g||!l)return null;
 return Math.round((g.x-l.x)/PIXELS_PER_METER);
}
function messageFor(e){
 if(!(e instanceof GhostLinkError))return 'INVALID OR UNSUPPORTED GHOST DATA';
 if(e.code==='url-too-long'||e.code==='oversize')return 'GHOST LINK TOO LARGE - NOT IMPORTED';
 if(e.code==='unsupported-ruleset'||e.code==='unsupported-tape'||e.code==='unsupported-link')
  return 'INCOMPATIBLE GHOST OR GAME VERSION';
 if(e.code==='corrupt-link'||e.code==='bad-gzip'||e.code==='invalid-json')
  return 'GHOST LINK DAMAGED - NOT IMPORTED';
 return 'INVALID GHOST LINK - NOTHING IMPORTED';
}
/**
 * @param {Phaser.Scene} scene
 * @param {object} theme
 * @param {{onClose:()=>void, initial?:string}} o
 */
export class GhostLinkView extends View {
 constructor(scene,theme,o){
  super(scene,theme,{w:420,h:208,y:31,title:'GUEST GHOST // UNVERIFIED',color:'magenta',
   onClose:o.onClose,hints:[{keys:['CTRL+ENTER'],label:'PREVIEW'},{keys:['CTRL+←/→'],label:'SCRUB'}]});
  this.preview=null;
  this.localPreview=null;
  this.localRole=null;
  this.tape=null;
  this.cursor=0;
  this.busy=false;
  this.token=0;
  this.playing=false;
  this.elapsedMs=0;
  this.status=new NeonText(scene,theme,12,24,
   'PASTE A LINK. NOTHING IS SAVED OR SUBMITTED.',{color:'cyan',outline:'none'});
  this.panel.add(this.status);
  this.box=new DomTextBox(scene,theme,{
   x:this.panel.x+PLOT.x,y:this.panel.y+39,w:394,h:45,maxLength:GHOST_LINK_MAX_URL,
   multiline:true,value:o.initial||'',placeholder:'PASTE GHOST LINK HERE (CTRL+V)',
   color:'magenta',onSubmit:()=>this.inspect(),onCancel:()=>this.close(),
   onShortcut:(e)=>{
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='ArrowRight'){this.scrub(1);return true;}
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='ArrowLeft'){this.scrub(-1);return true;}
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='Enter'){this.togglePlayback();return true;}
    return false;
   },
  });
  this.plot=scene.add.graphics();this.panel.add(this.plot);
  this.meta=new NeonText(scene,theme,12,155,'NO GHOST LOADED',{color:'amber',outline:'none'});
  this.panel.add(this.meta);
  this.position=new NeonText(scene,theme,12,168,
   'PREVIEW ONLY. NO SCORE / REWARD / GHOST SAVE.',{color:'text',outline:'none'});
  this.panel.add(this.position);
  this.previewBtn=new Button(scene,theme,{x:12,y:185,w:105,h:16,
   label:'PREVIEW LINK',color:'lime',onClick:()=>this.inspect()});
  this.panel.add(this.previewBtn);
  this.prevBtn=new Button(scene,theme,{x:126,y:185,w:38,h:16,
   label:'<<',color:'cyan',onClick:()=>this.scrub(-1)});
  this.panel.add(this.prevBtn);
  this.nextBtn=new Button(scene,theme,{x:170,y:185,w:38,h:16,
   label:'>>',color:'cyan',onClick:()=>this.scrub(1)});
  this.panel.add(this.nextBtn);
  this.playBtn=new Button(scene,theme,{x:215,y:185,w:81,h:16,
   label:'WATCH',color:'magenta',onClick:()=>this.togglePlayback()});
  this.panel.add(this.playBtn);
  this._onUpdate=(_,delta)=>this._tickPlayback(delta);
  scene.events.on(Phaser.Scenes.Events.UPDATE,this._onUpdate);
  this._draw();
  scene.time.delayedCall(30,()=>this.alive&&this.box.focus());
 }
 async inspect(){
  if(!this.alive||this.busy)return;
  // A failed second link must not leave the prior good preview on screen.
  this.preview=null;this.localPreview=null;this.localRole=null;this.tape=null;this.cursor=0;
  this.playing=false;this.elapsedMs=0;this.playBtn.setLabel('WATCH');
  const token=++this.token;
  const raw=this.box.getValue().trim();
  this.status.setText('CHECKING UNTRUSTED GHOST LINK...');
  this.meta.setText('NO GHOST LOADED');
  this.position.setText('PREVIEW ONLY. NOTHING WRITTEN.');
  this._draw();
  if(raw.length>GHOST_LINK_MAX_URL){this.status.setText('GHOST LINK TOO LARGE - NOT IMPORTED');return;}
  this.busy=true;this.previewBtn.setDisabled(true);
  try{
   const parsed=await parseGhostLink(raw);
   const model=guestPreview(parsed.tape);
   // This is a READ of the player's existing locally saved GhostLibrary.
   // A matching SIM9 course may have an authentic personal BEST/LATEST trace,
   // but the shared tape must NEVER be written into that library.
   let comparator=null;
   try{
    const library=this.scene.registry.get(REG.GHOSTS);
    const all=await library?.ghostsFor(parsed.tape.seed,parsed.tape.biomeMask,{},{
     simRevision:parsed.tape.simRevision,
    });
    const best=all?.find(g=>g.roles.includes('best'));
    const latest=all?.find(g=>g.roles.includes('latest'));
    const chosen=best||latest||all?.[0];
    if(chosen)comparator={model:guestPreview(chosen.tape),
     role:chosen.roles.includes('best')?'BEST':'LATEST'};
   }catch{ /* optional local comparison never blocks guest viewing */ }
   if(!this.alive||token!==this.token)return;
   this.preview=model;
   this.localPreview=comparator?.model||null;
   this.localRole=comparator?.role||null;
   this.tape=parsed.tape;
   this.status.setText(this.localPreview
    ?'UNVERIFIED GUEST VS LOCAL '+this.localRole
    :'UNVERIFIED GUEST - READ-ONLY PREVIEW');
   this.meta.setText(ellipsize(parsed.tape.seed.toUpperCase()+' MASK '+parsed.tape.biomeMask+
    '  '+Math.floor(parsed.tape.distanceM)+'M'+
    (this.localPreview?'  GUEST MAGENTA / LOCAL CYAN':''),372));
   this.cursor=0;this.elapsedMs=0;
   this._draw();
  }catch(e){
   if(!this.alive||token!==this.token)return;
   this.status.setText(messageFor(e));
   this._draw();
  }finally{
   if(token===this.token){this.busy=false;if(this.alive)this.previewBtn.setDisabled(false);}
  }
 }
 scrub(direction){
  if(!this.preview||!this.alive)return;
  this.cursor=Math.max(0,Math.min(this.preview.count-1,this.cursor+direction*Math.max(1,Math.ceil(this.preview.count/16))));
  this.elapsedMs=this.cursor*SAMPLE_MS;
  this._draw();
 }
 togglePlayback(){
  if(!this.preview||!this.alive){
   this.status.setText('PREVIEW A GHOST LINK BEFORE WATCHING');
   return;
  }
  if(isReducedMotion(this.scene)){
   this.playing=false;
   this.playBtn.setLabel('WATCH');
   this.status.setText('REDUCED MOTION: SCRUB INSTEAD');
   return;
  }
  if(this.playing){
   this.playing=false;
   this.playBtn.setLabel('WATCH');
   this.status.setText('UNVERIFIED GUEST - READ-ONLY PREVIEW');
   return;
  }
  if(this.cursor>=this.preview.count-1){this.cursor=0;this.elapsedMs=0;}
  this.playing=true;
  this.playBtn.setLabel('PAUSE');
  this.status.setText('LOCAL TRACE PLAYBACK - NO LIVE GAMEPLAY');
 }
 _tickPlayback(delta){
  if(!this.playing||!this.preview||!this.alive)return;
  if(isReducedMotion(this.scene)){
   this.playing=false;
   this.playBtn.setLabel('WATCH');
   this.status.setText('REDUCED MOTION: SCRUB INSTEAD');
   return;
  }
  this.elapsedMs+=Math.max(0,Math.min(Number(delta)||0,120));
  const next=Math.min(this.preview.count-1,Math.floor(this.elapsedMs/SAMPLE_MS));
  if(next!==this.cursor){this.cursor=next;this._draw();}
  if(next===this.preview.count-1){
   this.playing=false;this.playBtn.setLabel('WATCH');
   this.status.setText('GUEST TRACE ENDED - UNVERIFIED');
  }
 }
 _draw(){
  if(!this.plot||!this.alive)return;
  const g=this.plot,c=this.theme.color('cyan'),m=this.theme.color('magenta');
  g.clear().fillStyle(this.theme.color('bg'),.85).fillRect(PLOT.x,PLOT.y,PLOT.w,PLOT.h);
  g.lineStyle(1,c,.55).strokeRect(PLOT.x,PLOT.y,PLOT.w,PLOT.h);
  if(!this.preview)return;
  const v=this.preview,local=this.localPreview;
  const minX=Math.min(v.minX,local?.minX??v.minX);
  const minY=Math.min(v.minY,local?.minY??v.minY);
  const maxX=Math.max(v.maxX,local?.maxX??v.maxX);
  const maxY=Math.max(v.maxY,local?.maxY??v.maxY);
  const toPoint=(model,i)=>({
   x:PLOT.x+7+(model.trace[i*3]-minX)/Math.max(1,maxX-minX)*(PLOT.w-14),
   y:PLOT.y+6+(model.trace[i*3+1]-minY)/Math.max(1,maxY-minY)*(PLOT.h-12),
  });
  const line=(model,color,alpha)=>{
   const stride=Math.max(1,Math.ceil(model.count/MAX_PLOT_STEPS));
   g.lineStyle(1,color,alpha).beginPath();
   let first=true;
   for(let i=0;i<model.count;i+=stride){
    const p=toPoint(model,i);
    if(first){g.moveTo(p.x,p.y);first=false;}
    else g.lineTo(p.x,p.y);
   }
   const last=toPoint(model,model.count-1);
   g.lineTo(last.x,last.y).strokePath();
  };
  if(local)line(local,c,.7);
  line(v,m,1);
  const here=toPoint(v,this.cursor);
  g.fillStyle(m,1).fillCircle(here.x,here.y,2.5);
  const tick=(this.cursor+1)*TRACE_EVERY;
  let gap='';
  const metres=visualGuestGapM(v,local,tick);
  if(metres!==null){
   gap='  GAP '+(metres>0?'+':'')+metres+'M';
   const localHere=toPoint(local,Math.min(local.count-1,this.cursor));
   g.fillStyle(c,1).fillCircle(localHere.x,localHere.y,2.5);
  }
  this.position.setText(ellipsize('GUEST '+Math.min(tick,this.tape.endTick)+'/'+this.tape.endTick+
   ' TICKS'+gap+'  UNRANKED',380));
 }
 handleAction(action){
  if(action==='cancel'){this.close();return true;}
  if(action==='left'||action==='right'){this.scrub(action==='left'?-1:1);return true;}
  if(action==='confirm'){this.inspect();return true;}
  if(action==='alt'){this.togglePlayback();return true;}
  return true;
 }
 destroy(){
  ++this.token;
  this.preview=null;this.localPreview=null;this.localRole=null;this.tape=null;this.playing=false;
  this.scene.events.off(Phaser.Scenes.Events.UPDATE,this._onUpdate);
  this.box?.destroy();this.box=null;
  super.destroy();
 }
}
