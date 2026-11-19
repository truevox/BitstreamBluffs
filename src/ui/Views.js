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
import { NeonText, glowRectPx, strokeRectPx } from './Neon.js';
import { Keycaps, SectionHeader, paintRule, paintGlowBar, paintFocusRing, paintStateChip, paintPattern,
  staggerMenuRows, staggerAlpha, LOCK_GLYPH, SHARD_GLYPH, CHECK_GLYPH } from './ViewChrome.js';
import { Button } from './Button.js';
import { MenuList } from './MenuList.js';
import { LeaderboardTable } from './LeaderboardTable.js';
import { DomTextBox } from './DomTextBox.js';
import { copyText } from './Clipboard.js';
import { uiSfx } from './Sound.js';
import { transitionIn, transitionOut } from './Motion.js';
import { ellipsize, measureText } from './PixelFont.js';
import { profileLayout, toggleLabel } from './ProfileLayout.js';
import { achievementsLayout, clampPage } from './AchievementsLayout.js';
import { visibleAchievements } from '../systems/Achievements.js';
import { shopLayout, upgradeShopLayout, shopMenuItems, titlesLayout, titlesMenuItems, gymSetupLayout } from './ShopLayout.js';
import { toggleBiome, biomeToggleRows, purchase, equip, unequip, isOwned, shopItem } from '../systems/ProfileStore.js';
import { VOCALS_UNLOCK_SHARDS } from '../systems/ProfileStore.js';
import { StemMusicDirector } from '../systems/music/StemMusicDirector.js';
import { ScoreInspectorView } from './ScoreInspectorView.js';
import { StemMixerView } from './StemMixerView.js';
import { HowToPlayView } from './HowToPlayView.js';
import { freshLabLevels,applyLabStemLevels,LAB_STEMS } from '../systems/music/LabStemMix.js';
import {DRAFT_BUDGET,DRAFT_RULES_VERSION,DRAFT_UPGRADES,draftCost,changeDraftRank,sanitizeDraftRanks} from '../systems/DailyDraft.js';
import { BIOME_IDS, HOME_BIOME } from '../systems/music/BiomeVoices.js';
import { resolveMusicAsset } from '../systems/music/MusicPack.js';
import { validateMusicReviewQueue } from '../systems/music/MusicReviewQueue.js';
import { validatePerformanceScore, validateExperimentalPerformanceScore,
  nearbyPerformanceEvents, makeIssueMarker, PERFORMANCE_ROLES } from '../systems/music/PerformanceScore.js';

/**
 * Base: centred panel with a BACK button.
 *
 * Motion: the panel opens with Motion.transitionIn (a CRT zip: a line draws across, the panel unfolds from
 * it) and closes with Motion.transitionOut (a ghost frame collapses where the panel was). Both collapse to a
 * short fade under reduce motion. The panel's geometry is never animated away from its layout outside the
 * open tween, and destroy() stays synchronous (the ghost is a separate, self-destroying graphic), so view
 * navigation and teardown behave exactly as before for every caller and test. The host scene owns the
 * dim layer behind the panel (Motion.openDim/closeDim).
 */
export class View {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('./Theme.js').Theme} theme
   * @param {{w:number,h:number,title:string,color?:string,onClose:function():void,y?:number,backLabel?:string,
   *          hints?:Array<{keys?:string[],key?:string,label?:string}>, hintsAt?:'tab'|'foot'}} o
   *   `hints` draws a keycap row: in the title-tab line (right-aligned, the default) or at the panel foot,
   *   left of BACK. A tab-row hint that would run into the title tab is dropped, never overlapped.
   */
  constructor(scene, theme, o) {
    this.scene = scene;
    this.theme = theme;
    this.onClose = o.onClose;
    this.alive = true;
    const x = Math.round((GAME_WIDTH - o.w) / 2);
    const y = o.y !== undefined ? o.y : Math.round((GAME_HEIGHT - o.h) / 2);
    this.frameColorKey = o.color || 'cyan';
    this.panel = new Panel(scene, theme, { x, y, w: o.w, h: o.h, title: o.title, color: this.frameColorKey, fillAlpha: 1 });
    this.panel.setDepth(500);
    this.w = o.w;
    this.h = o.h;
    this.back = new Button(scene, theme, {
      x: o.w - 76, y: o.h - 22, w: 68, h: 16, label: o.backLabel || 'BACK', color: 'magenta', onClick: () => this.close(),
    });
    this.panel.add(this.back);
    this.hintRow = null;
    if (o.hints && o.hints.length) {
      const foot = o.hintsAt === 'foot';
      const caps = new Keycaps(scene, theme, {
        x: foot ? 12 : o.w - 10, y: foot ? o.h - 19 : 2, items: o.hints, align: foot ? 'left' : 'right', color: this.frameColorKey,
      });
      // the tab is the title plus 16 px padding, a 10 px slant and the three data ticks (~26 px)
      const tabEnd = measureText(String(o.title || '')) + 16 + 10 + 26;
      if (!foot && caps.x < tabEnd) caps.destroy();
      else { this.panel.add(caps); this.hintRow = caps; }
    }
    transitionIn(scene, this.panel, { w: o.w, h: o.h, color: theme.color(this.frameColorKey) });
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
    if (this.panel) {
      // A hidden panel (Settings while Manage Sound is open over it) leaves no ghost: it was not on screen.
      if (this.panel.visible !== false && this.panel.scene) {
        transitionOut(this.scene, {
          x: this.panel.x, y: this.panel.y, w: this.w, h: this.h,
          color: this.theme.color(this.frameColorKey), depth: 501,
        });
      }
      this.panel.destroy();
    }
    this.panel = null;
  }
}

