/**
 * OWNER: UI engineer.
 * Modal sub-screens shared by TitleScene and PauseScene: leaderboard, settings, seed entry, sharecode export/import.
 * A view is a Panel plus content; the host scene feeds it MenuInput actions via handleAction(). Each view calls
 * `onClose()` when the player backs out. destroy() removes everything it created (DOM boxes included).
 */
import Phaser from 'phaser';
import { REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { updateSetting } from '../services.js';
import { GAME_SONGS } from '../systems/music/MusicPlaylist.js';
import { Panel } from './Panel.js';
import { NeonText } from './Neon.js';
import { Button } from './Button.js';
import { MenuList } from './MenuList.js';
import { LeaderboardTable } from './LeaderboardTable.js';
import { DomTextBox } from './DomTextBox.js';
import { copyText } from './Clipboard.js';
import { uiSfx } from './Sound.js';
import { ellipsize, measureText } from './PixelFont.js';
import { profileLayout, toggleLabel } from './ProfileLayout.js';
import { achievementsLayout, clampPage } from './AchievementsLayout.js';
import { ACHIEVEMENTS } from '../systems/Achievements.js';
import { shopLayout, shopMenuItems, titlesLayout, titlesMenuItems } from './ShopLayout.js';
import { toggleBiome, biomeToggleRows, purchase, equip, unequip, isOwned, shopItem } from '../systems/ProfileStore.js';
import { VOCALS_UNLOCK_SHARDS } from '../systems/ProfileStore.js';
import { StemMusicDirector } from '../systems/music/StemMusicDirector.js';
import { ScoreInspectorView } from './ScoreInspectorView.js';
import { BIOME_IDS, HOME_BIOME } from '../systems/music/BiomeVoices.js';
import { resolveMusicAsset } from '../systems/music/MusicPack.js';
import { validatePerformanceScore, validateExperimentalPerformanceScore,
  nearbyPerformanceEvents, makeIssueMarker, PERFORMANCE_ROLES } from '../systems/music/PerformanceScore.js';

/** Base: centred panel with a BACK button. */
class View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{w:number,h:number,title:string,color?:string,onClose:function():void,y?:number,backLabel?:string}} o
   */
  constructor(scene, theme, o) {
    this.scene = scene;
    this.theme = theme;
    this.onClose = o.onClose;
    this.alive = true;
    const x = Math.round((GAME_WIDTH - o.w) / 2);
    const y = o.y !== undefined ? o.y : Math.round((GAME_HEIGHT - o.h) / 2);
    this.panel = new Panel(scene, theme, { x, y, w: o.w, h: o.h, title: o.title, color: o.color || 'cyan', fillAlpha: 1 });
    this.panel.setDepth(500);
    this.w = o.w;
    this.h = o.h;
    this.back = new Button(scene, theme, {
      x: o.w - 76, y: o.h - 22, w: 68, h: 16, label: o.backLabel || 'BACK', color: 'magenta', onClick: () => this.close(),
    });
    this.panel.add(this.back);
  }

  close() {
    uiSfx(this.scene, 'uiBack');
    if (this.alive) this.onClose();
  }

  handleAction(action) {
    if (action === 'cancel') this.close();
    return true;
  }

  destroy() {
    this.alive = false;
    if (this.panel) this.panel.destroy();
    this.panel = null;
  }
}

/** Top-10 leaderboard from SaveStore. */
export class LeaderboardView extends View {
  /** @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme @param {{onClose:function():void}} o */
  constructor(scene, theme, o) {
    // 188, not 178: the board switch needs an on-screen key hint, and the only free line is between the
    // tenth table row (panel y ~146) and the button strip. At y 40 the panel still ends at 228 of 270.
    super(scene, theme, { w: 440, h: 188, title: 'LEDGER // TOP 10 ON THIS DEVICE', color: 'cyan', onClose: o.onClose, y: 40 });
    this.table = new LeaderboardTable(scene, theme, { x: 12, y: 24, w: 416, entries: null, parent: this.panel });
    // The footer used to be one 329px line on the button row, so it ran under MODDED and BACK. It is split:
    // the short half stays on the button row (it ends at x 129, MODDED starts at 292) and the rule-flag
    // note moves to the free line above, left of the key hint.
    this.panel.add(new NeonText(scene, theme, 12, this.h - 18, 'ONE LEDGER PER DEVICE.', {
      color: 'text', outline: 'none',
    }).setAlpha(0.55));
    this.panel.add(new NeonText(scene, theme, 12, this.h - 38, 'MAGENTA RULE FLAG = DAILY PATCH ACTIVE.', {
      color: 'text', outline: 'none',
    }).setAlpha(0.55));
    // W4: two boards. The clean board is what the game has always shown; the modded board is where a
    // boosted run goes instead of vanishing. Both come from SaveStore, both decide through Ranking.js, so
    // this view never tests `modded` itself.
    this.store = scene.registry.get(REG.SAVE_STORE);
    this.showingModded = false;
    this.emptyText = null;
    this.loadToken = 0;
    this.tabBtn = new Button(scene, theme, {
      x: this.w - 148, y: this.h - 24, w: 68, h: 16, label: 'MODDED', color: 'amber',
      onClick: () => this._toggleBoard(),
    });
    this.panel.add(this.tabBtn);
    // The switch was pointer-only: no key reached it. The hint names every key that now does, in the
    // same quiet style as the other view hints, right-aligned above the button it drives.
    const hintText = '← → / N / PAD X: SWITCH BOARD';
    this.panel.add(new NeonText(scene, theme, this.w - 12 - measureText(hintText), this.h - 38, hintText, {
      color: 'text', outline: 'none',
    }).setAlpha(0.55));
    // Focus ring for the two buttons (MODDED/CLEAN, BACK). Starts on the tab so confirm switches boards.
    this.focusIdx = 0;
    this.focusG = new Phaser.GameObjects.Graphics(scene);
    this.panel.add(this.focusG);
    this._paintFocus();
    this._loadBoard();
  }

  _loadBoard() {
    const store = this.store;
    this.tabBtn.setLabel(this.showingModded ? 'CLEAN' : 'MODDED');
    if (!store) { this.table.setEntries([]); return; }
    // A request token: a slow read for the board the player has already left must not paint over the
    // board they switched to.
    this.loadToken += 1;
    const token = this.loadToken;
    const modded = this.showingModded;
    const p = modded
      ? Promise.resolve(store.getModdedLeaderboard(10))
      : Promise.resolve(store.getLeaderboard(10));
    p.then((rows) => {
      if (!this.alive || token !== this.loadToken) return;
      // An empty board must say WHICH board is empty and why, or an empty modded board reads as a bug
      // rather than as "no boosted runs yet". The table draws it in place of its generic message.
      const empty = !rows || rows.length === 0;
      this.emptyText = empty ? `NO ${modded ? 'MODDED' : 'CLEAN'} RUNS RECORDED YET` : null;
      this.table.setEntries(rows || [], undefined, empty ? {
        title: this.emptyText,
        sub: modded ? 'RUNS WITH A BOOST ON LAND HERE' : 'FINISH A RUN TO CLAIM A SPOT',
      } : undefined);
    }).catch(() => {
      if (this.alive && token === this.loadToken) this.table.setEntries([]);
    });
  }

  /** @param {boolean} modded which board to show; a no-op when it is already showing. */
  _showBoard(modded) {
    if (this.showingModded === Boolean(modded)) return;
    this._toggleBoard();
  }

  _toggleBoard() {
    this.showingModded = !this.showingModded;
    uiSfx(this.scene, 'uiSelect');
    this._loadBoard();
  }

  _paintFocus() {
    const g = this.focusG;
    if (!g) return;
    g.clear();
    const b = this.focusIdx === 0 ? this.tabBtn : this.back;
    g.lineStyle(1, this.theme.pal[this.focusIdx === 0 ? 'amber' : 'magenta'], 1);
    g.strokeRect(b.x - 1.5, b.y - 1.5, b.w + 3, b.h + 3);
  }

  /**
   * Left shows CLEAN and right shows MODDED (directional, so a held key cannot flicker between boards);
   * N / pad X-Y ('alt') toggles from anywhere; up/down move focus between the tab and BACK; confirm
   * activates whichever holds focus.
   */
  handleAction(action) {
    if (action === 'cancel') { this.close(); return true; }
    if (action === 'left' || action === 'right') { this._showBoard(action === 'right'); return true; }
    if (action === 'alt') { this._toggleBoard(); return true; }
    if (action === 'up' || action === 'down') {
      const next = action === 'up' ? 0 : 1;
      if (next !== this.focusIdx) {
        this.focusIdx = next;
        this._paintFocus();
        uiSfx(this.scene, 'uiMove');
      }
      return true;
    }
    if (action === 'confirm') {
      if (this.focusIdx === 0) this._toggleBoard();
      else this.close();
      return true;
    }
    return true;
  }
}

