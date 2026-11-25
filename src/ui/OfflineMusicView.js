/** Consent-first UI for an explicitly installed offline download controller.
 * No controller is installed by the shipped app yet. */
import {View} from './View.js';
import {MenuList} from './MenuList.js';
import {NeonText} from './Neon.js';
import {updateSetting} from '../services.js';
export const OFFLINE_MUSIC_CONTROLLER='offlineMusicDownloads';
const mb=n=>Number.isFinite(n)?(n/1e6).toFixed(2)+' MB':'UNKNOWN';
export function downloadStatusText(state={}){
 switch(state.status){
  case 'ready':return 'VERIFIED OFFLINE MUSIC READY';
  case 'lite-ready':return state.upgradeStatus==='insufficient-storage'
   ?'LITE READY; FULL NEEDS '+mb(state.upgradeMissingBytes)+' / '+mb(state.availableBytes)+' FREE'
   :state.upgradeStatus==='failed'?'LITE READY; FULL UPGRADE FAILED - RETRY'
   :'LITE READY - FULL UPGRADE OPTIONAL';
  case 'download-required':return 'DOWNLOAD NEEDED: '+mb(state.missingBytes);
  case 'checking':return 'CHECKING RECORDINGS AND STORAGE';
  case 'downloading':return 'VERIFIED '+mb(state.completedBytes)+' / '+mb(state.totalBytes);
  case 'insufficient-storage':return 'NOT ENOUGH STORAGE: '+mb(state.availableBytes)+' FREE';
  case 'cancelled':return 'CANCELLED - VERIFIED FILES KEPT';
  case 'failed':return 'DOWNLOAD FAILED - RETRY TO REPAIR';
  case 'no-music':return 'NO SELECTED MUSIC - NO DOWNLOAD';
  default:return 'CHECKING OFFLINE STATUS';
 }
}
export class OfflineMusicView extends View {
 constructor(scene,theme,{controller,onClose}){
  super(scene,theme,{w:448,h:238,title:'OFFLINE MUSIC',color:'cyan',onClose,y:15});
  this.controller=controller;this.armed=false;this.armedPrefetch=false;this.pending=false;this.localError=false;this.tiered=typeof controller.setMode==='function'&&typeof controller.apply==='function';
  this.status=new NeonText(scene,theme,14,28,'',{color:'text',outline:'none'});this.panel.add(this.status);
  this.note=new NeonText(scene,theme,14,49,'ORIGINAL QUALITY PREVIEW - NO AUTO DOWNLOAD',{color:'amber',outline:'none'});this.panel.add(this.note);
  this.menu=new MenuList(scene,theme,{x:10,y:72,w:428,rowH:this.tiered?19:23,parent:this.panel,items:[
   ...(this.tiered?[{kind:'choice',label:'MUSIC QUALITY',options:[{value:'high',label:'HIGH'},{value:'space-saver',label:'SPACE SAVER'},{value:'no-music',label:'NO MUSIC'}],get:()=>this.controller.mode,set:v=>this._mode(v)}]:[]),
   {kind:'action',label:'DOWNLOAD / REPAIR',color:'cyan',onSelect:()=>this._arm()},
   {kind:'action',label:'CONFIRM DOWNLOAD',color:'lime',disabled:true,onSelect:()=>this._start()},
   ...(this.tiered?[{kind:'action',label:'PRELOAD NEXT BIOME',color:'cyan',onSelect:()=>this._armPrefetch()},{kind:'action',label:'CONFIRM PREFETCH',color:'lime',disabled:true,onSelect:()=>this._startPrefetch()}]:[]),
   {kind:'action',label:'CANCEL DOWNLOAD',color:'amber',disabled:true,onSelect:()=>this._cancel()},
   {kind:'action',label:'CHECK OFFLINE STATUS',color:'cyan',onSelect:()=>this._refresh()},
   ...(this.tiered?[{kind:'action',label:'APPLY QUALITY (MUSIC STOPPED)',color:'lime',onSelect:()=>this._apply()}]:[]),
  ]});
  this._onFrame=()=>this._paint();scene.events?.on('update',this._onFrame);this._refresh();
 }
 /** Arming authorizes only the exact plan the player inspected. */
 _planTicket(){return {plan:this.controller.plan,revision:this.controller._planRevision??0,biome:this.controller.plan?.nextBiome??null};}
 _ticketCurrent(ticket){return !!ticket&&!this.controller.replanning&&ticket.plan===this.controller.plan&&ticket.revision===(this.controller._planRevision??0)&&ticket.biome===(this.controller.plan?.nextBiome??null);}
 _staleConfirmation(){this.armed=false;this.armedPrefetch=false;this._downloadTicket=null;this._prefetchTicket=null;this.localError='DOWNLOAD PLAN CHANGED - CONFIRM AGAIN';this._paint();}
 _paint(){if(!this.alive)return;
  if((this.armed&&!this._ticketCurrent(this._downloadTicket))||(this.armedPrefetch&&!this._ticketCurrent(this._prefetchTicket))){this.armed=false;this.armedPrefetch=false;this.localError='DOWNLOAD PLAN CHANGED - CONFIRM AGAIN';}
  const s=this.controller.state||{},busy=this.pending||s.status==='checking'||s.status==='downloading';
  const key=JSON.stringify([s.status,s.missingBytes,s.completedBytes,s.totalBytes,s.availableBytes,s.mode,s.quality,s.liteReady,s.fullReady,s.upgradeStatus,s.upgradeMissingBytes,s.prefetchStatus,s.prefetchBytes,s.nextBiome,this.armed,this.armedPrefetch,busy,this.localError]);if(key===this._lastPaint)return;this._lastPaint=key;
  this.status.setText(this.localError?(typeof this.localError==='string'?this.localError:'STATUS CHECK FAILED - RETRY'):downloadStatusText(s));
  this.note.setText(this.armedPrefetch?'CONFIRM OPTIONAL PREFETCH / MAX 32 MB':this.armed?'CONFIRM TO DOWNLOAD '+mb(s.missingBytes)+' OF MUSIC':this.tiered?(s.prefetchStatus==='ready'||s.prefetchStatus==='partial'?'NEXT BIOME '+s.prefetchStatus.toUpperCase()+' '+s.prefetchGroups+'/'+s.prefetchTotalGroups:'ACTIVE: '+(s.quality?.toUpperCase()||'NONE')+' / NO AUTO DOWNLOAD'):'ORIGINAL QUALITY PREVIEW - NO AUTO DOWNLOAD');
  const items=this.menu.items;const arm=items.find(i=>i.label==='DOWNLOAD / REPAIR'),confirm=items.find(i=>i.label==='CONFIRM DOWNLOAD'),cancel=items.find(i=>i.label==='CANCEL DOWNLOAD'),refresh=items.find(i=>i.label==='CHECK OFFLINE STATUS'),armPrefetch=items.find(i=>i.label==='PRELOAD NEXT BIOME'),confirmPrefetch=items.find(i=>i.label==='CONFIRM PREFETCH');if(this.tiered){items[0].disabled=busy;items.at(-1).disabled=busy||!(s.liteReady||s.ready||s.mode==='no-music');armPrefetch.disabled=busy||!this.controller.plan.nextBiome||s.mode==='no-music';confirmPrefetch.disabled=busy||!this.armedPrefetch;}arm.disabled=busy||s.status==='no-music'||s.ready===true;confirm.disabled=busy||!this.armed;cancel.disabled=!busy;refresh.disabled=busy;this.menu.refresh();
 }
 async _mode(mode){if(this.pending||this.controller.running)return;this.armed=false;this.armedPrefetch=false;this.pending=true;this.localError=false;this._paint();try{await this.controller.setMode(mode);updateSetting(this.scene.game,'offlineMusicQuality',mode);}catch{this.localError=true;}finally{this.pending=false;this._paint();}}
 async _apply(){if(this.pending||this.controller.running)return;this.pending=true;this.armed=false;this.localError=false;this._paint();try{await this.controller.apply();}catch(e){this.localError=String(e.message||e).includes('Stop music')?'STOP MUSIC BEFORE APPLYING QUALITY':'QUALITY NOT READY - CHECK DOWNLOAD';}finally{this.pending=false;this._paint();}}
 _arm(){this.armedPrefetch=false;if(this.pending||this.controller.running||this.controller.state?.ready||this.controller.state?.status==='no-music')return;this.armed=true;this._downloadTicket=this._planTicket();this._paint();}
 _armPrefetch(){if(!this.tiered||this.pending||this.controller.running||!this.controller.plan.nextBiome||this.controller.mode==='no-music')return;this.armed=false;this.armedPrefetch=true;this._prefetchTicket=this._planTicket();this._paint();}
 async _startPrefetch(){if(!this.armedPrefetch||this.pending)return;if(!this._ticketCurrent(this._prefetchTicket)){this._staleConfirmation();return;}this.armedPrefetch=false;this.pending=true;this.localError=false;this._paint();try{await this.controller.prefetch({consent:true,idle:!this.scene.game.scene.isActive('RunScene')});}catch(e){this.localError='PREFETCH UNAVAILABLE - TRY IN MENU';}finally{this.pending=false;this._paint();}}
 async _start(){if(!this.armed||this.pending)return;if(!this._ticketCurrent(this._downloadTicket)){this._staleConfirmation();return;}this.armed=false;this.pending=true;this.localError=false;this._paint();try{await this.controller.start({consent:true});}catch{this.localError=true;}finally{this.pending=false;this._paint();}}
 _cancel(){this.armed=false;this.armedPrefetch=false;this.controller.cancel();this._paint();}
 async _refresh(){if(this.pending||this.controller.running)return;this.armed=false;this.armedPrefetch=false;this.pending=true;this.localError=false;this._paint();try{await this.controller.refresh();}catch{this.localError=true;}finally{this.pending=false;this._paint();}}
 handleAction(action){if(action==='cancel'){this.close();return true;}return this.menu.handleAction(action);}
 destroy(){this.scene.events?.off('update',this._onFrame);this.armed=false;this.armedPrefetch=false;super.destroy();}
}
