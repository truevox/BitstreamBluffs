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
import { parseGhostLink, parseGhostFile, GhostLinkError, GHOST_LINK_MAX_URL, GHOST_FILE_MAX_BYTES } from '../systems/ghost/GhostLink.js';
import { decodeTrace, tracePose, TRACE_EVERY } from '../systems/ghost/GhostTape.js';
import { SIM_TICK_HZ } from '../systems/SimClock.js';
import { REG, PIXELS_PER_METER, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import {guestPracticeEligible} from '../systems/ghost/GuestPractice.js';

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
/** Only compare traces recorded under the same course and mode rules.
 * Sharing a seed alone does not make Daily and Normal runs equivalent. */
export function sameGuestCourse(guest,local){
 if(!guest||!local)return false;
 return guest.seed===local.seed&&guest.biomeMask===local.biomeMask&&
  guest.simRevision===local.simRevision&&guest.mode===local.mode&&
  (guest.dailyRuleId||'')===(local.dailyRuleId||'')&&
  (guest.dailyRuleSource||'')===(local.dailyRuleSource||'');
}
/** Prefer meaningful current local roles, not a stale favorite masquerading as Latest. */
export function comparableLocalGhost(guest, candidates){
 const matching=Array.isArray(candidates)?candidates.filter(g=>g?.tape&&sameGuestCourse(guest,g.tape)):[];
 const has=(g,role)=>Array.isArray(g.roles)&&g.roles.includes(role);
 const chosen=matching.find(g=>has(g,'best'))||matching.find(g=>has(g,'latest'))||
  matching.find(g=>Array.isArray(g.roles)&&g.roles.some(r=>/^fav[012]$/.test(r)));
 if(!chosen)return null;
 const role=has(chosen,'best')?'BEST':has(chosen,'latest')?'LATEST':'FAVORITE';
 return {tape:chosen.tape,role};
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
 if(e.code==='corrupt-link'||e.code==='corrupt-file'||e.code==='bad-gzip'||e.code==='invalid-json')
  return 'GHOST DATA DAMAGED - NOT IMPORTED';
 return 'INVALID GHOST LINK - NOTHING IMPORTED';
}
/**
 * @param {Phaser.Scene} scene
 * @param {object} theme
 * @param {{onClose:()=>void, initial?:string,onPractice?:(tape:object)=>void}} o
 */
export class GhostLinkView extends View {
 constructor(scene,theme,o){
  super(scene,theme,{w:420,h:232,y:18,title:'GUEST GHOST // UNVERIFIED',color:'magenta',
   onClose:o.onClose,hints:[{keys:['CTRL+ENTER'],label:'PREVIEW'},{keys:['CTRL+ALT+ENTER','PAD LB'],label:'RACE'}]});
  this.preview=null;
  this.localPreview=null;
  this.localRole=null;
  this.tape=null;
  this.cursor=0;
  this.busy=false;
  this.token=0;
  this.playing=false;
  this.elapsedMs=0;
  this.practiceArmed=false;
  this.onPractice=o.onPractice||null;
  this.status=new NeonText(scene,theme,12,24,
   'PASTE A LINK. NOTHING IS SAVED OR SUBMITTED.',{color:'cyan',outline:'none'});
  this.panel.add(this.status);
  this.box=new DomTextBox(scene,theme,{
   x:this.panel.x+PLOT.x,y:this.panel.y+39,w:394,h:45,maxLength:GHOST_LINK_MAX_URL,
   multiline:true,value:o.initial||'',placeholder:'PASTE GHOST LINK HERE (CTRL+V)',
   color:'magenta',onSubmit:()=>this.inspect(),onCancel:()=>this.close(),
   onChange:()=>this._inputChanged(),
   onShortcut:(e)=>{
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='ArrowRight'){this.scrub(1);return true;}
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='ArrowLeft'){this.scrub(-1);return true;}
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='Enter'){this.togglePlayback();return true;}
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.key==='Enter'){this.startGuestPractice();return true;}
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
  this.practiceBtn=new Button(scene,theme,{x:302,y:185,w:106,h:16,
   label:'RACE GUEST',color:'amber',onClick:()=>this.startGuestPractice()});
  this.practiceBtn.setDisabled(true);
  this.panel.add(this.practiceBtn);
  this.fileBtn=new Button(scene,theme,{x:12,y:207,w:116,h:16,
   label:'OPEN .BBGHOST',color:'cyan',onClick:()=>this.fileInput?.click()});
  this.panel.add(this.fileBtn);
  this._onUpdate=(_,delta)=>{this._tickPlayback(delta);this._positionFileInput();};
  scene.events.on(Phaser.Scenes.Events.UPDATE,this._onUpdate);
  this._installFileInput();
  this._draw();
  scene.time.delayedCall(30,()=>this.alive&&this.box.focus());
 }
 /** An edit invalidates every prior candidate and any in-flight async read. */
 _inputChanged(){
  if(!this.alive)return;
  ++this.token;
  this.busy=false;
  this.preview=null;this.localPreview=null;this.localRole=null;this.tape=null;
  this.cursor=0;this.elapsedMs=0;this.playing=false;
  this.practiceArmed=false;
  this.practiceBtn?.setLabel('RACE GUEST');this.practiceBtn?.setDisabled(true);
  this.previewBtn?.setDisabled(false);
  if(this.fileInput)this.fileInput.disabled=false;
  this.playBtn?.setLabel('WATCH');
  this.meta?.setText('NO GHOST LOADED');
  this.position?.setText('PREVIEW ONLY. NOTHING WRITTEN.');
  this.status?.setText('LINK CHANGED - PRESS PREVIEW');
  this._draw();
 }
 /** All sources enter the SAME unverified visual/practice-only preview.
  * A file can never bypass the URL's strict tape allowlist or ruleset gate. */
 async _showCandidate(parsed,token){
  const model=guestPreview(parsed.tape);
   // This is a READ of the player's existing locally saved GhostLibrary.
   // A matching SIM9 course may have an authentic personal BEST/LATEST trace,
   // but the shared tape must NEVER be written into that library.
   let comparator=null,localRulesDiffer=false;
   try{
    const library=this.scene.registry.get(REG.GHOSTS);
    const all=await library?.ghostsFor(parsed.tape.seed,parsed.tape.biomeMask,{},{
     simRevision:parsed.tape.simRevision,
    });
    const chosen=comparableLocalGhost(parsed.tape,all);
    localRulesDiffer=Boolean(all?.length&&!chosen);
    if(chosen)comparator={model:guestPreview(chosen.tape),role:chosen.role};
   }catch{ /* optional local comparison never blocks guest viewing */ }
   if(!this.alive||token!==this.token)return;
   this.preview=model;
   this.localPreview=comparator?.model||null;
   this.localRole=comparator?.role||null;
   this.tape=parsed.tape;
   this.practiceBtn.setDisabled(!this.onPractice||!guestPracticeEligible(parsed.tape));
   this.status.setText(this.localPreview
    ?'UNVERIFIED GUEST VS LOCAL '+this.localRole
    :localRulesDiffer?'UNVERIFIED GUEST - LOCAL RULES DIFFER'
    :'UNVERIFIED GUEST - READ-ONLY PREVIEW');
   this.meta.setText(ellipsize(parsed.tape.seed.toUpperCase()+' MASK '+parsed.tape.biomeMask+
    '  '+Math.floor(parsed.tape.distanceM)+'M'+
    (this.localPreview?'  GUEST MAGENTA / LOCAL CYAN':''),372));
   this.cursor=0;this.elapsedMs=0;
   this._draw();
 }
 _beginInspect(message){
  // No stale valid guest may survive a failed second file/link selection.
  this.preview=null;this.localPreview=null;this.localRole=null;this.tape=null;this.cursor=0;
  this.playing=false;this.elapsedMs=0;this.playBtn.setLabel('WATCH');
  this.practiceArmed=false;this.practiceBtn.setLabel('RACE GUEST');this.practiceBtn.setDisabled(true);
  const token=++this.token;
  this.status.setText(message);
  this.meta.setText('NO GHOST LOADED');
  this.position.setText('PREVIEW ONLY. NOTHING WRITTEN.');
  this._draw();
  this.busy=true;this.previewBtn.setDisabled(true);
  if(this.fileInput)this.fileInput.disabled=true;
  return token;
 }
 _finishInspect(token){
  if(token===this.token){
   this.busy=false;
   if(this.alive){this.previewBtn.setDisabled(false);if(this.fileInput)this.fileInput.disabled=false;}
  }
 }
 async inspect(){
  if(!this.alive||this.busy)return;
  const raw=this.box.getValue().trim();
  const token=this._beginInspect('CHECKING UNTRUSTED GHOST LINK...');
  try{
   if(raw.length>GHOST_LINK_MAX_URL)throw new GhostLinkError('url-too-long');
   await this._showCandidate(await parseGhostLink(raw),token);
  }catch(e){
   if(this.alive&&token===this.token){this.status.setText(messageFor(e));this._draw();}
  }finally{this._finishInspect(token);}
 }
 /** Triggered ONLY by explicit native input selection. No URL fetch or save. */
 async _inspectFile(file){
  if(!this.alive||this.busy||!file)return;
  const token=this._beginInspect('CHECKING SELECTED LOCAL GHOST FILE...');
  try{
   if(file.size>GHOST_FILE_MAX_BYTES||file.size<=0)
    throw new GhostLinkError('oversize','Ghost file outside supported bounds');
   const raw=await file.arrayBuffer();
   if(raw.byteLength>GHOST_FILE_MAX_BYTES)throw new GhostLinkError('oversize');
   await this._showCandidate(await parseGhostFile(new Uint8Array(raw)),token);
  }catch(e){
   if(this.alive&&token===this.token){this.status.setText(messageFor(e));this._draw();}
  }finally{this._finishInspect(token);}
 }
 /** Native file chooser is keyboard/touch accessible, and its real browser
  * activation is not simulated by canvas key events or fake input change. */
 _installFileInput(){
  if(typeof document==='undefined')return;
  const input=document.createElement('input');
  input.type='file';input.accept='.bbghost';
  input.setAttribute('data-role','ghost-file-import');
  input.setAttribute('aria-label','Open local ghost file - unverified preview only');
  Object.assign(input.style,{position:'fixed',opacity:'0.003',zIndex:'60',cursor:'pointer',
   margin:'0',padding:'0',border:'0'});
  // A new file-picker action is a change of source intent. Never let a
  // previously armed CONFIRM RACE survive this native dialog, even if the
  // player cancels or the browser skips its cancel event.
  input.addEventListener('click',()=>{if(this.alive)this._disarmPractice();});
  input.addEventListener('keydown',e=>{
   e.stopPropagation();
   // Keyboard users must be able to leave a focused native file input.
   if(e.key==='Escape'){e.preventDefault();if(this.alive)this.close();}
  });
  input.addEventListener('keyup',e=>e.stopPropagation());
  input.addEventListener('keypress',e=>e.stopPropagation());
  input.addEventListener('change',()=>{
   const file=input.files?.[0];input.value='';
   if(file)this._inspectFile(file);
  });
  input.addEventListener('cancel',()=>{
   if(this.alive){
    this._disarmPractice();
    this.status.setText('FILE SELECTION CANCELLED - NOTHING IMPORTED');
   }
  });
  document.body.appendChild(input);
  this.fileInput=input;
  this._positionFileInput();
 }
 _positionFileInput(){
  const input=this.fileInput,canvas=this.scene?.game?.canvas;
  if(!this.alive||!input||!canvas||!this.panel)return;
  const r=canvas.getBoundingClientRect();
  const sx=r.width/GAME_WIDTH,sy=r.height/GAME_HEIGHT;
  input.style.left=`${r.left+(this.panel.x+12)*sx}px`;
  input.style.top=`${r.top+(this.panel.y+207)*sy}px`;
  input.style.width=`${116*sx}px`;
  input.style.height=`${16*sy}px`;
 }
 /** One initial click discloses the unranked consequences; the next click
  * starts a NEW live player-controlled practice run. Never writes the guest. */
 startGuestPractice(){
  if(!this.alive||this.busy||!this.preview||!this.tape||
     !this.onPractice||!guestPracticeEligible(this.tape))return;
  if(!this.practiceArmed){
    this.practiceArmed=true;
    this.practiceBtn.setLabel('CONFIRM RACE');
    this.status.setText('UNRANKED: NO XP / SHARDS / SAVES. SELECT AGAIN.');
    return;
  }
  this.practiceArmed=false;
  this.practiceBtn.setDisabled(true);
  this.onPractice(this.tape);
 }
 _disarmPractice(){
  if(!this.practiceArmed)return;
  this.practiceArmed=false;
  this.practiceBtn.setLabel('RACE GUEST');
  this.status.setText('UNVERIFIED GUEST - READ-ONLY PREVIEW');
 }
 scrub(direction){
  if(!this.preview||!this.alive)return;
  this._disarmPractice();
  this.cursor=Math.max(0,Math.min(this.preview.count-1,this.cursor+direction*Math.max(1,Math.ceil(this.preview.count/16))));
  this.elapsedMs=this.cursor*SAMPLE_MS;
  this._draw();
 }
 togglePlayback(){
  this._disarmPractice();
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
  if(action==='shop'){this.startGuestPractice();return true;}
  return true;
 }
 destroy(){
  ++this.token;
  this.practiceArmed=false;
  this.preview=null;this.localPreview=null;this.localRole=null;this.tape=null;this.playing=false;
  this.scene.events.off(Phaser.Scenes.Events.UPDATE,this._onUpdate);
  this.fileInput?.remove();this.fileInput=null;
  this.box?.destroy();this.box=null;
  super.destroy();
 }
}
