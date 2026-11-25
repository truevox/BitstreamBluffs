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
import { parseGhostLink, GhostLinkError, GHOST_LINK_MAX_URL } from '../systems/ghost/GhostLink.js';
import { decodeTrace, tracePose, TRACE_EVERY } from '../systems/ghost/GhostTape.js';
import { SIM_TICK_HZ } from '../systems/SimClock.js';

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
  const x=trace[i*3],y=trace[i*3+1];
  if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>1e10||Math.abs(y)>1e10)
   throw new Error('Invalid ghost coordinates');
  minX=Math.min(minX,x);maxX=Math.max(maxX,x);
  minY=Math.min(minY,y);maxY=Math.max(maxY,y);
 }
 return {trace,count,minX,maxX,minY,maxY};
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
   onClose:o.onClose,hints:[{keys:['CTRL+ENTER'],label:'PREVIEW'},{keys:['←','→'],label:'SCRUB'}]});
  this.preview=null;
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
  this.preview=null;this.tape=null;this.cursor=0;
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
   if(!this.alive||token!==this.token)return;
   this.preview=model;
   this.tape=parsed.tape;
   this.status.setText('UNVERIFIED GUEST - READ-ONLY PREVIEW');
   this.meta.setText(ellipsize(parsed.tape.seed.toUpperCase()+'  MASK '+parsed.tape.biomeMask+'  '+Math.floor(parsed.tape.distanceM)+'M',372));
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
  const v=this.preview,step=Math.max(1,Math.ceil(v.count/MAX_PLOT_STEPS));
  const xscale=PLOT.w-14,yscale=PLOT.h-12;
  const toPoint=i=>({
   x:PLOT.x+7+(v.trace[i*3]-v.minX)/Math.max(1,v.maxX-v.minX)*xscale,
   y:PLOT.y+6+(v.trace[i*3+1]-v.minY)/Math.max(1,v.maxY-v.minY)*yscale,
  });
  g.lineStyle(1,c,.9).beginPath();
  for(let i=0;i<v.count;i+=step){const p=toPoint(i);if(i===0)g.moveTo(p.x,p.y);else g.lineTo(p.x,p.y);}
  const last=toPoint(v.count-1);g.lineTo(last.x,last.y).strokePath();
  const here=toPoint(this.cursor);
  g.fillStyle(m,1).fillCircle(here.x,here.y,2.5);
  const tick=(this.cursor+1)*TRACE_EVERY;
  const pose=tracePose(v.trace,tick);
  this.position.setText('GUEST '+Math.min(tick,this.tape.endTick)+'/'+this.tape.endTick+' TICKS  X '+Math.round(pose?.x||0)+'  UNRANKED');
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
  this.preview=null;this.tape=null;this.playing=false;
  this.scene.events.off(Phaser.Scenes.Events.UPDATE,this._onUpdate);
  this.box?.destroy();this.box=null;
  super.destroy();
 }
}