/** Settings: palette, screen shake, volumes, tilt controls (persisted via updateSetting). */
export class SettingsView extends View {
  constructor(scene, theme, o) {
    super(scene, theme, { w: 360, h: 190, title: 'SETTINGS',
      color: 'amber', onClose: o.onClose, y: 40, backLabel: 'DONE' });
    this.soundView=null;
    const game=scene.game;
    const settings=()=>game.registry.get(REG.SETTINGS)||{};
    const items=[
      { kind:'choice',label:'PALETTE',options:[
        {value:'default',label:'NEON'},{value:'colorblind',label:'COLOR-BLIND'}],
        get:()=>settings().palette,set:v=>updateSetting(game,'palette',v) },
      { kind:'choice',label:'SCREEN SHAKE',options:[
        {value:true,label:'ON'},{value:false,label:'OFF'}],
        get:()=>settings().screenShake!==false,set:v=>updateSetting(game,'screenShake',v) },
      {kind:'slider',label:'MASTER VOLUME',get:()=>settings().masterVolume,
        set:v=>updateSetting(game,'masterVolume',v)},
      {kind:'slider',label:'MUSIC VOLUME',get:()=>settings().musicVolume,
        set:v=>updateSetting(game,'musicVolume',v)},
      {kind:'slider',label:'SFX VOLUME',get:()=>settings().sfxVolume,
        set:v=>updateSetting(game,'sfxVolume',v)},
      {kind:'slider',label:'SLED WIND',get:()=>settings().windVolume??1,
        set:v=>updateSetting(game,'windVolume',v)},
      {kind:'action',label:'MANAGE SOUND',color:'cyan',sub:'SONGS / VOCALS / LAB',
        onSelect:()=>this._openSoundManager()},
      {kind:'choice',label:'TILT CONTROLS (90)',options:[
        {value:false,label:'OFF'},{value:true,label:'ON'}],
        get:()=>!!settings().touchRotate90,set:v=>updateSetting(game,'touchRotate90',v)},
      {kind:'choice',label:'TOUCH BUTTONS',options:[
        {value:'auto',label:'AUTO'},{value:'on',label:'ON'},{value:'off',label:'OFF'}],
        get:()=>settings().touchOverlay||'auto',set:v=>updateSetting(game,'touchOverlay',v)},
    ];
    this.menu=new MenuList(scene,theme,{x:10,y:22,w:340,rowH:16,
      items,color:'amber',parent:this.panel});
    this.swatch=scene.add.graphics();
    this.panel.add(this.swatch);
    this.unbindSwatch=theme.bind(pal=>{
      const g=this.swatch;
      g.clear();
      ['cyan','magenta','lime','amber'].forEach((k,i)=>{
        g.fillStyle(pal[k],1);g.fillRect(10+i*22,this.h-20,18,12);
        g.fillStyle(pal.bg,1);g.fillRect(12+i*22,this.h-18,14,8);
        g.fillStyle(pal[k],1);g.fillRect(14+i*22,this.h-16,10,4);
      });
    });
  }
  _openSoundManager(){
    if(this.soundView)return;
    this.panel.setVisible(false);
    this.soundView=new SoundManagerView(this.scene,this.theme,{
      onClose:()=>{
        this.soundView?.destroy();
        this.soundView=null;
        this.panel.setVisible(true);
      },
    });
  }
  handleAction(action){
    if(this.soundView)return this.soundView.handleAction(action);
    if(action==='cancel'){this.close();return true;}
    return this.menu.handleAction(action);
  }
  destroy(){
    this.soundView?.destroy();this.soundView=null;
    this.unbindSwatch?.();
    super.destroy();
  }
}

/** One level deeper than ordinary Settings. The live game music engine is
 * shared by the playlist, laboratory and game - never use a separate player.
 */
export class SoundManagerView extends View {
  constructor(scene,theme,o){
    super(scene,theme,{w:448,h:238,title:'MANAGE SOUND',
      color:'cyan',onClose:o.onClose,y:15});
    this.labView=null;
    this._build();
  }
  _profile(){return this.scene.registry.get(REG.PROGRESSION)?.store?.profile||
    this.scene.registry.get(REG.PROFILE)||{};}
  _unlocked(){return this._profile()?.unlocked?.musicVocals===true;}
  _build(){
    const game=this.scene.game;
    const settings=()=>game.registry.get(REG.SETTINGS)||{};
    const unlocked=this._unlocked();
    const bank=Number(this._profile().bank)||0;
    const menuItems=[
      ...GAME_SONGS.map((song,index)=>({
        kind:'choice',label:'TRACK '+(index+1)+'  '+ellipsize(song.label.toUpperCase(),190),
        options:[{value:true,label:'ON'},{value:false,label:'OFF'}],
        get:()=>settings().musicEnabledSongs?.[song.id]!==false,
        set:v=>updateSetting(game,'musicEnabledSongs',{
          ...(settings().musicEnabledSongs||{}),[song.id]:v,
        }),
      })),
      {kind:'choice',label:'DYNAMIC ORCHESTRA',badge:'PRE-ALPHA',
        badgeColor:'magenta',options:[
          {value:false,label:'OFF'},{value:true,label:'ON'}],
        get:()=>settings().dynamicOrchestra===true,
        set:v=>updateSetting(game,'dynamicOrchestra',v)},
      ...(unlocked ? [
        {kind:'choice',label:'ORIGINAL VOCALS',options:[
          {value:false,label:'OFF'},{value:true,label:'ON'}],
          get:()=>settings().musicVocals===true,
          set:v=>this._changeVocals(v)},
        {kind:'slider',label:'VOCALS LEVEL',
          disabled:settings().musicVocals!==true,
          get:()=>settings().vocalGain??1,
          set:v=>updateSetting(game,'vocalGain',v)},
        {kind:'slider',label:'SYNTH MELODY WITH VOCALS',
          disabled:settings().musicVocals!==true,
          get:()=>settings().melodyWithVocalsGain??.18,
          set:v=>updateSetting(game,'melodyWithVocalsGain',v)},
      ] : [
        {kind:'action',label:'UNLOCK ORIGINAL VOCALS ('+
          VOCALS_UNLOCK_SHARDS+' SHARDS)',color:'amber',
          sub:bank+' AVAILABLE',onSelect:()=>this._buyVocals()},
        {kind:'static',label:'VOCALS + MELODY MIX LOCKED'},
      ]),
      {kind:'action',label:'MUSIC LAB',color:'lime',
        sub:'USE REAL GAME ENGINE',onSelect:()=>this._openLab()},
    ];
    const selected=this.menu?.selected||0;
    this.menu?.destroy();
    this.menu=new MenuList(this.scene,this.theme,{x:10,y:24,w:428,
      rowH:17,items:menuItems,color:'cyan',parent:this.panel});
    this.menu.setSelected(Math.min(selected,menuItems.length-1),true);
    if(!this.note){
      this.note=new NeonText(this.scene,this.theme,12,this.h-39,
        'DYNAMIC ORCHESTRA OFF = SOURCE STEMS + ALL GAME DSP',{
          color:'text',outline:'none',
        });
      this.note.setAlpha(.6);
      this.panel.add(this.note);
    }
  }
  _changeVocals(enabled){
    updateSetting(this.scene.game,'musicVocals',enabled===true);
    // The menu object is still active during click/keypress dispatch:
    // update existing row availability in place instead of destroying
    // the menu from inside one of its own pointer callbacks.
    for(const item of this.menu.items){
      if(item.label==='VOCALS LEVEL'||
        item.label==='SYNTH MELODY WITH VOCALS'){
        item.disabled=enabled!==true;
      }
    }
    this.menu.refresh();
  }
  _buyVocals(){
    const progression=this.scene.registry.get(REG.PROGRESSION);
    const store=progression?.store;
    const tx=store?.buyMusicVocals();
    if(tx?.ok){
      this.scene.registry.set(REG.PROFILE,tx.profile);
      uiSfx(this.scene,'uiSelect',{pitch:1.4});
      updateSetting(this.scene.game,'musicVocals',false);
      this._build();
    }else{
      uiSfx(this.scene,'uiBack');
      this.note.setText(tx?.reason==='not-enough-shards'
        ? 'NOT ENOUGH SHARDS TO UNLOCK VOCALS'
        : 'VOCAL PURCHASE COULD NOT BE SAVED');
    }
  }
  _openLab(){
    if(this.labView)return;
    this.panel.setVisible(false);
    this.labView=new SoundLabView(this.scene,this.theme,{
      onClose:()=>{
        this.labView?.destroy();
        this.labView=null;
        this.panel.setVisible(true);
        this._build();
      },
    });
  }
  handleAction(action){
    if(this.labView)return this.labView.handleAction(action);
    if(action==='cancel'){this.close();return true;}
    return this.menu.handleAction(action);
  }
  destroy(){
    this.labView?.destroy();this.labView=null;
    super.destroy();
  }
}


/** Actual-engine research lab. The only trusted place to check note-event
 * transcription, exact media lengths and timing, sound swap alignment,
 * repeated attacks and synchronization. Standalone :8186 is ART DESIGN ONLY.
 *
 * An isolated director instance uses the identical StemMusicDirector,
 * StemFXMixer, pack manifests and audio context as gameplay; only its
 * sandbox output is audible while this view is open. No game state writes.
 */
