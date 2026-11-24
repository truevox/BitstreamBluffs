/** Consent-first UI for an explicitly installed offline download controller.
 * No controller is installed by the shipped app yet. */
import {View} from './View.js';
import {MenuList} from './MenuList.js';
import {NeonText} from './Neon.js';
export const OFFLINE_MUSIC_CONTROLLER='offlineMusicDownloads';
const mb=n=>Number.isFinite(n)?(n/1e6).toFixed(2)+' MB':'UNKNOWN';
export function downloadStatusText(state={}){
 switch(state.status){
  case 'ready':return 'VERIFIED OFFLINE MUSIC READY';
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
  this.controller=controller;this.armed=false;this.pending=false;this.localError=false;
  this.status=new NeonText(scene,theme,14,28,'',{color:'text',outline:'none'});this.panel.add(this.status);
  this.note=new NeonText(scene,theme,14,49,'ORIGINAL QUALITY PREVIEW - NO AUTO DOWNLOAD',{color:'amber',outline:'none'});this.panel.add(this.note);
  this.menu=new MenuList(scene,theme,{x:10,y:72,w:428,rowH:23,parent:this.panel,items:[
   {kind:'action',label:'DOWNLOAD / REPAIR',color:'cyan',onSelect:()=>this._arm()},
   {kind:'action',label:'CONFIRM DOWNLOAD',color:'lime',disabled:true,onSelect:()=>this._start()},
   {kind:'action',label:'CANCEL DOWNLOAD',color:'amber',disabled:true,onSelect:()=>this._cancel()},
   {kind:'action',label:'CHECK OFFLINE STATUS',color:'cyan',onSelect:()=>this._refresh()},
  ]});
  this._onFrame=()=>this._paint();scene.events?.on('update',this._onFrame);this._refresh();
 }
 _paint(){if(!this.alive)return;const s=this.controller.state||{},busy=this.pending||s.status==='checking'||s.status==='downloading';
  const key=JSON.stringify([s.status,s.missingBytes,s.completedBytes,s.totalBytes,s.availableBytes,this.armed,busy,this.localError]);if(key===this._lastPaint)return;this._lastPaint=key;
  this.status.setText(this.localError?'STATUS CHECK FAILED - RETRY':downloadStatusText(s));
  this.note.setText(this.armed?'CONFIRM TO DOWNLOAD '+mb(s.missingBytes)+' OF MUSIC':'ORIGINAL QUALITY PREVIEW - NO AUTO DOWNLOAD');
  const [arm,confirm,cancel,refresh]=this.menu.items;arm.disabled=busy||s.status==='no-music'||s.ready===true;confirm.disabled=busy||!this.armed;cancel.disabled=!busy;refresh.disabled=busy;this.menu.refresh();
 }
 _arm(){if(this.pending||this.controller.running||this.controller.state?.ready||this.controller.state?.status==='no-music')return;this.armed=true;this._paint();}
 async _start(){if(!this.armed||this.pending)return;this.armed=false;this.pending=true;this.localError=false;this._paint();try{await this.controller.start({consent:true});}catch{this.localError=true;}finally{this.pending=false;this._paint();}}
 _cancel(){this.armed=false;this.controller.cancel();this._paint();}
 async _refresh(){if(this.pending||this.controller.running)return;this.armed=false;this.pending=true;this.localError=false;this._paint();try{await this.controller.refresh();}catch{this.localError=true;}finally{this.pending=false;this._paint();}}
 handleAction(action){if(action==='cancel'){this.close();return true;}return this.menu.handleAction(action);}
 destroy(){this.scene.events?.off('update',this._onFrame);this.armed=false;super.destroy();}
}