/** Top-10 leaderboard from SaveStore. */
export class LeaderboardView extends View {
  /** @param {Phaser.Scene} scene @param {import('./Theme.js').Theme} theme @param {{onClose:function():void}} o */
  constructor(scene, theme, o) {
    // 188, not 178: the board switch needs an on-screen key hint, and the only free line is between the
    // tenth table row (panel y ~146) and the button strip. At y 40 the panel still ends at 228 of 270.
    super(scene, theme, { w: 440, h: 188, title: 'LEDGER // TOP 10 ON THIS DEVICE', color: 'cyan', onClose: o.onClose, y: 40,
      hints: [{ keys: ['← →', 'N', 'PAD X'], label: 'SWITCH BOARD' }] });
    // opt-in: a host that knows the player's latest run can pass its id to light that row up
    this.highlightId = o.highlightId;
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
    // The switch was pointer-only: no key reached it. The keycap row in the title-tab line (see the super
    // call) names every key that now does.
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
      this.table.setEntries(rows || [], this.highlightId, empty ? {
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
    paintFocusRing(g, this.theme.pal, b, this.focusIdx === 0 ? 'amber' : 'magenta');
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

/** Rows in the Settings list; the panel height is derived from it (see SettingsView). */
const SETTINGS_ROWS = 13;

/** Settings: palette, screen shake, volumes, tilt controls (persisted via updateSetting). */
export class SettingsView extends View {
  constructor(scene, theme, o) {
    // Height follows the row count (22 + rows * 14 + 30): the rows end at 22 + rows * 14, then a divider
    // and the palette-swatch row. Thirteen rows is 234, which at y 28 ends at 262 of 270.
    const h = 22 + SETTINGS_ROWS * 14 + 30;
    super(scene, theme, { w: 360, h, title: 'SETTINGS',
      color: 'amber', onClose: o.onClose, y: Math.max(8, Math.min(40, 262 - h)), backLabel: 'DONE',
      hints: [{ keys: ['↑', '↓'], label: 'SELECT' }, { keys: ['←', '→'], label: 'CHANGE' }] });
    this.soundView=null;
    this.howView=null;
    const game=scene.game;
    const settings=()=>game.registry.get(REG.SETTINGS)||{};
    const items=[
      { kind:'choice',label:'PALETTE',options:[
        {value:'default',label:'NEON'},{value:'colorblind',label:'COLOR-BLIND'}],
        get:()=>settings().palette,set:v=>updateSetting(game,'palette',v) },
      { kind:'choice',label:'SCREEN SHAKE',options:[
        {value:true,label:'ON'},{value:false,label:'OFF'}],
        get:()=>settings().screenShake!==false,set:v=>updateSetting(game,'screenShake',v) },
      // Next to SCREEN SHAKE: both are motion-comfort switches. AUTO follows the OS reduced-motion setting.
      { kind:'choice',label:'REDUCE MOTION',options:[
        {value:'auto',label:'AUTO'},{value:'on',label:'ON'},{value:'off',label:'OFF'}],
        get:()=>settings().reduceMotion||'auto',set:v=>updateSetting(game,'reduceMotion',v) },
      {kind:'slider',label:'MASTER VOLUME',get:()=>settings().masterVolume,
        set:v=>updateSetting(game,'masterVolume',v)},
      {kind:'slider',label:'MUSIC VOLUME',get:()=>settings().musicVolume,
        set:v=>updateSetting(game,'musicVolume',v)},
      {kind:'slider',label:'SFX VOLUME',get:()=>settings().sfxVolume,
        set:v=>updateSetting(game,'sfxVolume',v)},
      {kind:'slider',label:'SLED WIND',get:()=>settings().windVolume??1,
        set:v=>updateSetting(game,'windVolume',v)},
      {kind:'choice',label:'WIND',options:[
        {value:true,label:'ON'},{value:false,label:'OFF'}],
        get:()=>settings().windEnabled!==false,set:v=>updateSetting(game,'windEnabled',v)},
      {kind:'choice',label:'CONTROLS',options:[
        {value:'tricksRight',label:'TRICKS RIGHT'},{value:'tricksLeft',label:'TRICKS LEFT'},
        {value:'classic',label:'CLASSIC'}],
        get:()=>settings().controlLayout||'tricksRight',set:v=>updateSetting(game,'controlLayout',v)},
      {kind:'action',label:'MANAGE SOUND',color:'cyan',sub:'SONGS / VOCALS / LAB',
        onSelect:()=>this._openSoundManager()},
      // Opens the controls reference as a sibling view over this one (same hand-off as MANAGE SOUND), so
      // neither host scene needs to know about it; closing it returns here.
      {kind:'action',label:'HOW TO PLAY',color:'cyan',sub:'CONTROLS / GAMEPAD / TOUCH',
        onSelect:()=>this._openHowToPlay()},
      {kind:'choice',label:'TILT CONTROLS (90)',options:[
        {value:false,label:'OFF'},{value:true,label:'ON'}],
        get:()=>!!settings().touchRotate90,set:v=>updateSetting(game,'touchRotate90',v)},
      {kind:'choice',label:'TOUCH BUTTONS',options:[
        {value:'auto',label:'AUTO'},{value:'on',label:'ON'},{value:'off',label:'OFF'}],
        get:()=>settings().touchOverlay||'auto',set:v=>updateSetting(game,'touchOverlay',v)},
    ];
    this.menu=new MenuList(scene,theme,{x:10,y:22,w:340,rowH:14,
      items,color:'amber',parent:this.panel});
    staggerMenuRows(scene,this.menu);
    this.swatch=scene.add.graphics();
    this.panel.add(this.swatch);
    // what the live palette looks like: four glowing chips and its name, under a divider
    this.swatchLabel=new NeonText(scene,theme,10+4*22+6,this.h-17,'',{color:'text',outline:'none',alpha:0.7});
    this.panel.add(this.swatchLabel);
    this.unbindSwatch=theme.bind(pal=>{
      const g=this.swatch;
      g.clear();
      paintRule(g,10,this.w-10,this.h-27,pal.amber,0.6);
      ['cyan','magenta','lime','amber'].forEach((k,i)=>{
        glowRectPx(g,10+i*22,this.h-20,18,12,pal[k],1);
        g.fillStyle(pal[k],1);g.fillRect(10+i*22,this.h-20,18,12);
        g.fillStyle(pal.bg,1);g.fillRect(12+i*22,this.h-18,14,8);
        g.fillStyle(pal[k],1);g.fillRect(14+i*22,this.h-16,10,4);
      });
      this.swatchLabel.setText(settings().palette==='colorblind'?'COLOR-BLIND PALETTE':'NEON PALETTE');
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
  _openHowToPlay(){
    if(this.howView||this.soundView)return;
    this.panel.setVisible(false);
    this.howView=new HowToPlayView(this.scene,this.theme,{
      onClose:()=>{
        this.howView?.destroy();
        this.howView=null;
        this.panel.setVisible(true);
      },
    });
  }
  handleAction(action){
    if(this.howView)return this.howView.handleAction(action);
    if(this.soundView)return this.soundView.handleAction(action);
    if(action==='cancel'){this.close();return true;}
    return this.menu.handleAction(action);
  }
  destroy(){
    this.soundView?.destroy();this.soundView=null;
    this.howView?.destroy();this.howView=null;
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
      color:'cyan',onClose:o.onClose,y:15,
      hints:[{keys:['↑','↓'],label:'SELECT'},{keys:['←','→'],label:'CHANGE'}]});
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
      {kind:'choice',label:'SHUFFLE SONGS',options:[
          {value:false,label:'OFF'},{value:true,label:'ON'}],
        get:()=>settings().musicShuffle===true,
        set:v=>updateSetting(game,'musicShuffle',v)},
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
          VOCALS_UNLOCK_SHARDS+' SHARDS)',color:'amber',tint:'amber',
          sub:bank+' AVAILABLE',subColor:'amber',subAlpha:0.9,onSelect:()=>this._buyVocals()},
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
    if(!this._revealed){this._revealed=true;staggerMenuRows(this.scene,this.menu);}
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
      color:'lime',onClose:o.onClose,y:7,
      hints:[{keys:['M'],label:'MARK'},{keys:['N'],label:'NOTES'}]});
    this.audio=scene.registry.get(REG.AUDIO);
    this.biome='crystal-cavern';
    this.songIndex=0;
    this.dynamic=false;
    this.solo='ALL';
    this.mixLevels=freshLabLevels(); // per-lab-session only
    this.mixerView=null;
    this.airborne=false;
    this.speed=0;
    this.lab=null;
    this.request=0;
    this.scoreRequest=0;
    this.score=null;
    this.scoreStatus='WAITING FOR SCORE MANIFEST';
    this.experimentalScore=null;
    this.experimentalStatus='EXPERIMENTAL COMPARISON NOT LOADED';
    this.reviewQueue=null;
    this.reviewStatus='NO MACHINE REVIEW SHORTLIST LOADED';
    this.markers=[]; // lab session only, not localStorage or profile
    this.markerStatus='NO AUDIO OR GAME SAVES ARE CHANGED';
    this.inspector=null;
    this.drafts=new Map(); // per-source-revision, session only

    this.sourceBus=null;
    this.prevBusVolume=null;
    // The four readout lines sit in an inset "display": dark well, thin frame, an amber edge. Added before
    // the texts so it paints under them.
    this.readout=scene.add.graphics();
    this.panel.add(this.readout);
    this._unbindReadout=theme.bind(pal=>{
      const g=this.readout;
      g.clear();
      g.fillStyle(pal.bg,0.85);g.fillRect(8,184,this.w-16,46);
      strokeRectPx(g,8,184,this.w-16,46,pal.cyan,0.3);
      g.fillStyle(pal.amber,0.9);g.fillRect(8,184,2,46);
    });
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
      x:13,y:235,w:62,h:14,label:'MARK (M)',color:'amber',
      onClick:()=>this._markIssue(),parent:this.panel,
    });
    this.inspectButton=new Button(scene,theme,{
      x:80,y:235,w:70,h:14,label:'NOTES (N)',color:'lime',
      onClick:()=>this._openInspector(),parent:this.panel,
    }).setDisabled(true);
    this.mixerButton=new Button(scene,theme,{
      x:155,y:235,w:70,h:14,label:'MIXER',color:'lime',
      onClick:()=>this._openMixer(),parent:this.panel,
    });
    this.exportButton=new Button(scene,theme,{
      x:230,y:235,w:88,h:14,label:'EXPORT MARKS',color:'cyan',
      onClick:()=>this._exportMarks(),parent:this.panel,
    }).setDisabled(true);
    this.clearButton=new Button(scene,theme,{
      x:323,y:235,w:60,h:14,label:'CLEAR',color:'magenta',
      onClick:()=>this._clearMarks(),parent:this.panel,
    }).setDisabled(true);
    this._markKey=event=>{
      if(!this.alive||this.inspector||this.mixerView||event?.repeat)return;
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
    this.reviewQueue=null;
    this.reviewStatus='REVIEW SHORTLIST NOT LOADED';
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
      // Ranked disagreements remain optional and never touch playback.
      void this._loadReviewQueue(lab,id,generation,base,experimental);
    }catch(err){
      if(this.alive&&generation===this.scoreRequest){
        this.experimentalScore=null;
        this.experimentalStatus='V2 REJECTED: '+String(err?.message||err);
      }
    }
    this.inspector?.refresh();
  }
  async _loadReviewQueue(lab,id,generation,base,experimental){
    const asset=lab.pack?.diagnosticReviewQueue;
    if(!asset){
      this.reviewStatus='NO REVIEW SHORTLIST IN THIS PACK';
      return;
    }
    this.reviewStatus='MACHINE DISAGREEMENT SHORTLIST LOADING';
    try{
      const response=await fetch(resolveMusicAsset(lab.packBase,asset.path),
        {cache:'default'});
      if(!response.ok)throw new Error('Review HTTP '+response.status);
      const raw=await response.json();
      const queue=validateMusicReviewQueue(raw,lab.pack,base,experimental);
      if(!this.alive||generation!==this.scoreRequest||this.lab!==lab||
        lab.track?.id!==id||this.score!==base||
        this.experimentalScore!==experimental)return;
      this.reviewQueue=queue;
      this.reviewStatus='MACHINE DISAGREEMENTS (NOT VERIFIED ERRORS)';
    }catch(err){
      if(this.alive&&generation===this.scoreRequest&&this.lab===lab&&
        this.experimentalScore===experimental){
        this.reviewQueue=null;
        this.reviewStatus='REVIEW SHORTLIST REJECTED: '+String(err?.message||err);
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
    if(this.inspector||this.mixerView||!this.score||!this.lab?.pack)return;
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
  _openMixer(){
    if(this.inspector||this.mixerView||!this.lab?.ready)return;
    this.mixerView=new StemMixerView(this.scene,this.theme,{
      lab:this,onClose:()=>this._closeMixer(),
    });
  }
  _closeMixer(){
    this.mixerView?.destroy();
    this.mixerView=null;
    this._tick();
  }
  _setStemLevel(role,level){
    if(!LAB_STEMS.includes(role)||![0,.35,1,1.35].includes(level))return;
    this.mixLevels[role]=level;
    this._applySolo();
  }
  _resetStemMix(){
    this.mixLevels=freshLabLevels();
    this._solo('ALL');
  }
  _song(index){
    this._closeInspector();
    this._closeMixer();
    ++this.scoreRequest;
    this.score=null;
    this.experimentalScore=null;
    this.reviewQueue=null;
    this.reviewStatus='SWITCHING REVIEW SHORTLIST';
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
    this._applySolo();
  }
  _air(value){
    this.airborne=value===true;
    this.lab?.setAirborne(this.airborne);
    this._applySolo();
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
    // Preserve motion/airborne automation on its separate WebAudio gain
    // nodes while applying 6 independent ephemeral user mix levels.
    lab.setSpeed(this.speed);
    lab.setAirborne(this.airborne);
    applyLabStemLevels(lab,this.mixLevels,this.solo);
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
    this.mixerView?.refresh();
  }
  handleAction(action){
    if(this.mixerView)return this.mixerView.handleAction(action);
    if(this.inspector)return this.inspector.handleAction(action);
    if(action==='alt'){this._openInspector();return true;}
    if(action==='cancel'){this.close();return true;}
    return this.menu.handleAction(action);
  }
  destroy(){
    this._closeInspector();
    this._closeMixer();
    ++this.request;
    ++this.scoreRequest;
    this.scene.input?.keyboard?.off('keydown-M',this._markKey);
    this._markKey=null;
    this.score=null;
    this.experimentalScore=null;
    this.reviewQueue=null;
    this.tickTimer?.remove();
    this.lab?.destroy();
    this.lab=null;
    if(this.sourceBus&&this.audio?.ctx){
      this.sourceBus.gain.setTargetAtTime(
        this.prevBusVolume??1,this.audio.ctx.currentTime,.05);
    }
    this.sourceBus=null;
    this._unbindReadout?.();this._unbindReadout=null;
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
    // a lime halo around the DOM field (the field itself is an HTML element above the canvas)
    this.slot = scene.add.graphics();
    this.panel.add(this.slot);
    this._unbindSlot = theme.bind((pal) => {
      this.slot.clear();
      glowRectPx(this.slot, 12, 40, 316, 20, pal.lime, 1.4);
      paintRule(this.slot, 12, this.w - 12, this.h - 30, pal.lime, 0.5);
    });
    this.panel.add(new NeonText(scene, theme, 12, 24, 'SAME SEED = SAME TRACK. SHARE IT WITH FRIENDS.', { color: 'text', outline: 'none' }).setAlpha(0.7));
    this.box = new DomTextBox(scene, theme, {
      x: px + 12, y: py + 40, w: 316, h: 20, value: o.initial || '', maxLength: 32, placeholder: 'TYPE A SEED (EMPTY = RANDOM)',
      color: 'lime', onSubmit: () => this.submit(), onCancel: () => this.close(),
    });
    this.panel.add(new Keycaps(scene, theme, { x: 12, y: 66, color: 'lime',
      items: [{ keys: ['ENTER'], label: 'GO' }, { keys: ['ESC'], label: 'BACK' }] }));
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
    if (this._unbindSlot) this._unbindSlot();
    this._unbindSlot = null;
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
    super(scene, theme, { w: 400, h: 168, title: exp ? 'EXPORT SHARECODE' : 'IMPORT SHARECODE', color: exp ? 'cyan' : 'lime', onClose: o.onClose, y: 50,
      hints: exp ? [{ keys: ['ENTER'], label: 'COPY' }] : [{ keys: ['CTRL+V'], label: 'PASTE' }, { keys: ['ENTER'], label: 'IMPORT' }] });
    this.exp = exp;
    this.store = scene.registry.get(REG.SAVE_STORE);
    const px = this.panel.x;
    const py = this.panel.y;
    this.hint = new NeonText(scene, theme, 12, 22, exp ? 'YOUR LEDGER AS TEXT. COPY IT, SEND IT, IMPORT IT ELSEWHERE.' : 'PASTE A SHARECODE BELOW (CTRL+V), THEN PRESS IMPORT.', {
      color: 'text', outline: 'none',
    });
    this.hint.setAlpha(0.7);
    this.panel.add(this.hint);
    // halo round the DOM text box, and a divider above the status line
    this.slot = scene.add.graphics();
    this.panel.add(this.slot);
    const accent = exp ? 'cyan' : 'lime';
    this._unbindSlot = theme.bind((pal) => {
      this.slot.clear();
      glowRectPx(this.slot, 12, 36, 376, 76, pal[accent], 1.2);
      paintRule(this.slot, 12, this.w - 12, this.h - 43, pal[accent], 0.5);
    });
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
    if (this._unbindSlot) this._unbindSlot();
    this._unbindSlot = null;
    if (this.box) this.box.destroy();
    this.box = null;
    super.destroy();
  }
}

/** Left edges of the two stat columns' zebra stripes (the layout's PAD and its second column, minus 2). */
const PAD_STAT_L = 10;
const PAD_STAT_R = 206;

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
      achievementTotal: visibleAchievements(scene.registry.get(REG.PROFILE)).length,
    });
    super(scene, theme, { w: layout.w, h: layout.h, title: 'PILOT PROFILE', color: 'lime', onClose: o.onClose, y: 22, backLabel: 'BACK' });
    this._onShop = o.onShop;