export class SoundLabView extends View {
  constructor(scene,theme,o){
    super(scene,theme,{w:468,h:253,title:'MUSIC LAB  //  REAL GAME AUDIO',
      color:'lime',onClose:o.onClose,y:7});
    this.audio=scene.registry.get(REG.AUDIO);
    this.biome='crystal-cavern';
    this.songIndex=0;
    this.dynamic=false;
    this.solo='ALL';
    this.airborne=false;
    this.speed=0;
    this.lab=null;
    this.request=0;
    this.scoreRequest=0;
    this.score=null;
    this.scoreStatus='WAITING FOR SCORE MANIFEST';
    this.experimentalScore=null;
    this.experimentalStatus='EXPERIMENTAL COMPARISON NOT LOADED';
    this.markers=[]; // lab session only, not localStorage or profile
    this.markerStatus='NO AUDIO OR GAME SAVES ARE CHANGED';
    this.inspector=null;
    this.drafts=new Map(); // per-source-revision, session only

    this.sourceBus=null;
    this.prevBusVolume=null;
    this.statusText=new NeonText(scene,theme,13,188,
      'LOADING THE GAME MUSIC ENGINE...',{color:'amber',outline:'none'});
    this.panel.add(this.statusText);
    this.clockText=new NeonText(scene,theme,13,199,
      'SAMPLE-FRAME CHECK: WAITING FOR A DECODE',
      {color:'cyan',outline:'none'});
    this.panel.add(this.clockText);
    this.scoreText=new NeonText(scene,theme,13,210,
      'SOURCE SCORE: WAITING FOR CAPTURED EVENTS',
      {color:'amber',outline:'none'});
    this.panel.add(this.scoreText);
    this.infoText=new NeonText(scene,theme,13,221,
      'SCORES ARE NOT GROUND TRUTH; MARKERS DO NOT CHANGE AUDIO',
      {color:'text',outline:'none'});
    this.infoText.setAlpha(.7);
    this.panel.add(this.infoText);
    // Touch/pointer buttons leave gamepad and the ten existing lab menu
    // rows untouched. The normal View BACK button already occupies x392.
    this.markButton=new Button(scene,theme,{
      x:13,y:235,w:91,h:14,label:'MARK (M)',color:'amber',
      onClick:()=>this._markIssue(),parent:this.panel,
    });
    this.inspectButton=new Button(scene,theme,{
      x:109,y:235,w:91,h:14,label:'NOTES (N)',color:'lime',
      onClick:()=>this._openInspector(),parent:this.panel,
    }).setDisabled(true);
    this.exportButton=new Button(scene,theme,{
      x:205,y:235,w:100,h:14,label:'EXPORT MARKS',color:'cyan',
      onClick:()=>this._exportMarks(),parent:this.panel,
    }).setDisabled(true);
    this.clearButton=new Button(scene,theme,{
      x:310,y:235,w:73,h:14,label:'CLEAR',color:'magenta',
      onClick:()=>this._clearMarks(),parent:this.panel,
    }).setDisabled(true);
    this._markKey=event=>{
      if(!this.alive||this.inspector||event?.repeat)return;
      if(this.lab?.pack)this._markIssue();
    };
    scene.input?.keyboard?.on('keydown-M',this._markKey);
    this._build();
    this._openSandbox();
    this.tickTimer=scene.time.addEvent({delay:220,loop:true,callback:()=>this._tick()});
  }
  _build(){
    const titles=this.lab?.catalog?.length ?
      this.lab.catalog.map(track=>track.title) : GAME_SONGS.map(track=>track.label);
    const options=(items)=>items.map(([value,label])=>({value,label}));
    const items=[
      {kind:'choice',label:'SONG',options:titles.map((title,i)=>({
        value:i,label:ellipsize(title.toUpperCase(),215)})),
        get:()=>this.songIndex,set:i=>this._song(i)},
      {kind:'choice',label:'BIOME',options:options([
        [HOME_BIOME,'HOME'],
        ...BIOME_IDS.filter(id=>id!==HOME_BIOME).map(id=>[
          id,id.replace(/-/g,' ').toUpperCase()]),
      ]),get:()=>this.biome,set:id=>this._biome(id)},
      {kind:'choice',label:'REPLACEMENTS',options:options([
        [false,'SOURCE + DSP'],[true,'NEW ORCHESTRA']]),
        get:()=>this.dynamic,set:value=>this._dynamic(value)},
      {kind:'choice',label:'ISOLATE',options:options([
        ['ALL','ALL'],['MELODY','MELODY'],['DRUMS','DRUMS'],
        ['BASS','BASS'],['GUITAR','GUITAR'],['PIANO','PIANO'],
        ['OTHER','OTHER']]),
        get:()=>this.solo,set:value=>this._solo(value)},
      {kind:'choice',label:'DRUM PHASE',options:options([
        [false,'GROUND'],[true,'AIRBORNE']]),
        get:()=>this.airborne,set:value=>this._air(value)},
      {kind:'choice',label:'SLED SPEED',options:options([
        [0,'STOPPED'],[350,'SLOW'],[850,'FAST'],[1500,'EXTREME']]),
        get:()=>this.speed,set:value=>this._speed(value)},
      {kind:'action',label:'BACK 10 SECONDS',color:'amber',
        onSelect:()=>this._jump(-10)},
      {kind:'action',label:'FORWARD 10 SECONDS',color:'amber',
        onSelect:()=>this._jump(10)},
      {kind:'action',label:'RESTART THIS SONG',color:'cyan',
        onSelect:()=>this._jump(-10000)},
      {kind:'action',label:'STOP / PLAY',color:'magenta',
        onSelect:()=>this._toggle()},
    ];
    this.menu?.destroy();
    this.menu=new MenuList(this.scene,this.theme,{
      x:10,y:23,w:446,rowH:16,items,parent:this.panel,color:'lime'});
  }
  async _openSandbox(){
    const generation=++this.request;
    const audio=this.audio;
    try {
      if(!audio)throw new Error('Game music engine missing');
      audio.unlock(); // user gesture opens this view, respecting autoplay.
      if(!audio._ensureCtx()||!audio.nodes)throw new Error('Audio unavailable');
      const main=audio._stemMusic;
      // Opening from pause/title/end must not advance the user's actual
      // music stream or change any persistent gameplay music setting.
      this.sourceBus=main?.bus||null;
      if(this.sourceBus){
        this.prevBusVolume=this.sourceBus.gain.value;
        this.sourceBus.gain.setTargetAtTime(0,audio.ctx.currentTime,.02);
      }
      const lab=new StemMusicDirector(audio);
      this.lab=lab;
      await lab.initPromise;
      if(!this.alive||generation!==this.request){lab.destroy();return;}
      if(!lab.ready)throw new Error('No valid song packs in this build');
      if(audio.ctx.state!=='running')await audio.ctx.resume();
      if(!this.alive||generation!==this.request){lab.destroy();return;}
      lab.attach(audio.ctx,audio.nodes.musicFilter);
      lab.applySettings({
        musicEnabledSongs:Object.fromEntries(
          GAME_SONGS.map(song=>[song.id,true])),
        dynamicOrchestra:this.dynamic,
        musicVocals:false,musicCaptions:false,
      });
      lab.setBiome(this.biome);
      lab.setAirborne(this.airborne);
      lab.setSpeed(this.speed);
      lab.trackIndex=this.songIndex;
      lab.onTrackStarted=track=>{
        this.songIndex=track.index;
        this._applySolo();
        this._loadPerformanceScore(track.id);
        this.menu?.refresh();
      };
      lab.start();
      this._build();
      this._tick();
    }catch(e){
      if(this.alive)this.statusText.setText(
        'LAB UNAVAILABLE: '+ellipsize(String(e?.message||e),340));
    }
  }
  async _loadPerformanceScore(id){
    const generation=++this.scoreRequest;
    this.score=null;
    this.experimentalScore=null;
    this.experimentalStatus='EXPERIMENTAL COMPARISON NOT LOADED';
    this.inspectButton.setDisabled(true);
    const lab=this.lab;
    const scoreAsset=lab?.pack?.performance;
    if(!scoreAsset){
      this.scoreStatus='NO VERSIONED SCORE IN THIS GAME PACK';
      this._tick();
      return;
    }
    this.scoreStatus='CAPTURED SCORE LOADING';
    try{
      const url=resolveMusicAsset(lab.packBase,scoreAsset.path);
      const response=await fetch(url,{cache:'default'});
      if(!response.ok)throw new Error('Score HTTP '+response.status);
      const raw=await response.json();
      // The score must be for this pack, hash-pinned in its actual
      // shipping manifest, not merely an unrelated file with notes.
      const score=validatePerformanceScore(raw,lab.pack);
      if(!this.alive||generation!==this.scoreRequest||this.lab!==lab||
        lab.track?.id!==id)return;
      this.score=score;
      this.inspectButton.setDisabled(false);
      this.scoreStatus='SOURCE SCORE LOADED (UNCALIBRATED)';
      // Optional candidate fetch never delays, edits, or gates music.
      void this._loadExperimentalScore(lab,id,generation,score);
    }catch(err){
      if(this.alive&&generation===this.scoreRequest){
        this.score=null;
        this.scoreStatus='SCORE REJECTED: '+String(err?.message||err);
      }
    }
    this._tick();
  }
  async _loadExperimentalScore(lab,id,generation,base){
    const asset=lab.pack?.experimentalPerformance;
    if(!asset){
      this.experimentalStatus='NO EXPERIMENTAL SCORE AVAILABLE';
      return;
    }
    this.experimentalStatus='EXPERIMENTAL SCORE LOADING';
    try{
      const response=await fetch(resolveMusicAsset(lab.packBase,asset.path),
        {cache:'default'});
      if(!response.ok)throw new Error('Candidate HTTP '+response.status);
      const raw=await response.json();
      const experimental=validateExperimentalPerformanceScore(raw,
        lab.pack,base);
      if(!this.alive||generation!==this.scoreRequest||this.lab!==lab||
        lab.track?.id!==id||this.score!==base)return;
      this.experimentalScore=experimental;
      this.experimentalStatus='V2 EXPERIMENTAL SCORE LOADED (NOT GOLD)';
    }catch(err){
      if(this.alive&&generation===this.scoreRequest){
        this.experimentalScore=null;
        this.experimentalStatus='V2 REJECTED: '+String(err?.message||err);
      }
    }
    this.inspector?.refresh();
  }
  _clockFrame(){
    const lab=this.lab;
    if(!lab?.pack||lab.clockStart===null||!lab.ctx)return null;
    return Math.max(0,Math.min(lab.pack.frameCount-1,Math.round(
      (lab.ctx.currentTime-lab.clockStart)*lab.pack.sampleRate)));
  }
  _markIssue(){
    const lab=this.lab;
    const frame=this._clockFrame();
    if(!lab?.track||frame===null)return;
    const role=this.solo==='ALL'?'ALL':this.solo.toLowerCase();
    this.markers.push(makeIssueMarker(this.score,{
      songId:lab.track.id,role,frame,
      biome:this.biome,airborne:this.airborne,speed:this.speed,
      replacements:this.dynamic,
    }));
    this.markerStatus='MARKED '+this.markers.length+' SUSPECT MOMENT(S), NOT GOLD NOTES';
    this.exportButton.setDisabled(false);
    this.clearButton.setDisabled(false);
    this._tick();
  }
  _clearMarks(){
    this.markers=[];
    this.markerStatus='ALL SESSION MARKS CLEARED; NO GAME SAVE CHANGED';
    this.exportButton.setDisabled(true);
    this.clearButton.setDisabled(true);
    this._tick();
  }
  _exportMarks(){
    if(!this.markers.length||typeof document==='undefined')return;
    const payload={
      format:'bitstream-music-issue-markers-v1',
      status:'human-listening-suspicions-not-gold-annotations',
      sampleRate:48000,
      count:this.markers.length,
      markers:this.markers,
    };
    const data=JSON.stringify(payload,null,2)+'\n';
    const blob=new Blob([data],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    try{
      const link=document.createElement('a');
      link.href=url;
      link.download='bitstream-music-issues-'+Date.now()+'.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }finally{
      // A queued download owns the Blob by this point; defer revoke so
      // Firefox/Chrome can both consume the object URL.
      setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    this.markerStatus='EXPORTED '+this.markers.length+' ISSUE MARK(S), NO CHANGES SAVED';
    this._tick();
  }
  _openInspector(){
    if(this.inspector||!this.score||!this.lab?.pack)return;
    const scoreHash=this.score.scoreHash;
    const draft=this.drafts.get(scoreHash);
    const inspector=new ScoreInspectorView(this.scene,this.theme,{
      lab:this,draft,
      onClose:()=>this._closeInspector(),
    });
    this.inspector=inspector;
    this.drafts.set(scoreHash,inspector.draft);
  }
  _closeInspector(){
    this.inspector?.destroy();
    this.inspector=null;
    this._tick();
  }
  _song(index){
    this._closeInspector();
    ++this.scoreRequest;
    this.score=null;
    this.experimentalScore=null;
    this.experimentalStatus='SWITCHING EXPERIMENTAL SCORE';
    this.scoreStatus='SWITCHING SOURCE SCORE';
    this.songIndex=index;
    const lab=this.lab;
    if(!lab?.ready)return;
    lab.stop();
    lab.trackIndex=index;
    lab.start();
  }
  _biome(id){
    this.biome=id;
    this.lab?.setBiome(id);
    this._applySolo();
  }
  _dynamic(value){
    this.dynamic=value===true;
    this.lab?.setDynamicOrchestra(this.dynamic);
  }
  _air(value){
    this.airborne=value===true;
    this.lab?.setAirborne(this.airborne);
  }
  _speed(value){
    this.speed=Number(value)||0;
    this.lab?.setSpeed(this.speed);
    this._applySolo();
  }
  _solo(value){
    this.solo=value;
    this._applySolo();
  }
  _applySolo(){
    const lab=this.lab;
    if(!lab?.mixer||!lab.pack)return;
    const core=['drums','bass','guitar','piano','other'];
    for(const role of core){
      const on=this.solo==='ALL'||this.solo===role.toUpperCase();
      lab.setStemGain(role,on?1:0);
    }
    // Keep the biome-specific melody independent from source versus
    // replacement; don't accidentally sneak the actual vocal back in.
    const active=lab._activeVoiceFor(lab.pack);
    for(const name of lab.gains.keys()){
      if(name.startsWith('voice:'))
        lab.mixer.setGain(name,
          name===active&&(this.solo==='ALL'||this.solo==='MELODY')?1:0,
          {time:.07});
    }
    lab.setSpeed(this.speed); // restore speed automation after solo.
    lab.setAirborne(this.airborne);
  }
  _jump(delta){
    const lab=this.lab;
    if(!lab?.pack)return;
    const position=Math.max(0,Math.min(lab.pack.duration-1,
      (lab.ctx.currentTime-lab.clockStart)+delta));
    if(typeof lab.seekTo==='function')lab.seekTo(position);
  }
  _toggle(){
    const lab=this.lab;
    if(!lab)return;
    if(lab.started)lab.stop();
    else{
      lab.trackIndex=this.songIndex;
      lab.start();
    }
    this._tick();
  }
  _tick(){
    if(!this.alive)return;
    const lab=this.lab;
    if(!lab?.ready){
      this.statusText.setText('ENGINE: WAITING FOR THE SAME GAME CATALOG');
      return;
    }
    const name=lab.track?.title||lab.catalog[this.songIndex]?.title||'NO SONG';
    const elapsed=lab.pack&&lab.clockStart!==null ?
      Math.max(0,lab.ctx.currentTime-lab.clockStart) : 0;
    this.statusText.setText(ellipsize(
      name+'  '+(this.dynamic?'NEW INSTRUMENTS':'SOURCE + DSP'),436));
    const second=Math.floor(elapsed);
    const minutes=Math.floor(second/60);
    const stamp=minutes+':'+String(second%60).padStart(2,'0');
    let diagnostic='WAITING FOR AUDIO DECODE';
    if(lab.pack){
      const index=lab.pack.segments.findIndex(seg=>
        seg.startFrame<=elapsed*lab.pack.sampleRate &&
        seg.startFrame+seg.frames>elapsed*lab.pack.sampleRate);
      const segment=lab.pack.segments[Math.max(0,index)];
      const name=lab._activeVoiceFor(lab.pack)||'drums';
      const buffer=lab.cache.get(Math.max(0,index)+'/'+name);
      diagnostic=buffer?
        'DECODED '+buffer.length+' / EXPECTED '+segment.frames+
        ' FRAMES ['+(buffer.length-segment.frames)+']' :
        'BUFFER FETCH / DECODE PENDING';
    }
    this.clockText.setText('TIME '+stamp+'  '+diagnostic);
    const frame=this._clockFrame();
    if(this.score && frame!==null){
      const roles=this.solo==='ALL'?PERFORMANCE_ROLES:
        [this.solo.toLowerCase()];
      const near=nearbyPerformanceEvents(this.score,roles,frame,4800);
      const examples=near.slice(0,3).map(({role,event})=>
        role.toUpperCase().slice(0,2)+':'+(event.pitch??event.class)+
        '@'+Math.round((event.startFrame-frame)/48)+'MS').join(' ');
      this.scoreText.setText(ellipsize(
        'SCORE '+this.score.scoreHash.slice(0,8)+' '+
        near.length+' ATTACK(S) +-100MS  '+examples,436));
    }else{
      this.scoreText.setText(ellipsize('SCORE: '+this.scoreStatus,436));
    }
    this.infoText.setText(ellipsize(this.markerStatus,436));
    this.inspector?.refresh();
  }
  handleAction(action){
    if(this.inspector)return this.inspector.handleAction(action);
    if(action==='alt'){this._openInspector();return true;}
    if(action==='cancel'){this.close();return true;}
    return this.menu.handleAction(action);
  }
  destroy(){
    this._closeInspector();
    ++this.request;
    ++this.scoreRequest;
    this.scene.input?.keyboard?.off('keydown-M',this._markKey);
    this._markKey=null;
    this.score=null;
    this.experimentalScore=null;
    this.tickTimer?.remove();
    this.lab?.destroy();
    this.lab=null;
    if(this.sourceBus&&this.audio?.ctx){
      this.sourceBus.gain.setTargetAtTime(
        this.prevBusVolume??1,this.audio.ctx.currentTime,.05);
    }
    this.sourceBus=null;
    super.destroy();
  }
}

/** Free-text seed entry (DOM input so touch keyboards work). */
export class SeedView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{onClose:function():void, onSubmit:function(string):void, initial?:string}} o
   */
  constructor(scene, theme, o) {
    super(scene, theme, { w: 340, h: 118, title: 'ENTER SEED', color: 'lime', onClose: o.onClose, y: 70 });
    this.onSubmit = o.onSubmit;
    const px = this.panel.x;
    const py = this.panel.y;
    this.panel.add(new NeonText(scene, theme, 12, 24, 'SAME SEED = SAME TRACK. SHARE IT WITH FRIENDS.', { color: 'text', outline: 'none' }).setAlpha(0.7));
    this.box = new DomTextBox(scene, theme, {
      x: px + 12, y: py + 40, w: 316, h: 20, value: o.initial || '', maxLength: 32, placeholder: 'TYPE A SEED (EMPTY = RANDOM)',
      color: 'lime', onSubmit: () => this.submit(), onCancel: () => this.close(),
    });
    this.panel.add(new NeonText(scene, theme, 12, 68, 'ENTER = GO     ESC = BACK', { color: 'text', outline: 'none' }).setAlpha(0.55));
    this.go = new Button(scene, theme, { x: 12, y: this.h - 22, w: 96, h: 16, label: 'GO!', color: 'lime', onClick: () => this.submit() });
    this.panel.add(this.go);
    scene.time.delayedCall(30, () => this.alive && this.box.focus());
  }

