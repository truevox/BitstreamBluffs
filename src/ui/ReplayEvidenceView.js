/**
 * Explicit LOCAL replay-evidence controls from Game Over → Course Ghosts.
 * No background upload, wallet access, trusted scoreboard admission or automatic
 * download/import. Filename digest is integrity only, NOT player identity.
 */
import { View } from './View.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { uiSfx } from './Sound.js';
import { ellipsize } from './PixelFont.js';
import { LocalEvidenceActions } from '../systems/replay/localEvidenceActions.js';
import { sharedEvidenceStore, EVIDENCE_STATUS_KEY, RULESET_KEY } from '../systems/replay/evidenceCapture.js';
import { MAX_OUTPUT_BYTES } from '../systems/replay/canonicalJson.js';
import { digestFromLocalReplayFilename, currentRunEvidence } from '../systems/replay/archiveUiPolicy.js';

const statusText = err => err?.code || err?.message || String(err || 'UNKNOWN');

export class ReplayEvidenceView extends View {
  /** @param {Phaser.Scene} scene @param {object} theme
   *  @param {{tape:object,onClose:function():void}} o */
  constructor(scene,theme,o) {
    super(scene,theme,{w:352,h:194,title:'LOCAL REPLAY EVIDENCE',color:'cyan',onClose:o.onClose,
      hints:[{keys:['←','→'],label:'ACTION'},{keys:['ENTER'],label:'SELECT'}]});
    this.tape=o.tape;
    this.busy=false;
    this.focus=0;
    this.actions=null;
    const text=(x,y,v,color='text')=>this.panel.add(new NeonText(scene,theme,x,y,v,{color,outline:'none'}));
    text(12,24,'PRIVATE TO THIS DEVICE. NEVER UPLOADED.','cyan');
    text(12,38,'A CHECKSUM DOES NOT PROVE WHO PLAYED.','amber');
    this.digestText=new NeonText(scene,theme,12,53,'EVIDENCE: CHECKING',{color:'text',outline:'none'});
    this.panel.add(this.digestText);
    const specs=[
      {x:12,label:'KEEP',run:()=>this._keepOrUnpin()},
      {x:94,label:'EXPORT',run:()=>this._export()},
      {x:176,label:'IMPORT',run:()=>this._import()},
      {x:258,label:'REFRESH',run:()=>this._refresh()},
    ];
    this.buttons=specs.map(({x,label,run})=>{
      const button=new Button(scene,theme,{x,y:76,w:77,h:17,label,color:'lime',onClick:run});
      this.panel.add(button);
      return button;
    });
    this.status=new NeonText(scene,theme,12,109,'READING LOCAL EVIDENCE...', {color:'lime',outline:'none'});
    this.detail=new NeonText(scene,theme,12,124,'', {color:'text',outline:'none'});
    this.panel.add(this.status);this.panel.add(this.detail);
    text(12,144,'IMPORTS REMAIN LOCAL AND UNVERIFIED.','amber');
    text(12,156,'KEEP DOES NOT PREVENT CLEARING SITE DATA.','text');
    this._refresh();
  }

  _show(message,details='') {
    if (!this.alive) return;
    this.status.setText(ellipsize(String(message),250));
    this.detail.setText(ellipsize(String(details),320));
  }

  _captureStatus() {
    const s=this.scene.registry.get(EVIDENCE_STATUS_KEY);
    if (!s || s.runId !== this.tape.runId) return null;
    return s;
  }

  async _getActions() {
    if (this.actions) return this.actions;
    const store=await sharedEvidenceStore();
    const rs=this.scene.registry.get(RULESET_KEY);
    const actions=new LocalEvidenceActions(store,{currentRulesetId:rs?.rulesetId || null});
    if (this.alive) this.actions=actions;
    return actions;
  }

  async _refresh() {
    if (this.busy) return;
    const status=this._captureStatus();
    const capture=currentRunEvidence(status,this.tape.runId);
    if (!status) { this.digestText.setText('EVIDENCE: STILL SAVING / RETRY'); this._show('NOT READY','SELECT REFRESH AFTER THE RUN IS SAVED'); return; }
    if (!capture) { this.digestText.setText('EVIDENCE: NOT SAVED');this._show(`SAVE FAILED: ${status.code || 'UNAVAILABLE'}`, 'YOU CAN STILL KEEP PLAYING');return; }
    this.digestText.setText(`SHA256: ${capture.digest.slice(7,31).toUpperCase()}...`);
    try {
      const control=await this._getActions();
      const held=control.store.listProtections().some(r=>r.digest===capture.digest && r.runId===this.tape.runId && r.role==='pinned');
      const persisted=await control.store.isBundleDurable(capture.digest);
      if (!this.alive) return;
      this.buttons[0].setLabel(held?'UNPIN':'KEEP');
      this._show(held?'LOCAL EVIDENCE PINNED':persisted?'SAVED LOCALLY':'SESSION ONLY — EXPORT NOW',
        persisted?'CAN BE LOST IF BROWSER SITE DATA IS CLEARED':'DISK NOT CONFIRMED: EXPORT TO A FILE');
    } catch(e) {this._show('ARCHIVE READ FAILED',statusText(e));}
  }