    // Decoration UNDER the text: zebra stripes behind the stat rows and a fading rule after each section
    // heading (LIFETIME, SIGNATURES), drawn from the layout's own boxes so they cannot drift from the text.
    const byKey = new Map(layout.items.map((it) => [it.key, it]));
    this.deco = scene.add.graphics();
    this.panel.add(this.deco);
    this.unbindDeco = theme.bind((pal) => {
      const g = this.deco;
      g.clear();
      for (let i = 0; i < 10; i++) {
        const k = byKey.get(`stat-k${i}`);
        if (!k || i % 5 % 2 === 1) continue;
        const left = i < 5 ? PAD_STAT_L : PAD_STAT_R;
        g.fillStyle(pal.text, 0.045);
        g.fillRect(left, k.y - 2, i < 5 ? 178 : 198, 12);
      }
      for (const [head, right, ck] of [['lifetime-head', 'bank', 'amber'], ['sig-head', 'sig-note', 'magenta']]) {
        const h = byKey.get(head);
        const r = byKey.get(right);
        if (h && r) paintRule(g, h.x + h.w + 6, r.x - 6, h.y + 4, pal[ck], 0.7);
      }
    });

    const texts = [];
    for (const it of layout.items) {
      // Layout boxes are always top-left, so draw left-anchored and never let Phaser re-apply an
      // origin: passing anchor:'right' with a left edge shifted right-aligned text a second time.
      const t = new NeonText(scene, theme, it.x, it.y, it.text, {
        color: it.color, outline: it.outline, alpha: it.alpha,
      });
      this.panel.add(t);
      texts.push([it.y, t]);
    }
    // reveal row by row (objects sharing a y fade together)
    const ys = [...new Set(texts.map((e) => e[0]))].sort((a, b) => a - b);
    staggerAlpha(scene, ys.map((y) => texts.filter((e) => e[0] === y).map((e) => e[1])), { start: 110, step: 20 });