  submit() {
    if (this.alive) this.onSubmit(this.box.getValue().trim());
  }

  handleAction(action) {
    if (action === 'cancel') this.close();
    else if (action === 'confirm') this.submit();
    return true;
  }

  destroy() {
    if (this.box) this.box.destroy();
    this.box = null;
    super.destroy();
  }
}

/** Export (copy + visible fallback) or import (paste) of the leaderboard sharecode. */
export class SharecodeView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{mode:'export'|'import', onClose:function():void}} o
   */
  constructor(scene, theme, o) {
    const exp = o.mode === 'export';
    super(scene, theme, { w: 400, h: 168, title: exp ? 'EXPORT SHARECODE' : 'IMPORT SHARECODE', color: exp ? 'cyan' : 'lime', onClose: o.onClose, y: 50 });
    this.exp = exp;
    this.store = scene.registry.get(REG.SAVE_STORE);
    const px = this.panel.x;
    const py = this.panel.y;
    this.hint = new NeonText(scene, theme, 12, 22, exp ? 'YOUR LEDGER AS TEXT. COPY IT, SEND IT, IMPORT IT ELSEWHERE.' : 'PASTE A SHARECODE BELOW (CTRL+V), THEN PRESS IMPORT.', {
      color: 'text', outline: 'none',
    });
    this.hint.setAlpha(0.7);
    this.panel.add(this.hint);
    this.status = new NeonText(scene, theme, 12, this.h - 38, exp ? 'PREPARING...' : 'WAITING FOR PASTE', { color: 'amber', outline: 'none' });
    this.panel.add(this.status);
    this.box = new DomTextBox(scene, theme, {
      x: px + 12, y: py + 36, w: 376, h: 76, multiline: true, readOnly: exp, value: '',
      placeholder: exp ? '' : 'PASTE SHARECODE HERE', color: exp ? 'cyan' : 'lime',
      onSubmit: () => this.act(), onCancel: () => this.close(),
    });
    this.actBtn = new Button(scene, theme, {
      x: 12, y: this.h - 22, w: 110, h: 16, label: exp ? 'COPY AGAIN' : 'IMPORT', color: exp ? 'cyan' : 'lime', onClick: () => this.act(),
    });
    this.panel.add(this.actBtn);
    scene.time.delayedCall(30, () => this.alive && this.box && this.box.focus());
    if (exp) this._load();
  }

  async _load() {
    let code = '';
    try {
      code = await this.store.exportSharecode();
    } catch (e) {
      code = '';
    }
    if (!this.alive) return;
    this.code = code || '';
    if (!this.code) {
      this.box.setValue('(LEDGER IS EMPTY - NOTHING TO EXPORT YET)');
      this.setStatus('NO ENTRIES TO EXPORT', 'amber');
      return;
    }
    this.box.setValue(this.code);
    this.box.selectAll();
    this.act();
  }

  setStatus(text, color) {
    if (!this.alive) return;
    this.status.setText(ellipsize(text, 380));
    this.status.setColorKey(color);
  }

  async act() {
    if (!this.alive) return;
    if (this.exp) {
      if (!this.code) return;
      const ok = await copyText(this.code);
      if (!this.alive) return;
      if (ok) this.setStatus('COPIED TO CLIPBOARD', 'lime');
      else {
        this.setStatus('CLIPBOARD BLOCKED - TEXT SELECTED: PRESS CTRL+C', 'amber');
        this.box.selectAll();
      }
    } else {
      const text = this.box.getValue().trim();
      if (!text) {
        this.setStatus('NOTHING TO IMPORT - PASTE A SHARECODE FIRST', 'amber');
        return;
      }
      let res = { imported: 0, skipped: 0 };
      try {
        res = (await this.store.importSharecode(text)) || res;
      } catch (e) {
        res = { imported: 0, skipped: 1 };
      }
      if (!this.alive) return;
      if (res.imported > 0) this.setStatus(`IMPORTED ${res.imported} RUN(S), SKIPPED ${res.skipped}`, 'lime');
      else this.setStatus(`NOTHING IMPORTED (SKIPPED ${res.skipped}) - NOT A VALID SHARECODE?`, 'danger');
    }
  }

  handleAction(action) {
    if (action === 'cancel') this.close();
    else if (action === 'confirm') this.act();
    return true;
  }

  destroy() {
    if (this.box) this.box.destroy();
    this.box = null;
    super.destroy();
  }
}

