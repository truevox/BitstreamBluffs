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
    this.pinReady=false;
    this._operationVersion=0; // reject stale async refresh after a user action
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
    this.buttons=specs.map(({x,label,run},i)=>{
      const button=new Button(scene,theme,{x,y:76,w:77,h:17,label,color:'lime',onClick:()=>{
        this.focus=i;this.buttons.forEach((b,j)=>b.setHover(i===j));run();
      }});
      this.panel.add(button);
      return button;
    });
    this.status=new NeonText(scene,theme,12,109,'READING LOCAL EVIDENCE...', {color:'lime',outline:'none'});
    this.detail=new NeonText(scene,theme,12,124,'', {color:'text',outline:'none'});
    this.panel.add(this.status);this.panel.add(this.detail);
    this.buttons[0].setDisabled(true);
    this.buttons[1].setDisabled(true);
    this.buttons[0].setHover(true);
    text(12,144,'IMPORTS REMAIN LOCAL AND UNVERIFIED.','amber');
    text(12,156,'KEEP DOES NOT PREVENT CLEARING SITE DATA.','text');
    this._installNativeImportInput();
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
    if (this.busy || !this.alive) return;
    const version=++this._operationVersion;
    const live=()=>this.alive && version===this._operationVersion;
    this.pinReady=false;
    this.buttons[0].setDisabled(true);
    this.buttons[1].setDisabled(true);
    const status=this._captureStatus();
    const capture=currentRunEvidence(status,this.tape.runId,{allowFailed:true});
    if (!status) {
      this.digestText.setText('EVIDENCE: STILL SAVING / RETRY');
      this._show('NOT READY','SELECT REFRESH AFTER THE RUN IS SAVED');return;
    }
    if (!capture) {
      this.digestText.setText('EVIDENCE: NOT AVAILABLE');
      this._show(`SAVE FAILED: ${status.code || 'UNAVAILABLE'}`,'NO RECOVERABLE INPUT PACKAGE');return;
    }
    this.digestText.setText(`SHA256: ${capture.digest.slice(7,31).toUpperCase()}...`);
    try {
      const control=await this._getActions();
      if (!live() || this._captureStatus()!==status) return;
      const bytes=await control.store.get(capture.digest);
      if (!live() || this._captureStatus()!==status) return;
      if (!bytes) throw new Error('canonical evidence bytes not available');
      // Export only needs rehashed bytes; a broken reference-index read MUST
      // NOT prevent someone from saving those bytes to their own file.
      this.buttons[1].setDisabled(false);
      const persisted=await control.store.isBundleDurable(capture.digest);
      if (!live() || this._captureStatus()!==status) return;
      let held=false;
      try {
        const refs=persisted ? await control.store.persistedProtections(capture.digest) : [];
        if (!live() || this._captureStatus()!==status) return;
        held=refs.some(r=>r.runId===this.tape.runId && r.role==='pinned');
      } catch (e) {
        if (!live() || this._captureStatus()!==status) return;
        this._show('PIN STATUS UNAVAILABLE — EXPORT WORKS',statusText(e));
        // Keep/Unpin remain disabled; no guessed pin state from stale cache.
        return;
      }
      this.pinReady=status.ok===true && persisted;
      this.buttons[0].setDisabled(!this.pinReady);
      this.buttons[0].setLabel(held?'UNPIN':'KEEP');
      if (!status.ok) this._show('DISK SAVE FAILED — EXPORT NOW',
        `STILL IN SESSION MEMORY: ${status.code || 'STORAGE ERROR'}`);
      else this._show(held?'LOCAL EVIDENCE PINNED':persisted?'SAVED LOCALLY':'SESSION ONLY — EXPORT NOW',
        persisted?'CAN BE LOST IF BROWSER SITE DATA IS CLEARED':'DISK NOT CONFIRMED: EXPORT TO A FILE');
    } catch(e) {
      if (live() && this._captureStatus()===status)
        this._show('ARCHIVE READ FAILED',statusText(e));
    }
  }

  async _run(task) {
    if (this.busy || !this.alive) return;
    this.busy=true;
    this._operationVersion++; // supersede any in-flight Refresh result
    if(this._nativeInput)this._nativeInput.disabled=true;
    try{await task();}
    catch(e){this._show(`LOCAL ARCHIVE ERROR: ${statusText(e)}`);uiSfx(this.scene,'uiBack');}
    finally{
      this.busy=false;
      if(this._nativeInput && this.alive)this._nativeInput.disabled=false;
    }
  }

  _keepOrUnpin() {return this._run(async()=>{
    if (!this.pinReady) {this._show('KEEP/UNPIN NOT READY','REFRESH ARCHIVE STATUS FIRST');return;}
    const capture=currentRunEvidence(this._captureStatus(),this.tape.runId);
    if (!capture) {this._show('EVIDENCE NOT SAVED YET','REFRESH AFTER THE RUN FINISHES');return;}
    const control=await this._getActions();
    // The player's visible action is the authority. Never interpret a stale
    // KEEP label as permission to UNPIN a reference created in another tab.
    const wantsUnpin=this.buttons[0].label.main.text==='UNPIN';
    if (wantsUnpin){
      const pinned=control.store.listProtections().find(r=>r.digest===capture.digest &&
        r.runId===this.tape.runId && r.role==='pinned');
      if (!pinned) {this._show('PIN STATUS CHANGED','REFRESH BEFORE UNPINNING');return;}
      await control.unpin(pinned.key);
      this._show('PIN REMOVED','THE EVIDENCE FILE HAS NOT BEEN DELETED');
    } else {
      const result=await control.keep({digest:capture.digest,runId:this.tape.runId,role:'pinned'});
      this._show('KEPT LOCALLY',result.browserPersistence===true?'BROWSER PERSISTENCE GRANTED':'BROWSER MAY STILL CLEAR SITE DATA');
    }
    if (this.alive) this.buttons[0].setLabel(wantsUnpin?'KEEP':'UNPIN');
  });}

  _export() {return this._run(async()=>{
    const capture=currentRunEvidence(this._captureStatus(),this.tape.runId,{allowFailed:true});
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

  /** A native browser input covers the Import Phaser button. The browser,
   * not a synthetic gamepad/pointerdown event, opens a trusted file chooser.
   * Touch, mouse and Tab+Enter therefore work without a transient-activation
   * race. Gamepad cannot activate a privileged browser picker directly.
   */
  _installNativeImportInput() {
    if (typeof document==='undefined' || typeof window==='undefined') return;
    const input=document.createElement('input');
    input.type='file';input.accept='.bbreplay';
    input.setAttribute('data-role','replay-evidence-import');
    input.setAttribute('aria-label','Import local replay evidence file');
    Object.assign(input.style,{
      position:'fixed',opacity:'0.002',zIndex:'10000',cursor:'pointer',
      padding:'0',border:'0',margin:'0',background:'transparent',
    });
    input.onfocus=()=>{if(this.alive){this.focus=2;this.buttons.forEach((b,i)=>b.setHover(i===2));}};
    input.onchange=()=>{
      const file=input.files?.[0];input.value='';
      this._restoreGameFocus();
      if (!file) return;
      if (this.busy) {this._show('ARCHIVE BUSY — FILE NOT IMPORTED','CHOOSE THE FILE AGAIN AFTER THIS ACTION');return;}
      this._processImportFile(file);
    };
    input.oncancel=()=>{this._restoreGameFocus();this._show('IMPORT CANCELLED');};
    input.onkeydown=e=>{
      // InputRouter intentionally ignores keys aimed at DOM inputs. Escape
      // must still back out of the menu when a keyboard user tabs to Import.
      if(e.key==='Escape'){
        e.preventDefault();e.stopPropagation();
        this._restoreGameFocus();
        if(this.alive)this.close();
      }
    };
    document.body.appendChild(input);
    this._nativeInput=input;
    this._positionNativeInput=()=>{
      if(!this.alive || !this.panel || !this.scene.game?.canvas)return;
      const rect=this.scene.game.canvas.getBoundingClientRect();
      const sx=rect.width/this.scene.game.config.width;
      const sy=rect.height/this.scene.game.config.height;
      Object.assign(input.style,{
        left:`${rect.left+(this.panel.x+176)*sx}px`,
        top:`${rect.top+(this.panel.y+76)*sy}px`,
        width:`${77*sx}px`,height:`${17*sy}px`,
      });
    };
    this._positionNativeInput();
    window.addEventListener('resize',this._positionNativeInput);
    this.scene.scale?.on('resize',this._positionNativeInput);
  }

  _restoreGameFocus() {
    if(this._nativeInput && document.activeElement===this._nativeInput)this._nativeInput.blur();
  }

  /** Gamepad/synthetic events have no browser file-picker privilege. Focus
   * the native control and give an actionable instruction instead of hanging.
   */
  _import() {
    if(this.busy || !this.alive)return;
    if(!this._nativeInput){this._show('BROWSER FILE PICKER NOT AVAILABLE');return;}
    if(navigator.userActivation?.isActive) this._nativeInput.click();
    else this._show('USE MOUSE/TOUCH OR TAB+ENTER','BROWSER REQUIRES ITS NATIVE FILE PICKER');
  }

  _processImportFile(file) {return this._run(async()=>{
    if(!file){this._show('IMPORT CANCELLED');return;}
    const expectedDigest=digestFromLocalReplayFilename(file.name);
    if(!expectedDigest){this._show('INVALID FILENAME','EXPECTED 64-HEX-DIGEST.BBREPLAY');return;}
    if(file.size>MAX_OUTPUT_BYTES){this._show('FILE TOO LARGE','MAXIMUM 16 MIB CANONICAL EVIDENCE');return;}
    const bytes=new Uint8Array(await file.arrayBuffer());
    const control=await this._getActions();
    const imported=await control.import(bytes,{expectedDigest});
    this._show('IMPORTED LOCAL EVIDENCE — UNVERIFIED',
      imported.protectionCount===null?'PIN STATUS UNKNOWN — REFRESH LATER':
        imported.localDurable?'SAVED ON DEVICE, NOT VERIFIED':'SESSION ONLY — EXPORT A COPY');
  });}

  destroy() {
    if(this._nativeInput){this._nativeInput.remove();this._nativeInput=null;}
    if(this._positionNativeInput){
      window.removeEventListener('resize',this._positionNativeInput);
      this.scene.scale?.off('resize',this._positionNativeInput);
    }
    super.destroy();
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