    // Resonance bar: XP progress inside the current level. Same paint as Game Over, so a player who
    // just levelled sees the same fill they saw there.
    const b = layout.bar;
    const bar = scene.add.graphics();
    this.panel.add(bar);
    this.unbindBar = theme.bind((pal) => {
      bar.clear();
      paintGlowBar(bar, pal, b, b.ratio, b.color);
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
      staggerMenuRows(scene, this.sigMenu, { start: 260, step: 14 });
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
    paintFocusRing(g, pal, r, t.kind === 'back' ? 'magenta' : 'amber');
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
    if (this.unbindDeco) this.unbindDeco();
    this.unbindDeco = null;
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
    // Decoration under the rows (card washes, progress rails, section rules, pager) and the header summary:
    // how much of the catalogue is unlocked, as a count and a glowing bar in the title-tab line.
    this.deco = scene.add.graphics();
    this.panel.add(this.deco);
    const got = Object.keys((profile && profile.achievements) || {}).length;
    const total = Math.max(got, visibleAchievements(profile).length);
    this.summary = { ratio: total ? got / total : 0, x: this.w - 10 - 64, y: 4, w: 64, h: 7 };
    const txt = `${got}/${total}`;
    const sumText = new NeonText(scene, theme, this.summary.x - 6 - measureText(txt), 4, txt, { color: 'amber', outline: 'none' });
    this.panel.add(sumText);
    const caps = new Keycaps(scene, theme, { x: sumText.x - 14, y: 2, align: 'right', color: 'amber',
      items: [{ keys: ['←', '→'], label: 'PAGE' }] });
    this.panel.add(caps);
    this.unbindDeco = theme.bind((pal) => this._paintDeco(pal));
    this._paint();
  }

  /** Painted under the row texts; repainted on page turns and palette swaps. */
  _paintDeco(pal) {
    const g = this.deco;
    const L = this._layout;
    if (!g || !L) return;
    g.clear();
    paintGlowBar(g, pal, this.summary, this.summary.ratio, 'amber', { segments: 0, glow: 0.6 });
    const left = 12;
    const right = this.w - 12;
    const byKey = new Map(L.items.map((it) => [it.key, it]));
    for (const r of L.rows) {
      if (r.kind === 'header') {
        paintRule(g, left + measureText(r.label) + 6, right, r.y + 4, pal.amber, 0.7);
        continue;
      }
      if (r.done) {
        // earned: lime wash, a bright edge and a tick beside the count
        g.fillStyle(pal.lime, 0.07);
        g.fillRect(8, r.y - 2, this.w - 16, 12);
        g.fillStyle(pal.lime, 0.9);
        g.fillRect(8, r.y - 2, 2, 12);
        const p = byKey.get(`p-${r.id}`);
        if (p) paintPattern(g, p.x - 9, r.y + 1, CHECK_GLYPH, pal.lime, 1);
      } else {
        // pending: a thin rail under the row with its progress filled in
        const rw = right - left;
        g.fillStyle(pal.cyan, 0.12);
        g.fillRect(left, r.y + 10, rw, 1);
        const fw = Math.round(rw * Math.min(1, Math.max(0, r.ratio || 0)));
        if (fw > 0) {
          g.fillStyle(pal.cyan, 0.75);
          g.fillRect(left, r.y + 10, fw, 1);
          g.fillStyle(pal.cyan, 0.2);
          g.fillRect(left, r.y + 11, fw, 1);
          g.fillStyle(pal.text, 0.9);
          g.fillRect(left + fw - 1, r.y + 10, 1, 1);
        }
      }
    }
    // pager: one square per page, the current one lit
    const pages = L.pages;
    const px = 12 + measureText(L.footer.text) + 10;
    for (let i = 0; i < pages; i++) {
      const on = i === L.page;
      const x = px + i * 8;
      const y = L.footer.y + 1;
      if (on) glowRectPx(g, x, y, 5, 5, pal.magenta, 1);
      g.fillStyle(pal.magenta, on ? 1 : 0.3);
      g.fillRect(x, y, 5, 5);
      if (!on) { g.fillStyle(pal.bg, 1); g.fillRect(x + 1, y + 1, 3, 3); }
    }
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
    this._layout = layout;
    const byY = new Map();
    for (const it of layout.items) {
      // Same rule as ProfileView: layout boxes are top-left, so never re-apply an origin.
      const t = new NeonText(this.scene, this.theme, it.x, it.y, it.text, {
        color: it.color, outline: it.outline, alpha: it.alpha,
      });
      this.panel.add(t);
      this.rows.push(t);
      if (!byY.has(it.y)) byY.set(it.y, []);
      byY.get(it.y).push(t);
    }
    if (this.deco) this._paintDeco(this.theme.pal);
    // each page deals its rows in, top to bottom
    staggerAlpha(this.scene, [...byY.keys()].sort((a, b) => a - b).map((y) => byY.get(y)), { start: this._dealt ? 0 : 120, step: 16 });
    this._dealt = true;
  }

  /** Move by `delta` pages, clamped, and repaint only when the page actually changes. */
  _turn(delta) {
    const next = Math.max(0,Math.min(this.pages - 1,this.page + delta));
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

  destroy() {
    if (this.unbindDeco) this.unbindDeco();
    this.unbindDeco = null;
    super.destroy();
  }
}

/**
 * Shop/Titles row state -> how it looks. Returns null for rows with no state chip. The wording of the state
 * stays in the layout (state is text, not only colour); this only chooses the dressing:
 *   EQUIPPED  solid lime chip, lime row wash          (clearly "on")
 *   EQUIP     outline lime chip, lime dot in the gutter  (owned)
 *   price     bright amber chip with a shard           (buy it now)
 *   too dear  dim amber chip                           (unlocked, cannot afford)
 *   LVL n     dim chip with a padlock                  (locked)
 */
function chipStyle(r) {
  switch (r.kind) {
    case 'item':
    case 'default':
      if (r.equipped) return { mode: 'solid', key: 'lime', text: 'lime', alpha: 1 };
      if (r.owned || r.kind === 'default') return { mode: 'outline', key: 'lime', text: 'lime', alpha: 1 };
      if (r.locked || r.state === 'ACHIEVEMENT') return { mode: 'dim', key: 'text', text: 'text', alpha: 0.55, glyph: 'lock' };
      if (r.disabled) return { mode: 'dim', key: 'amber', text: 'amber', alpha: 0.6, glyph: 'shard' };
      return { mode: 'bright', key: 'amber', text: 'amber', alpha: 1, glyph: 'shard' };
    case 'boost':
      return r.locked ? { mode: 'dim', key: 'text', text: 'text', alpha: 0.55, glyph: 'lock' } : null;
    case 'upgradeItem':
      if (!r.state) return null;
      return r.disabled ? { mode: 'dim', key: 'amber', text: 'amber', alpha: 0.6, glyph: 'shard' }
        : { mode: 'bright', key: 'amber', text: 'amber', alpha: 1, glyph: 'shard' };
    case 'gym':
      return r.disabled ? { mode: 'dim', key: 'text', text: 'text', alpha: 0.55, glyph: 'lock' }
        : String(r.state).startsWith('LOCKED') ? { mode: 'bright', key: 'amber', text: 'amber', alpha: 1, glyph: 'lock' }
          : { mode: 'outline', key: 'lime', text: 'lime', alpha: 1 };
    case 'upgradeLink':
    case 'gymSetupLink':
      return { mode: 'outline', key: 'lime', text: 'lime', alpha: 1 };
    default:
      return null;
  }
}

/**
 * Give MenuList items (aligned 1:1 with the layout rows) the colours their state chips need: the state word
 * wears the chip's colour, equipped labels wear lime, section headers become bright headings.
 * @param {object[]} items @param {object[]} rows
 * @returns {object[]} items
 */
function dressShopItems(items, rows) {
  items.forEach((it, i) => {
    const r = rows[i];
    if (!r) return;
    if (r.kind === 'header') { it.heading = true; it.color = 'magenta'; return; }
    const st = chipStyle(r);
    if (st && it.sub) { it.subColor = st.text; it.subAlpha = st.alpha; }
    if (r.equipped) it.tint = 'lime';
  });
  return items;
}

/** Number of catalogue pages the pager dots show (ShopLayout.SHOP_PAGES). */
const SHOP_PAGE_COUNT = 4;

/**
 * Paint the shop/titles decoration (under the MenuList text): state chips, equipped washes, owned dots,
 * section rules, the shard glyph by BANK and the page pips.
 * @param {Phaser.GameObjects.Graphics} g @param {Object<string,number>} pal
 * @param {{rows:object[], rowH:number, band:{x:number,y:number,w:number}}} layout
 */
function paintShopDeco(g, pal, layout) {
  const { band, rowH } = layout;
  const edge = band.x + band.w - 8; // where MenuList right-aligns sub text
  for (const r of layout.rows) {
    if (r.kind === 'head') {
      const t = r.texts && r.texts[0];
      if (t) paintPattern(g, t.x - 9, r.y + 1, SHARD_GLYPH, pal.amber, 1);
      continue;
    }
    if (r.kind === 'header') {
      paintRule(g, band.x + 14 + measureText(r.label) + 6, edge, r.y + 5, pal.magenta, 0.7);
      continue;
    }
    if (r.equipped) {
      g.fillStyle(pal.lime, 0.09);
      g.fillRect(band.x, r.y, band.w, rowH - 1);
      g.fillStyle(pal.lime, 0.85);
      g.fillRect(band.x, r.y, 2, rowH - 1);
    } else if (r.owned) {
      g.fillStyle(pal.lime, 0.8);
      g.fillRect(band.x + 10, r.y + 4, 2, 2);
    }
    if (r.kind === 'page') {
      const w = SHOP_PAGE_COUNT * 7 - 2;
      const x0 = edge - measureText(r.state) - 8 - w;
      for (let i = 0; i < SHOP_PAGE_COUNT; i++) {
        const on = i === r.page;
        g.fillStyle(pal.magenta, on ? 1 : 0.3);
        g.fillRect(x0 + i * 7, r.y + 3, 5, 4);
      }
      continue;
    }
    const st = chipStyle(r);
    if (st && r.state) paintStateChip(g, pal, { right: edge + 3, y: r.y + 1, textW: measureText(String(r.state)), colorKey: st.key, mode: st.mode, glyph: st.glyph });
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
    this.upgradePage = false;
    this.gymSetupPage = false;
    // state chips, washes and rules live on one Graphics UNDER the list (added before any menu exists, so
    // every rebuilt menu lands above it); repainted from the current layout on every _build
    this.deco = scene.add.graphics();
    this.panel.add(this.deco);
    this._layout = null;
    this.unbindDeco = theme.bind((pal) => this._paintDeco(pal));
    this.hintRow = new Keycaps(scene, theme, { x: 12, y: this.h - 19, color: 'amber',
      items: [{ keys: ['←', '→'], label: 'PAGE' }, { keys: ['ENTER'], label: 'BUY / EQUIP' }] });
    this.panel.add(this.hintRow);
    this._build();
  }

  _paintDeco(pal) {
    if (!this.deco || !this._layout) return;
    this.deco.clear();
    paintShopDeco(this.deco, pal, this._layout);
  }

  _profile() {
    return this.scene.registry.get(REG.PROFILE) || {};
  }

  /** The panel's single source of truth: layout rows + menu items, rebuilt together every time. */
  _menuItems(layout) {
    if (this.gymSetupPage) return layout.rows.map((r) => {
      if (r.kind === 'gymSetupBack') return {kind:'action',label:r.label,
        onSelect:()=>this._showUpgrades()};
      if (r.kind === 'gymSetupChoice') return {
        kind:'choice',id:r.id,label:r.label,
        options:r.choices.map(n=>({value:n,label:r.id==='launchRisePxS'
          ? 'UP '+Math.abs(n) : String(n)})),
        get:()=>this._gymSetup()[r.id],
        set:v=>this._setGymOption(r.id,v),
      };
      if (r.kind === 'gymSetupStart') return {kind:'action',label:r.label,
        onSelect:()=>this.scene.startRun('bsod-gym',0,{gym:true})};
      return {kind:'static',label:r.label,disabled:true};
    });
    if (this.upgradePage) return layout.rows.map((r) => {
      if (r.kind === 'upgradeBack') return { kind: 'action', label: r.label, onSelect: () => this._showShop() };
      if (r.kind === 'upgradeToggle') return {
        kind: 'choice', label: r.label,
        options: [{ value: false, label: 'OFF' }, { value: true, label: 'ON' }],
        get: () => this._profile().upgradesEnabled === true,
        set: v => this._setUpgradeMode(v === true),
      };
      if (r.kind === 'gym') return {
        kind: 'action', id: r.id, label: r.label, sub: r.state,
        disabled: r.disabled, onSelect: () => this._chooseBsodGym(),
      };
      if (r.kind === 'gymSetupLink') return {
        kind:'action',id:r.id,label:r.label,sub:r.state,
        onSelect:()=>this._showGymSetup(),
      };
      if (r.kind === 'upgradeItem') return {
        kind: 'action', id: r.id, label: r.label, sub: r.state,
        disabled: r.disabled === true, onSelect: () => this._buyUpgrade(r.id),
      };
      return { kind: 'static', label: r.label, disabled: true };
    });
    return shopMenuItems(layout).map((m) => {
      if (m.rowKind === 'upgradeLink') return {
        kind: 'action', label: m.label, sub: m.sub, onSelect: () => this._showUpgrades(),
      };
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
    const layout = this.gymSetupPage ? gymSetupLayout({profile:this._profile()})
      : this.upgradePage ? upgradeShopLayout({ profile: this._profile() })
      : shopLayout({ profile: this._profile(), levels: this._levels(), page: this.page });
    // Only the ordinary Shop layout has a page index. Nested Gym setup
    // must preserve the last selected catalogue category for BACK navigation.
    if (!this.upgradePage && !this.gymSetupPage) this.page = layout.page;
    if (this.menu) { this.menu.destroy(); this.menu = null; }
    // The bank value is drawn outside the list (the list right-aligns only row state), so it has to be
    // torn down with it or every rebuild would stack another "BANK n" on the same pixel.
    for (const t of (this.bankTexts || [])) t.destroy();
    this.bankTexts = [];
    const band = layout.band;
    this._layout = layout;
    this._paintDeco(this.theme.pal);
    this.menu = new MenuList(this.scene, this.theme, {
      x: band.x, y: band.y, w: band.w, rowH: layout.rowH,
      items: dressShopItems(this._menuItems(layout), layout.rows), color: 'lime', parent: this.panel,
    });
    if (!this._revealed) { this._revealed = true; staggerMenuRows(this.scene, this.menu); }
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

  /** Change only this shop panel, keeping the title/profile ownership and Back semantics. */
  _showUpgrades() {
    this.gymSetupPage = false;
    this.upgradePage = true;
    this._build();
  }

  /** Invisible until five legitimate uninterrupted Bluffs IN THE GYM. */
  _showGymSetup() {
    if (this._profile().bsodGym?.advanced !== true) return;
    this.upgradePage = false;
    this.gymSetupPage = true;
    this._build();
  }

  _gymSetup() {
    return this._profile().bsodGym?.setup || {};
  }

  _setGymOption(key, value) {
    const result = this.store?.setGymSetup({...this._gymSetup(),[key]:value});
    if (result?.ok) this.scene.registry.set(REG.PROFILE,result.profile);
  }

  _showShop() {
    this.gymSetupPage = false;
    this.upgradePage = false;
    this._build();
  }

  _setUpgradeMode(on) {
    const prof = this._profile();
    const next = { ...prof, upgradesEnabled: !!on };
    try {
      this.scene.registry.set(REG.PROFILE, this.store ? this.store.save(next) : next);
    } catch {
      this.scene.registry.set(REG.PROFILE, next);
    }
    // MenuList._adjust refreshes its own choice after the setter returns.
    // Do NOT destroy that same menu mid-setter: keyboard/gamepad controls keep
    // their focus and the display updates via the live get() callback.
  }

  _chooseBsodGym() {
    if (this._profile().bsodGym?.owned === true) {
      // The TitleScene owns this route. Gym sessions are never official or ranked.
      this.scene.startRun('bsod-gym', 0, { gym: true });
      return;
    }
    const tx = this.store?.buyBsodGym();
    if (tx?.ok) {
      this.scene.registry.set(REG.PROFILE, tx.profile);
      uiSfx(this.scene, 'uiSelect', { pitch: 1.3 });
    } else {
      uiSfx(this.scene, 'uiBack');
    }
    this._refresh();
  }

  _buyUpgrade(id) {
    const tx = this.store?.buyUpgrade(id);
    if (tx?.ok) {
      this.scene.registry.set(REG.PROFILE, tx.profile);
      uiSfx(this.scene, 'uiSelect', { pitch: 1.3 });
    } else {
      uiSfx(this.scene, 'uiBack');
    }
    this._refresh();
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

  destroy() {
    if (this.unbindDeco) this.unbindDeco();
    this.unbindDeco = null;
    for (const t of this.bankTexts || []) t.destroy();
    this.bankTexts = [];
    super.destroy();
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
    this.deco = scene.add.graphics();
    this.panel.add(this.deco);
    this._layout = null;
    this.unbindDeco = theme.bind((pal) => this._paintDeco(pal));
    this.hintRow = new Keycaps(scene, theme, { x: 12, y: this.h - 19, color: 'lime',
      items: [{ keys: ['ENTER'], label: 'EQUIP' }] });
    this.panel.add(this.hintRow);
    this._build();
  }

  _paintDeco(pal) {
    if (!this.deco || !this._layout) return;
    this.deco.clear();
    paintShopDeco(this.deco, pal, this._layout);
  }

  _profile() {
    return this.scene.registry.get(REG.PROFILE) || {};
  }

  _build() {
    const layout = titlesLayout({ profile: this._profile(), levels: (this.scene.registry.get(REG.CONTENT) || {}).progression });
    if (this.menu) { this.menu.destroy(); this.menu = null; }
    for (const t of this.bankTexts) t.destroy();
    this.bankTexts = [];
    const items = dressShopItems(titlesMenuItems(layout).map((m) => (m.kind === 'action'
      ? { ...m, onSelect: () => this._choose(m.id) }
      : { kind: 'static', label: m.label, disabled: true })), layout.rows);
    const band = layout.band;
    this._layout = layout;
    this._paintDeco(this.theme.pal);
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
    if (this.unbindDeco) this.unbindDeco();
    this.unbindDeco = null;
    for (const t of this.bankTexts || []) t.destroy();
    this.bankTexts = [];
    super.destroy();
  }
}

/** Two official Daily lanes, deliberately separate from ordinary purchased
 * upgrade mode. No extra entry is squeezed into the full six-row Title menu.
 */
export class DailyModesView extends View {
  constructor(scene,theme,o){
    super(scene,theme,{w:432,h:242,title:'DAILY CHALLENGE // TWO LANES',color:'magenta',onClose:o.onClose,
      hints:[{keys:['↑','↓'],label:'SELECT'},{keys:['ENTER'],label:'GO'}]});
    this.panel.add(new NeonText(scene,theme,14,29,'SAME DAILY SEED + RULE. SEPARATE RANKINGS.',{
      color:'cyan',outline:'none'}));
    this.panel.add(new NeonText(scene,theme,14,43,`DRAFT: ${DRAFT_BUDGET} FREE CREDITS, REBUILD ANYTIME`,{
      color:'text',outline:'none'}));
    // Each lane is a card: a framed slot in its own colour behind the row, with a lane number tab. Painted
    // before the list so the cursor and labels sit on top.
    const LANES=[['lime','01'],['magenta','02'],['cyan','03'],['amber','04']];
    this.cards=scene.add.graphics();
    this.panel.add(this.cards);
    this.unbindCards=theme.bind(pal=>{
      const g=this.cards;
      g.clear();
      LANES.forEach(([k,n],i)=>{
        const y=62+i*31+2,w=408,h=26,x=12;
        g.fillStyle(pal[k],0.05);g.fillRect(x,y,w,h);
        strokeRectPx(g,x,y,w,h,pal[k],0.4);
        g.fillStyle(pal[k],0.8);g.fillRect(x+w-3,y+1,2,h-2);
        // corner notch: a bright pixel at each end of the top edge
        g.fillStyle(pal.text,0.8);g.fillRect(x,y,1,1);g.fillRect(x+w-1,y,1,1);
      });
    });
    this.menu=new MenuList(scene,theme,{x:12,y:62,w:408,rowH:31,parent:this.panel,items:[
      {kind:'action',label:'DAILY CLASSIC',color:'lime',sub:'NO UPGRADES',tint:'lime',onSelect:o.onClassic},
      {kind:'action',label:'DAILY DRAFT',color:'magenta',sub:'EQUAL-BUDGET BUILDS',tint:'magenta',onSelect:o.onDraft},
      {kind:'action',label:'BUILD / REBUILD DRAFT',color:'cyan',sub:'FREE - NO SHARDS',tint:'cyan',onSelect:o.onEdit},
      {kind:'action',label:'DAILY DRAFT BOARD',color:'amber',sub:'TODAY ONLY',tint:'amber',onSelect:o.onBoard},
    ]});
    this.menu.refresh();
    staggerMenuRows(scene,this.menu);
  }
  destroy(){
    this.unbindCards?.();this.unbindCards=null;
    super.destroy();
  }
  handleAction(action){
    if(action==='cancel'){this.close();return true;}
    return this.menu.handleAction(action);
  }
}

/** Seven actual game upgrades, priced by the same cumulative curve but
 * purchased only in non-transferable Draft credits, never profile BANK.
 * Keyboard/gamepad: Up/Down choose, Left/Right remove/add, Enter add.
 * Pointer: independent -/+ buttons on each row.
 */
export class DailyDraftEditorView extends View {
  constructor(scene,theme,o){
    super(scene,theme,{w:440,h:248,title:'DAILY DRAFT // BUILD A SLED',color:'cyan',onClose:o.onClose,y:10});
    this.store=scene.registry.get(REG.PROGRESSION)?.store;
    this.onPlay=o.onPlay;
    this.selected=0;
    this.itemRows=[];
    // Under everything else: the budget gauge, the selected row's band and each row's rank pips.
    this.deco=scene.add.graphics();
    this.panel.add(this.deco);
    this.unbindDeco=theme.bind(()=>this._paintDeco());
    this.remaining=new NeonText(scene,theme,13,25,'',{color:'lime'});
    this.panel.add(this.remaining);
    this.errorText=new NeonText(scene,theme,13,36,'LEFT/RIGHT ADJUST RANKS - NO SHARDS SPENT',{
      color:'text',outline:'none'});
    this.panel.add(this.errorText);
    DRAFT_UPGRADES.forEach((spec,i)=>{
      const y=51+i*19;
      const name=new NeonText(scene,theme,14,y,spec.label,{color:'text'});
      const value=new NeonText(scene,theme,290,y,'',{anchor:'right',color:'cyan'});
      const minus=new Button(scene,theme,{x:300,y:y-4,w:26,h:15,label:'-',color:'magenta',
        onClick:()=>this._adjust(i,-1)});
      const plus=new Button(scene,theme,{x:336,y:y-4,w:26,h:15,label:'+',color:'lime',
        onClick:()=>this._adjust(i,1)});
      this.panel.add(name);this.panel.add(value);this.panel.add(minus);this.panel.add(plus);
      this.itemRows.push({name,value,minus,plus,id:spec.id});
    });
    this.resetBtn=new Button(scene,theme,{x:14,y:194,w:96,h:17,label:'RESET DRAFT',color:'amber',
      onClick:()=>this._reset()});
    this.playBtn=new Button(scene,theme,{x:134,y:194,w:108,h:17,label:'PLAY DRAFT',color:'lime',
      onClick:()=>this.onPlay()});
    this.panel.add(this.resetBtn);this.panel.add(this.playBtn);
    this._paint();
  }
  _ranks(){return this.store?.profile?.dailyDraft?.ranks||{};}
  _adjust(i,delta){
    const id=this.itemRows[i]?.id;
    if(!id)return;
    const changed=changeDraftRank(this._ranks(),id,delta);
    if(!changed.ok){
      this.errorText.setText(changed.reason==='over-budget'?'DRAFT LIMIT REACHED - REMOVE A RANK FIRST':'MINIMUM RANK 0');
      this.errorText.setColorKey('amber');return;
    }
    const stored=this.store?.setDailyDraftRanks(changed.ranks);
    if(!stored?.ok){this.errorText.setText('COULD NOT SAVE DRAFT');this.errorText.setColorKey('magenta');return;}
    this.scene.registry.set(REG.PROFILE,stored.profile);
    this.errorText.setText('DRAFT SAVED - YOU MAY REBUILD AT ANY TIME');
    this.errorText.setColorKey('cyan');
    uiSfx(this.scene,'uiSelect');
    this._paint();
  }
  _reset(){
    const result=this.store?.setDailyDraftRanks(sanitizeDraftRanks({}));
    if(!result?.ok){this.errorText.setText('COULD NOT RESET DRAFT');return;}
    this.scene.registry.set(REG.PROFILE,result.profile);
    this.errorText.setText('DRAFT RESET - ALL CREDITS RETURNED');
    this._paint();
  }
  _paint(){
    const ranks=this._ranks();
    this.remaining.setText(`DRAFT ${DRAFT_BUDGET}  SPENT ${draftCost(ranks)}  LEFT ${DRAFT_BUDGET-draftCost(ranks)}`);
    this.itemRows.forEach((row,i)=>{
      row.name.setColorKey(i===this.selected?'lime':'text');
      row.value.setText(`R${ranks[row.id]||0}`);
    });
    // Mouse and keyboard/gamepad deserve the same visible selection cue.
    this.resetBtn.setHover(this.selected===7);
    this.playBtn.setHover(this.selected===8);
    this.back.setHover(this.selected===9);
    this._paintDeco();
  }
  _paintDeco(){
    const g=this.deco;
    if(!g||!this.itemRows.length)return;
    const pal=this.theme.pal;
    const ranks=this._ranks();
    g.clear();
    const spent=draftCost(ranks);
    paintGlowBar(g,pal,{x:230,y:26,w:196,h:7},DRAFT_BUDGET>0?spent/DRAFT_BUDGET:0,spent>=DRAFT_BUDGET?'amber':'lime',{segments:10,glow:0.6});
    this.itemRows.forEach((row,i)=>{
      const y=51+i*19;
      if(i===this.selected){
        g.fillStyle(pal.lime,0.1);g.fillRect(10,y-4,356,15);
        g.fillStyle(pal.lime,1);g.fillRect(10,y-4,2,15);
      }
      const r=Math.min(8,ranks[row.id]||0);
      for(let k=0;k<8;k++){
        const on=k<r;
        const x=176+k*9;
        if(on){glowRectPx(g,x,y+1,6,6,pal.cyan,0.8);}
        g.fillStyle(pal.cyan,on?1:0.16);g.fillRect(x,y+1,6,6);
        if(!on){g.fillStyle(pal.bg,1);g.fillRect(x+1,y+2,4,4);}
      }
    });
  }
  destroy(){
    this.unbindDeco?.();this.unbindDeco=null;
    super.destroy();
  }
  handleAction(action){
    if(action==='cancel'){this.close();return true;}
    if(action==='up'||action==='down'){
      this.selected=(this.selected+(action==='up'?-1:1)+10)%10;
      this._paint();uiSfx(this.scene,'uiMove');return true;
    }
    if(this.selected<7 && (action==='left'||action==='right'||action==='confirm')){
      this._adjust(this.selected,action==='left'?-1:1);return true;
    }
    if(action==='confirm'){
      if(this.selected===7)this._reset();
      else if(this.selected===8)this.onPlay();
      else this.close();
      return true;
    }
    return true;
  }
}


/** Today's separate Daily Draft top ten. Classic and normal modded entries
 * are explicitly excluded by the central Ranking.isOfficialDaily predicate.
 * Players can change their Draft allocation without touching past entries.
 */
export class DailyDraftLeaderboardView extends View {
  constructor(scene,theme,o){
    super(scene,theme,{w:440,h:202,title:"DAILY DRAFT // TODAY'S TOP 10",color:'amber',onClose:o.onClose});
    this.highlightId=o.highlightId;
    this.board=new LeaderboardTable(scene,theme,{x:12,y:25,w:416,entries:null,parent:this.panel});
    this.panel.add(new NeonText(scene,theme,12,180,`RULES V${DRAFT_RULES_VERSION}  BUDGET ${DRAFT_BUDGET}  CLASSIC EXCLUDED`,{
      color:'cyan',outline:'none'}));
    this.loadToken=0;
    this._load();
  }
  _load(){
    const token=++this.loadToken;
    const store=this.scene.registry.get(REG.SAVE_STORE);
    Promise.resolve(store?.getDailyDraftLeaderboard?.(10,new Date())||[])
      .then(rows=>{
        if(!this.alive||token!==this.loadToken)return;
        this.board.setEntries(rows||[],this.highlightId,{
          title:'NO DRAFT RUNS TODAY',sub:'PLAY DAILY DRAFT, THEN ENTER INITIALS',
        });
      }).catch(()=>{
        if(this.alive&&token===this.loadToken)this.board.setEntries([]);
      });
  }
}