/**
 * W1: PROFILE view — lifetime stats, Sync Level, Resonance progress, and the list of biome
 * signatures the player has reached (locked ones read "SIGNATURE LOCKED - COMING ONLINE" until
 * W3/W6 ship the biomes themselves). Read-only; nothing here writes the profile.
 *
 * All geometry and text come from `ProfileLayout.profileLayout()` so the layout is unit-tested for
 * overlap and contrast without Phaser; this class only draws it and repaints on palette change.
 */
export class ProfileView extends View {
  /** @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme @param {{onClose:function():void}} o */
  constructor(scene, theme, o) {
    const content = scene.registry.get(REG.CONTENT) || {};
    const biomeDefs = Object.values(content.biomes || {});
    const layout = profileLayout({
      profile: scene.registry.get(REG.PROFILE),
      levels: content.progression,
      playableBiomeIds: biomeDefs.map((d) => d.id),
      achievementTotal: ACHIEVEMENTS.length,
    });
    super(scene, theme, { w: layout.w, h: layout.h, title: 'PILOT PROFILE', color: 'lime', onClose: o.onClose, y: 22, backLabel: 'BACK' });
    this._onShop = o.onShop;

    for (const it of layout.items) {
      // Layout boxes are always top-left, so draw left-anchored and never let Phaser re-apply an
      // origin: passing anchor:'right' with a left edge shifted right-aligned text a second time.
      const t = new NeonText(scene, theme, it.x, it.y, it.text, {
        color: it.color, outline: it.outline, alpha: it.alpha,
      });
      this.panel.add(t);
    }

    // Resonance bar: XP progress inside the current level. Same paint as Game Over, so a player who
    // just levelled sees the same fill they saw there.
    const b = layout.bar;
    const bar = scene.add.graphics();
    this.panel.add(bar);
    this.unbindBar = theme.bind((pal) => {
      bar.clear();
      bar.fillStyle(pal.bg, 1);
      bar.fillRect(b.x, b.y, b.w, b.h);
      bar.fillStyle(pal[b.color], 1);
      bar.fillRect(b.x + 1, b.y + 1, Math.round((b.w - 2) * b.ratio), b.h - 2);
      bar.lineStyle(1, pal[b.color], 0.9);
      bar.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    });

    // W3: signature toggles. Only unlocked biomes get a row, and toggling one persists the profile so a
    // player's choice survives a reload. Toggling is cosmetic-adjacent but real: it changes which biome
    // sectors their next run can contain, which is why mask-scoped stats exist.
    // SHARD SHOP moved here from the Title menu: Title's band physically fits six 2x rows and the shop
    // was the seventh (it overran the DAILY PATCH strip). It sits on this screen because Profile is where
    // you already look at what you own and what it looks like.
    if (layout.shopButton) {
      const sb = layout.shopButton;
      this.shopButton = new Button(scene, theme, {
        x: sb.x, y: sb.y, w: sb.w, h: sb.h, label: 'SHARD SHOP', color: 'amber',
        onClick: () => this._openShop(),
      });
      this.panel.add(this.shopButton);
      // The button is pointer-only by design (Button's own doc says keyboard users reach the action
      // through scene-level keys). That was fine while the shop also had a Title row; it is now the ONLY
      // way in, so Profile has to provide the key path itself.
      this.shopFocus = new Phaser.GameObjects.Graphics(scene);
      this.panel.add(this.shopFocus);
    }

    this.biomeDefs = biomeDefs;
    const service = scene.registry.get(REG.PROGRESSION);
    this.profileStore = (service && service.store) || null;
    this.toggleRows = this._toggleRows();
    if (this.toggleRows.length) {
      const items = this.toggleRows.map((r) => ({
        kind: 'choice',
        // Decision 3: NAME + NEW / SEEN / DONE (ProfileLayout.toggleLabel), coloured by state.
        label: toggleLabel(r).text,
        color: toggleLabel(r).color,
        options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }],
        get: () => {
          const p = scene.registry.get(REG.PROFILE) || {};
          const row = biomeToggleRows(p, this.biomeDefs).find((x) => x.id === r.id);
          return Boolean(row && row.enabled);
        },
        set: (v) => this._setBiome(r.id, Boolean(v)),
      }));
      // Geometry from the layout, so the menu can never be drawn on top of the biome names again.
      const band = layout.toggleMenu;
      this.sigMenu = new MenuList(scene, theme, {
        x: band.x, y: band.y, w: band.w, rowH: band.rowH, items, color: 'magenta', parent: this.panel,
        // The layout balances the columns from its own count; never let a longer item list spill into a
        // third, off-panel column if the two counts ever disagree.
        columns: band.columns, rowsPerColumn: Math.max(band.rowsPerColumn, Math.ceil(items.length / band.columns)),
      });
    }

    // W5: the achievements grid opens from here, as the spec places it in the Profile view. The button
    // sits bottom-left because BACK owns bottom-right; the layout module owns both boxes so the two can
    // never be drawn on top of each other.
    if (layout.achButton) {
      const bb = layout.achButton;
      this.achButton = new Button(scene, theme, {
        x: bb.x, y: bb.y, w: bb.w, h: bb.h, label: 'ACHIEVEMENTS', color: 'amber',
        onClick: () => this._openAchievements(),
      });
      this.panel.add(this.achButton);
    }

    // SHOP-2: TITLES, third in the bottom strip. Opens the title picker, which replaces this view the way
    // the achievements grid does and returns here on BACK.
    if (layout.titlesButton) {
      const tb = layout.titlesButton;
      this.titlesButton = new Button(scene, theme, {
        x: tb.x, y: tb.y, w: tb.w, h: tb.h, label: 'TITLES', color: 'lime',
        onClick: () => this._openTitles(),
      });
      this.panel.add(this.titlesButton);
    }
  }

  /** Open the TITLES picker from inside the profile, replacing this view; BACK rebuilds the profile. */
  _openTitles() {
    uiSfx(this.scene, 'uiSelect');
    const scene = this.scene;
    const theme = this.theme;
    const onClose = this.onClose;
    const onShop = this._onShop;
    const next = new TitlesView(scene, theme, {
      onClose: () => {
        // Same order as the achievements grid: build the profile first, then destroy the picker, so the
        // picker's panel can never be left pinned over the Title menu.
        const back = new ProfileView(scene, theme, { onClose, onShop });
        next.destroy();
        scene.view = back;
      },
    });
    this.destroy();
    this.scene.view = next;
  }

  /** Open the achievements grid from inside the profile, replacing this view. */
  _openAchievements() {
    uiSfx(this.scene, 'uiSelect');
    const scene = this.scene;
    const theme = this.theme;
    const onClose = this.onClose;
    const onShop = this._onShop;
    const next = new AchievementsView(scene, theme, {
      onClose: () => {
        // Backing out of the grid returns to the PROFILE view the player came from, not to the Title
        // screen: ejecting them a screen further than they went in is a navigation bug the player feels.
        // The GRID is what gets destroyed here (this profile is already gone): destroying `this` instead
        // left the depth-500 grid pinned over the Title menu for good. The rebuilt profile keeps onShop,
        // or SHARD SHOP would silently just close it.
        const back = new ProfileView(scene, theme, { onClose, onShop });
        next.destroy();
        scene.view = back;
      },
      biomeDefs: this.biomeDefs,
    });
    this.destroy();
    this.scene.view = next;
  }

  /** Unlocked biomes as toggle rows (empty before any unlock). */
  _toggleRows() {
    try {
      return biomeToggleRows(this.scene.registry.get(REG.PROFILE) || {}, this.biomeDefs).filter((r) => r.unlocked);
    } catch (e) {
      return [];
    }
  }

  /**
   * Apply one toggle and persist it. `toggleBiome` flips, so it is called only when the desired state
   * differs from the current one - calling it unconditionally would invert an already-correct row.
   */
  _setBiome(id, on) {
    const prof = this.scene.registry.get(REG.PROFILE);
    if (!prof) return;
    const row = biomeToggleRows(prof, this.biomeDefs).find((x) => x.id === id);
    if (!row || row.enabled === on) return;
    const next = toggleBiome(prof, id, this.biomeDefs);
    const service = this.scene.registry.get(REG.PROGRESSION);
    const store = this.profileStore || (service && service.store) || null;
    try {
      if (store) {
        this.scene.registry.set(REG.PROFILE, store.save(next));
      } else {
        this.scene.registry.set(REG.PROFILE, next);
      }
    } catch (e) { /* a denied storage write must not break the menu */ }
  }

  /**
   * Open the shop from this screen.
   *
   * Kept as one method so the pointer button and the key path cannot diverge: the keyboard used to be
   * unable to reach the shop at all, which is only possible if the two entry points are separate code.
   */
  _openShop() {
    const go = this._onShop;
    this.close();
    if (go) go();
  }

  /**
   * Focus targets in visual order: the signature rows, then ACHIEVEMENTS, SHARD SHOP and BACK (the
   * bottom strip, left to right).
   *
   * ProfileView used to forward every action straight to `sigMenu`, which wraps inside its own five
   * rows — so keyboard and gamepad could never leave the toggles, and SHARD SHOP (the only route to the
   * shop) was unreachable without a mouse. A single ordered list is what makes it reachable: up/down walk
   * it, and confirm activates whichever entry holds focus.
   *
   * ACHIEVEMENTS was pointer-only (its button was never a target), so the grid could not be opened by
   * keyboard or pad. It sits before SHARD SHOP because it is left of it on screen; first focus still
   * lands on SHARD SHOP (`length - 2`) when there are no toggle rows.
   *
   * @returns {Array<{kind:'row'|'ach'|'buy'|'back', index?:number}>}
   */
  _focusTargets() {
    const out = [];
    const rows = this.sigMenu ? this.sigMenu.items.length : 0;
    for (let i = 0; i < rows; i += 1) out.push({ kind: 'row', index: i });
    if (this.achButton) out.push({ kind: 'ach' });
    if (this.shopButton) out.push({ kind: 'buy' });
    if (this.titlesButton) out.push({ kind: 'titles' });
    out.push({ kind: 'back' });
    return out;
  }

  /** Paint the focus ring on whichever target holds focus (rows are highlighted by MenuList itself). */
  _paintFocus() {
    if (!this.shopFocus) return;
    const g = this.shopFocus;
    const pal = this.theme.pal;
    g.clear();
    const t = this._focusTargets()[this.focusIdx];
    if (!t) return;
    let r = null;
    if (t.kind === 'ach' && this.achButton) r = { x: this.achButton.x, y: this.achButton.y, w: this.achButton.w, h: this.achButton.h };
    if (t.kind === 'buy' && this.shopButton) r = { x: this.shopButton.x, y: this.shopButton.y, w: this.shopButton.w, h: this.shopButton.h };
    if (t.kind === 'titles' && this.titlesButton) r = { x: this.titlesButton.x, y: this.titlesButton.y, w: this.titlesButton.w, h: this.titlesButton.h };
    if (t.kind === 'back' && this.back) r = { x: this.back.x, y: this.back.y, w: this.back.w, h: this.back.h };
    if (!r) return;
    g.lineStyle(1, pal[t.kind === 'back' ? 'magenta' : 'amber'], 1);
    g.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
  }

  handleAction(action) {
    if (action === 'cancel') {
      this.close();
      return true;
    }

    const targets = this._focusTargets();
    // Focus lives here, not in MenuList: the menu's own selection wraps inside its rows, which is exactly
    // why the shop was unreachable. One ordered list means one place that decides where focus is, and the
    // menu's highlight is a mirror of it rather than a second, competing cursor.
    if (this.focusIdx === undefined || this.focusIdx === null || this.focusIdx >= targets.length) {
      // Land on the first row if there is one; otherwise on the first button. Never on BACK, so the
      // first press moves into the screen rather than leaving it.
      // With no rows, SHARD SHOP (found by kind: TITLES now sits between it and BACK).
      const buyIdx = targets.findIndex((x) => x.kind === 'buy');
      this.focusIdx = this.sigMenu ? 0 : (buyIdx >= 0 ? buyIdx : Math.max(0, targets.length - 2));
      this._syncMenu();
      this._paintFocus();
      if (action !== 'confirm') return true;
    }

    const cur = targets[this.focusIdx];
    if (!cur) return true;

    if (action === 'up' || action === 'down') {
      const next = this.focusIdx + (action === 'up' ? -1 : 1);
      if (next < 0 || next >= targets.length) return true; // clamp: no wrap onto BACK by accident
      this.focusIdx = next;
      this._syncMenu();
      this._paintFocus();
      uiSfx(this.scene, 'uiMove');
      return true;
    }

    if (action === 'left' || action === 'right') {
      // Only a toggle row is horizontally adjustable; on the buttons this is a no-op, not an exit.
      if (cur.kind !== 'row' || !this.sigMenu) return true;
      this.sigMenu._adjust(cur.index, action === 'left' ? -1 : 1);
      return true;
    }

    if (action === 'confirm') {
      if (cur.kind === 'row' && this.sigMenu) {
        this.sigMenu.activate();
      } else if (cur.kind === 'buy') {
        uiSfx(this.scene, 'uiSelect');
        this._openShop();
      } else if (cur.kind === 'ach') {
        this._openAchievements();
      } else if (cur.kind === 'titles') {
        this._openTitles();
      } else {
        this.close();
      }
      return true;
    }
    return true;
  }

  /** Mirror this view's focus onto the menu's highlight. */
  _syncMenu() {
    if (!this.sigMenu) return;
    const t = this._focusTargets()[this.focusIdx];
    if (t && t.kind === 'row') this.sigMenu.setSelected(t.index, true);
  }

  destroy() {
    if (this.unbindBar) this.unbindBar();
    this.unbindBar = null;
    super.destroy();
  }
}