  async _run(task) {
    if (this.busy || !this.alive) return;
    this.busy=true;
    try{await task();}
    catch(e){this._show(`LOCAL ARCHIVE ERROR: ${statusText(e)}`);uiSfx(this.scene,'uiBack');}
    finally{this.busy=false;}
  }

  _keepOrUnpin() {return this._run(async()=>{
    const capture=currentRunEvidence(this._captureStatus(),this.tape.runId);
    if (!capture) {this._show('EVIDENCE NOT SAVED YET','REFRESH AFTER THE RUN FINISHES');return;}
    const control=await this._getActions();
    const pinned=control.store.listProtections().find(r=>r.digest===capture.digest && r.runId===this.tape.runId && r.role==='pinned');
    if (pinned){await control.unpin(pinned.key);this._show('PIN REMOVED','THE EVIDENCE FILE HAS NOT BEEN DELETED');}
    else {
      const result=await control.keep({digest:capture.digest,runId:this.tape.runId,role:'pinned'});
      this._show('KEPT LOCALLY',result.browserPersistence===true?'BROWSER PERSISTENCE GRANTED':'BROWSER MAY STILL CLEAR SITE DATA');
    }
    if (this.alive) this.buttons[0].setLabel(pinned?'KEEP':'UNPIN');
  });}

  _export() {return this._run(async()=>{
    const capture=currentRunEvidence(this._captureStatus(),this.tape.runId);
    if(!capture){this._show('NO CURRENT RUN EVIDENCE TO EXPORT');return;}
    const control=await this._getActions();
    const result=await control.export(capture.digest);
    if(!this.alive)return;
    const blob=new Blob([result.bytes],{type:'application/octet-stream'});
    const url=URL.createObjectURL(blob);
    try{
      const a=document.createElement('a');a.href=url;a.download=result.filename;
      a.style.display='none';document.body.appendChild(a);a.click();a.remove();
      this._show('LOCAL FILE EXPORT REQUESTED','CHECK YOUR DOWNLOADS — NO NETWORK UPLOAD');
    } finally {setTimeout(()=>URL.revokeObjectURL(url),15000);}
  });}

  /** Opens file picker *synchronously* in the genuine button/keyboard gesture. */
  _chooseFile() {
    if(typeof document==='undefined') return Promise.resolve(null);
    return new Promise(resolve=>{
      const input=document.createElement('input');input.type='file';input.accept='.bbreplay';
      input.style.position='fixed';input.style.left='-10000px';
      const finish=file=>{input.remove();resolve(file || null);};
      input.onchange=()=>finish(input.files?.[0]);
      input.oncancel=()=>finish(null);
      document.body.appendChild(input);input.click();
    });
  }

  _import() {
    if(this.busy || !this.alive)return;
    const chosen=this._chooseFile(); // no await before file chooser opens
    return this._run(async()=>{
      const file=await chosen;
      if(!file){this._show('IMPORT CANCELLED');return;}
      const expectedDigest=digestFromLocalReplayFilename(file.name);
      if(!expectedDigest){this._show('INVALID FILENAME','EXPECTED 64-HEX-DIGEST.BBREPLAY');return;}
      if(file.size>MAX_OUTPUT_BYTES){this._show('FILE TOO LARGE','MAXIMUM 16 MIB CANONICAL EVIDENCE');return;}
      const bytes=new Uint8Array(await file.arrayBuffer());
      const control=await this._getActions();
      const imported=await control.import(bytes,{expectedDigest});
      this._show('IMPORTED LOCAL EVIDENCE — UNVERIFIED',
        imported.localDurable?'SAVED ON DEVICE, NOT VERIFIED':'SESSION ONLY — EXPORT A COPY');
    });
  }

  handleAction(action) {
    if(action==='cancel'||action==='ghost'){this.close();return true;}
    if(action==='left'||action==='up'||action==='right'||action==='down'){
      const delta=action==='left'||action==='up'?-1:1;
      this.focus=(this.focus+delta+this.buttons.length)%this.buttons.length;
      this.buttons.forEach((b,i)=>b.setHover(i===this.focus));
      uiSfx(this.scene,'uiMove');
    } else if(action==='confirm') this.buttons[this.focus].zone.emit('pointerdown');
    return true;
  }
}