/**
 * W5: ACHIEVEMENTS grid. Read-only; nothing here writes the profile.
 *
 * Paged because 29 rows will not fit above a BACK button, and paging is done by swapping this view's own
 * text objects rather than rebuilding the panel: rebuilding would re-run the constructor and lose the
 * player's page when the palette changes.
 *
 * LEFT/RIGHT (or 'prev'/'next') page; cancel closes, which the base class already does.
 */
export class AchievementsView extends View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{onClose:function():void, page?:number, biomeCount?:number, biomeDefs?:Object[]}} o
   */
  constructor(scene, theme, o) {
    const profile = scene.registry.get(REG.PROFILE);
    const biomeDefs = o.biomeDefs || Object.values((scene.registry.get(REG.CONTENT) || {}).biomes || {});
    const layout = achievementsLayout({
      profile,
      page: o.page || 0,
      // ACH-6: no catalogue-size default. The grid reads the profile's ENCOUNTERED count (decision 3); only an
      // explicit caller figure is passed through.
      biomeCount: o.biomeCount,
    });
    super(scene, theme, { w: layout.w, h: layout.h, title: 'ACHIEVEMENTS', color: 'amber', onClose: o.onClose, y: 13, backLabel: 'BACK' });
    this.profile = profile;
    this.biomeDefs = biomeDefs;
    this.biomeCount = o.biomeCount;
    this.page = layout.page;
    this.rows = [];
    this._paint();
  }

  /** Draw the current page, replacing whatever was drawn for the previous one. */
  _paint() {
    for (const t of this.rows) t.destroy();
    this.rows = [];
    const layout = achievementsLayout({
      profile: this.scene.registry.get(REG.PROFILE) || this.profile,
      page: this.page,
      biomeCount: this.biomeCount,
    });
    this.page = layout.page;
    this.pages = layout.pages;
    for (const it of layout.items) {
      // Same rule as ProfileView: layout boxes are top-left, so never re-apply an origin.
      const t = new NeonText(this.scene, this.theme, it.x, it.y, it.text, {
        color: it.color, outline: it.outline, alpha: it.alpha,
      });
      this.panel.add(t);
      this.rows.push(t);
    }
  }

  /** Move by `delta` pages, clamped, and repaint only when the page actually changes. */
  _turn(delta) {
    const next = clampPage(this.page + delta);
    if (next === this.page) return false;
    this.page = next;
    this._paint();
    uiSfx(this.scene, 'uiMove');
    return true;
  }

  handleAction(action) {
    if (action === 'cancel') {
      this.close();
      return true;
    }
    if (action === 'left') return this._turn(-1);
    if (action === 'right') return this._turn(1);
    // Confirm is a no-op on a read-only grid rather than closing it: a player paging with confirm would
    // otherwise be ejected from the screen they were reading.
    if (action === 'confirm') return true;
    return true;
  }
}

/**
 * W4: SHARD SHOP — buy cosmetics and equip them, and set the pre-run boost loadout.
 *
 * One action per row ("get me this") rather than a BUY then EQUIP dance: if the player owns it, selecting
 * equips it; if they can afford it, selecting buys and equips in one atomic save. Both paths go through
 * ProfileStore's pure functions, so the cannot-go-negative / cannot-double-buy rules are enforced in the
 * tested layer and this view only chooses which rule to invoke.
 *
 * Boosts live here too because they are the same shape of decision (a spend, then a persistent choice) and
 * because the spec makes them "chosen on a pre-run loadout" — this is that loadout screen.
 */
export class ShopView extends View {
  /** @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme @param {{onClose:function():void}} o */
  constructor(scene, theme, o) {
    const layout = shopLayout({ profile: scene.registry.get(REG.PROFILE), levels: (scene.registry.get(REG.CONTENT) || {}).progression, page: 0 });
    super(scene, theme, {
      w: layout.w, h: layout.h, title: 'SHARD SHOP', color: 'amber', onClose: o.onClose, y: 22, backLabel: 'BACK',
    });

    this.service = scene.registry.get(REG.PROGRESSION);
    this.store = (this.service && this.service.store) || null;

    // ONE MenuList for the whole panel: headers, item rows, boosts and the loadout line are items in the
    // same list, so they all share one row pitch and cannot be drawn over each other. Nothing else is
    // drawn into this panel except the frame and BACK.
    this.menu = null;
    // F4 fit: the catalogue is paged by slot (ShopLayout.SHOP_PAGES). The page row is the first selectable
    // row, so the shop opens with focus on "← TRAIL →" and left/right is the first thing a player tries.
    this.page = 0;
    this._build();
  }

  _profile() {
    return this.scene.registry.get(REG.PROFILE) || {};
  }

  /** The panel's single source of truth: layout rows + menu items, rebuilt together every time. */
  _menuItems(layout) {
    return shopMenuItems(layout).map((m) => {
      if (m.rowKind === 'page') {
        // Confirm or a click turns the page forward; left/right are handled in handleAction. An action
        // row, not a choice row: MenuList repaints a choice row after its setter runs, and the setter here
        // rebuilds the whole menu.
        return { kind: 'action', rowKind: 'page', label: m.label, sub: m.sub, disabled: false, onSelect: () => this._turnPage(1) };
      }
      if (m.rowKind === 'item') {
        return { kind: 'action', rowKind: 'item', id: m.id, label: m.label, sub: m.sub, disabled: m.disabled, onSelect: () => this._choose(m.id) };
      }
      if (m.rowKind === 'boost' && m.disabled) {
        // F3: not unlocked yet. Drawn with its unlock level, never focusable, never toggled.
        return { kind: 'action', label: m.label, boostId: m.boostId, sub: m.sub, disabled: true };
      }
      if (m.rowKind === 'boost') {
        return {
          kind: 'choice',
          label: m.label,
          // Carried so the built-game gate can find this row by id and read it back. Without it the row
          // is identified only by its label text, which makes the stale-toggle defect ungatable.
          boostId: m.boostId,
          options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }],
          // Read the live profile: a `boosts` snapshot captured here goes stale the moment the toggle is set.
          get: () => (this._profile().boosts || {})[m.boostId] === true,
          set: (v) => this._setBoost(m.boostId, Boolean(v)),
        };
      }
      // Headings and the BANK/loadout lines: real rows in the list for geometry, never selectable.
      return { kind: 'static', label: m.label, disabled: true };
    });
  }

  _levels() {
    return (this.scene.registry.get(REG.CONTENT) || {}).progression;
  }

  _build() {
    const layout = shopLayout({ profile: this._profile(), levels: this._levels(), page: this.page });
    this.page = layout.page;
    if (this.menu) { this.menu.destroy(); this.menu = null; }
    // The bank value is drawn outside the list (the list right-aligns only row state), so it has to be
    // torn down with it or every rebuild would stack another "BANK n" on the same pixel.
    for (const t of (this.bankTexts || [])) t.destroy();
    this.bankTexts = [];
    const band = layout.band;
    this.menu = new MenuList(this.scene, this.theme, {
      x: band.x, y: band.y, w: band.w, rowH: layout.rowH,
      items: this._menuItems(layout), color: 'lime', parent: this.panel,
    });
    // The BANK line is a right-aligned value in the list, not a separate static string, so it refreshes
    // with everything else. MenuList would draw it as a label, so it is rendered beside the list at the
    // head row's own y.
    const head = layout.rows.find((r) => r.kind === 'head');
    if (head && head.texts) {
      for (const t of head.texts) {
        const txt = new NeonText(this.scene, this.theme, t.x, t.y, t.text, { color: t.color });
        this.panel.add(txt);
        this.bankTexts.push(txt);
      }
    }
  }

  /**
   * Buy-or-equip, atomically. A refused purchase leaves the profile untouched: `purchase` returns the same
   * object by identity when it declines, which is how that is detected without duplicating its rules here.
   *
   * Selecting the row that is already EQUIPPED takes it off: the slot goes back to DEFAULT (SHOP-3). That
   * is the only way back to the default look, so it is the same one-action-per-row rule run in reverse.
   */
  _choose(id) {
    const prof = this._profile();
    let next = prof;
    try {
      const item = shopItem(id);
      const eq = (prof.equipped && typeof prof.equipped === 'object') ? prof.equipped : {};
      if (item && isOwned(prof, id) && (eq[item.slot] === item.value || eq[item.slot] === id)) {
        uiSfx(this.scene, 'uiBack');
        next = unequip(prof, item.slot);
        this.scene.registry.set(REG.PROFILE, this.store ? this.store.save(next) : next);
        this._refresh();
        return;
      }
      if (!isOwned(prof, id)) {
        const bought = purchase(prof, id);
        if (bought === prof) { uiSfx(this.scene, 'uiBack'); return; }
        next = bought;
        uiSfx(this.scene, 'uiSelect', { pitch: 1.4 });
      } else {
        uiSfx(this.scene, 'uiSelect');
      }
      next = equip(next, id);
      this.scene.registry.set(REG.PROFILE, this.store ? this.store.save(next) : next);
    } catch (e) {
      // A denied storage write must not break the shop; the in-memory choice still shows this session.
      this.scene.registry.set(REG.PROFILE, next);
    }
    this._refresh();
  }

  _setBoost(id, on) {
    const prof = this._profile();
    const next = { ...prof, boosts: { ...(prof.boosts || {}), [id]: on } };
    try {
      this.scene.registry.set(REG.PROFILE, this.store ? this.store.save(next) : next);
    } catch (e) {
      this.scene.registry.set(REG.PROFILE, next);
    }
  }

  /**
   * Rebuild the whole list after a purchase or a boost toggle.
   *
   * This used to patch only the menu's rows, which is why the bank line, the owned/equipped states and the
   * loadout summary went stale (CC Friday's defect 2). Rebuilding from the layout means every visible
   * string comes from the same profile read, so nothing can lag behind.
   */
  _refresh() {
    const keep = this.menu ? this.menu.selected : 0;
    // SHOP-5: an equipped (or removed) theme recolours the UI, so the scene's Theme re-reads the profile
    // and repaints every bound painter, the screen under the shop included.
    if (this.theme && typeof this.theme.refresh === 'function') this.theme.refresh();
    this._build();
    if (this.menu) this.menu.setSelected(Math.min(keep, this.menu.items.length - 1), true);
  }

  /**
   * Show the next (dir 1) or previous (dir -1) slot page, wrapping. Focus stays on the page row when it was
   * there; from an item row it stays on the same row index if the new page has an item there, else it goes
   * to the page row, so focus never lands on a heading.
   */
  _turnPage(dir) {
    const was = this.menu ? this.menu.items[this.menu.selected] : null;
    const keep = this.menu ? this.menu.selected : 0;
    this.page += dir < 0 ? -1 : 1;
    this._build();
    if (!this.menu) return;
    const pageIdx = this.menu.items.findIndex((i) => i.rowKind === 'page');
    const at = this.menu.items[keep];
    const target = (was && was.rowKind === 'item' && at && at.rowKind === 'item' && !at.disabled) ? keep : pageIdx;
    this.menu.setSelected(Math.max(0, target), true);
    uiSfx(this.scene, 'uiMove');
  }

  handleAction(action) {
    if (action === 'cancel') { this.close(); return true; }
    if (action === 'left' || action === 'right') {
      // The slot IS the page, so left/right on the page row or on any catalogue row turns it. On a boost
      // row they still toggle the boost (MenuList's own choice handling).
      const cur = this.menu && this.menu.items[this.menu.selected];
      if (cur && (cur.rowKind === 'page' || cur.rowKind === 'item')) {
        this._turnPage(action === 'left' ? -1 : 1);
        return true;
      }
    }
    return this.menu.handleAction(action);
  }
}

/**
 * SHOP-2: TITLES — buy (Static Rider) and equip titles, or go back to the level title.
 *
 * Same one-action-per-row rule as the shop: an owned title equips, an affordable one buys and equips in one
 * atomic save, EQUIPPED (or the DEFAULT row) puts the slot back to DEFAULT. Achievement titles show
 * ACHIEVEMENT until earned and cannot be selected. Opened from the Profile view; BACK returns there.
 */
export class TitlesView extends View {
  /** @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme @param {{onClose:function():void}} o */
  constructor(scene, theme, o) {
    const layout = titlesLayout({ profile: scene.registry.get(REG.PROFILE), levels: (scene.registry.get(REG.CONTENT) || {}).progression });
    super(scene, theme, { w: layout.w, h: layout.h, title: 'TITLES', color: 'lime', onClose: o.onClose, y: 40, backLabel: 'BACK' });
    const service = scene.registry.get(REG.PROGRESSION);
    this.store = (service && service.store) || null;
    this.menu = null;
    this.bankTexts = [];
    this._build();
  }

  _profile() {
    return this.scene.registry.get(REG.PROFILE) || {};
  }

  _build() {
    const layout = titlesLayout({ profile: this._profile(), levels: (this.scene.registry.get(REG.CONTENT) || {}).progression });
    if (this.menu) { this.menu.destroy(); this.menu = null; }
    for (const t of this.bankTexts) t.destroy();
    this.bankTexts = [];
    const items = titlesMenuItems(layout).map((m) => (m.kind === 'action'
      ? { ...m, onSelect: () => this._choose(m.id) }
      : { kind: 'static', label: m.label, disabled: true }));
    const band = layout.band;
    this.menu = new MenuList(this.scene, this.theme, {
      x: band.x, y: band.y, w: band.w, rowH: layout.rowH, items, color: 'lime', parent: this.panel,
    });
    const head = layout.rows.find((r) => r.kind === 'head');
    for (const t of (head && head.texts) || []) {
      const txt = new NeonText(this.scene, this.theme, t.x, t.y, t.text, { color: t.color });
      this.panel.add(txt);
      this.bankTexts.push(txt);
    }
  }

  _save(next) {
    try {
      this.scene.registry.set(REG.PROFILE, this.store ? this.store.save(next) : next);
    } catch (e) {
      this.scene.registry.set(REG.PROFILE, next);
    }
  }

  /** Buy-or-equip a title, or return the slot to DEFAULT. Atomic: a refused purchase changes nothing. */
  _choose(id) {
    const prof = this._profile();
    const eq = (prof.equipped && typeof prof.equipped === 'object') ? prof.equipped : {};
    if (id === 'default') {
      this._save(unequip(prof, 'title'));
      uiSfx(this.scene, 'uiBack');
      this._refresh();
      return;
    }
    const item = shopItem(id);
    if (!item || item.slot !== 'title') return;
    if (isOwned(prof, id) && (eq.title === item.value || eq.title === id)) {
      this._save(unequip(prof, 'title'));
      uiSfx(this.scene, 'uiBack');
      this._refresh();
      return;
    }
    let next = prof;
    if (!isOwned(prof, id)) {
      next = purchase(prof, id);
      if (next === prof) { uiSfx(this.scene, 'uiBack'); return; }
      uiSfx(this.scene, 'uiSelect', { pitch: 1.4 });
    }
    this._save(equip(next, id));
    this._refresh();
  }

  _refresh() {
    const keep = this.menu ? this.menu.selected : 0;
    this._build();
    if (this.menu) this.menu.setSelected(Math.min(keep, this.menu.items.length - 1), true);
  }

  handleAction(action) {
    if (action === 'cancel') { this.close(); return true; }
    return this.menu.handleAction(action);
  }

  destroy() {
    for (const t of this.bankTexts || []) t.destroy();
    this.bankTexts = [];
    super.destroy();
  }
}
