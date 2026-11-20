/** Cosmetic song billboard: one roadside pass per ACTUAL track identity change.
 * Artwork comes from catalog metadata via BillboardArt: the song's YouTube
 * thumbnail when it has a confirmed ID, otherwise the generic NOW PLAYING card.
 */
import {GAME_WIDTH,GAME_HEIGHT} from '../constants.js';
import {FONT_KEY,ellipsize,measureText} from '../ui/PixelFont.js';
import {GENERIC_ART_KEY,CATALOG_CACHE_KEY,billboardArtLoader,catalogTrack,trackYoutubeId,youtubeArtKey}
  from './BillboardArt.js';

// Sized to fit a sky lane above the rider: the rider sits near screen y = H/3,
// so an 82 px sign had no lane there and crossed the rider's silhouette.
export const BILLBOARD_WIDTH=80;
export const BILLBOARD_HEIGHT=56;
export const BILLBOARD_ART={w:72,h:40,y:-5};
/** Clear gap (screen px) kept between the sign's bottom edge and the rider's head. */
export const RIDER_CLEAR_PX=24;
/** Alpha while the sign still has to cross the rider (no clear lane at the top of the screen). */
export const BILLBOARD_BEHIND_RIDER_ALPHA=0.22;
export const BILLBOARD_LIFETIME_MS=14000;
export const BILLBOARD_FADE_MS=600;
/** Longest the sign waits off-screen for a thumbnail still loading before it goes out with the generic card. */
export const BILLBOARD_ART_WAIT_MS=1500;
// Phaser.Textures.FilterMode.LINEAR: the game runs pixelArt (NEAREST), which
// makes a 320x180 photo downscaled to 72x40 crunchy.
const LINEAR_FILTER=0;
// Per-AudioSynth announced track: survives scene restarts and retries without
// storing scene state on the audio object itself.
const announced=new WeakMap();

/** Target screen y of the sign's centre: the sky lane above the rider, kept above ACTUAL nearby terrain. */
export function billboardScreenY(riderScreenY,groundScreenY=Infinity){
  const half=BILLBOARD_HEIGHT*.5;
  let y=74;
  if(Number.isFinite(riderScreenY))y=Math.min(y,riderScreenY-RIDER_CLEAR_PX-half);
  if(Number.isFinite(groundScreenY))y=Math.min(y,groundScreenY-half-8);
  return Math.max(half+3,y);
}
export function billboardScreenX(startX,cameraTravelPx,elapsedMs,allowAutoPass=true){
  if(!Number.isFinite(startX))return GAME_WIDTH+80;
  const travel=Math.max(0,Number(cameraTravelPx)||0);
  const automatic=allowAutoPass&&Number.isFinite(elapsedMs)?Math.max(0,elapsedMs)*0.077:0;
  return startX-Math.max(travel,automatic);
}
export function billboardPulseScale(dance){
  const p=Number.isFinite(dance)?Math.max(0,Math.min(1,dance)):0;
  return {x:1+0.045*p,y:1-0.035*p};
}
/** Sign title at 1x pixel-font scale: drop "(subtitle)" / " - part" tails first, then ellipsize to the sign. */
export function billboardTitle(title){
  const full=String(title||'').toUpperCase().trim();
  const short=full.replace(/\s*\(.*$/,'').replace(/\s+-\s+.*$/,'').trim()||full;
  return ellipsize(short,BILLBOARD_TITLE_PX);
}
/** Room for the title on the sign, in unscaled font px. */
export const BILLBOARD_TITLE_PX=BILLBOARD_WIDTH-6;
/**
 * Marquee scroll (px) for a title `travelPx` wider than the sign: hold, scroll
 * at 20 px/s, hold at the end, jump back. Zero when it fits.
 */
export function marqueeOffset(elapsedMs,travelPx){
  if(!(travelPx>0)||!Number.isFinite(elapsedMs))return 0;
  const hold=900,scroll=travelPx/0.02,t=Math.max(0,elapsedMs)%(hold*2+scroll);
  return Math.round(Math.max(0,Math.min(travelPx,(t-hold)*0.02)));
}
/** Screen box of the sign body centred at (x, y). */
export function billboardRect(x,y){
  return {x:x-BILLBOARD_WIDTH/2,y:y-BILLBOARD_HEIGHT/2,w:BILLBOARD_WIDTH,h:BILLBOARD_HEIGHT};
}
/** Target alpha: dimmed while overlapping the rider's box, faded over the last BILLBOARD_FADE_MS of its life. */
export function billboardAlpha(signRect,riderRect,elapsedMs){
  const hit=Boolean(riderRect)&&signRect.x<riderRect.x+riderRect.w&&riderRect.x<signRect.x+signRect.w&&
    signRect.y<riderRect.y+riderRect.h&&riderRect.y<signRect.y+signRect.h;
  const life=Math.max(0,Math.min(1,(BILLBOARD_LIFETIME_MS-(Number(elapsedMs)||0))/BILLBOARD_FADE_MS));
  return Math.min(hit?BILLBOARD_BEHIND_RIDER_ALPHA:1,life);
}
export class SongBillboard {
  constructor(scene){
    this.scene=scene;
    this.active=false;
    this.elapsedMs=0;
    this.startCameraX=0;
    this.startX=GAME_WIDTH+80;
    this.g=scene.add.graphics().setDepth(-11);
    this.art=scene.add.image(0,0,'__MISSING').setDepth(-10).setVisible(false);
    // Dynamic text so a long title can scroll inside a crop window (marquee) instead of being cut short.
    // Origin (0,0): Phaser's crop scissor starts at the object's position, not its origin-adjusted bounds.
    this.title=scene.add.dynamicBitmapText(0,0,FONT_KEY,'',8).setOrigin(0,0).setTint(0xffd36e).setDepth(-9).setVisible(false);
    // Additive cone over the face, so the spotlight actually lights the art.
    this.light=scene.add.graphics().setDepth(-8).setBlendMode(1/* Phaser.BlendModes.ADD */);
    this.g.setVisible(false);
    this.light.setVisible(false);
  }
  _hide(){
    this.g.setVisible(false);this.art.setVisible(false);this.title.setVisible(false);this.light.setVisible(false);
  }
  showTrack(payload,audio){
    if(!payload?.id||!audio)return false;
    const state=audio.jukeboxSnapshot?.();
    if(state?.state!=='playing'&&state?.state!=='loading')return false;
    // Same track may continue seamlessly across run transitions without repeat signs.
    if(announced.get(audio)===payload.id)return false;
    announced.set(audio,payload.id);
    this.active=true;
    this.elapsedMs=0;
    this.startCameraX=this.scene.cameras.main.scrollX;
    this.startX=GAME_WIDTH+BILLBOARD_WIDTH*.5+20;
    this.trackId=payload.id;
    this.screenY=undefined;
    this.alpha=1;
    this._hide();
    // Title and art are both set here, before any draw: no frame can pair this
    // title with the previous song's thumbnail.
    this.titleFull=String(payload.title||payload.id).toUpperCase().trim();
    this.titleShort=billboardTitle(this.titleFull);
    this._titleMode=null;
    this.title.setText(this.titleShort);
    const token=this.token=(this.token||0)+1;
    const game=this.scene.game;
    this.youtubeId=trackYoutubeId(catalogTrack(game?.cache?.json?.get?.(CATALOG_CACHE_KEY),payload));
    this._setArt(GENERIC_ART_KEY);
    this.artPending=false;
    this.artWaitMs=0;
    if(this.youtubeId&&game?.textures){
      const status=billboardArtLoader(game).ensure(this.youtubeId,(ok)=>{
        // Late or stale results never repaint a sign that is already out or showing another song.
        if(token!==this.token||!this.artPending)return;
        this.artPending=false;
        if(ok)this._setArt(youtubeArtKey(this.youtubeId));
        this._reveal();
      });
      if(status==='ready')this._setArt(youtubeArtKey(this.youtubeId));
      else if(status==='loading')this.artPending=true;
    }
    return true;
  }
  /** Use texture `key` if it exists, else no art (plain panel); never a missing-texture box. */
  _setArt(key){
    const tex=this.scene.textures;
    this.artKey=tex?.exists?.(key)?key:null;
    this.hasVideo=Boolean(this.artKey&&this.artKey!==GENERIC_ART_KEY);
    if(this.artKey){
      tex.get(this.artKey).setFilter?.(LINEAR_FILTER);
      this.art.setTexture(this.artKey);
    }
  }
  /** The pass starts now: camera travel is measured from here, not from when the song changed. */
  _reveal(){
    this.elapsedMs=0;
    this.startCameraX=this.scene.cameras.main.scrollX;
  }
  update(dt,worldDance=0,reducedMotion=false){
    if(!this.active)return;
    const cam=this.scene.cameras.main,player=this.scene.sled;
    if(!cam||!player)return;
    const step=Number.isFinite(dt)?Math.max(0,Math.min(75,dt)):16.7;
    if(this.artPending){
      // Bounded wait off-screen for the thumbnail; then go out with the generic card.
      this.artWaitMs+=step;
      if(this.artWaitMs<BILLBOARD_ART_WAIT_MS)return;
      this.artPending=false;
      this._reveal();
    }
    this.elapsedMs+=step;
    const zoom=Number.isFinite(cam.zoom)&&cam.zoom>0?cam.zoom:1;
    const riderX=(player.x-cam.scrollX-GAME_WIDTH/2)*zoom+GAME_WIDTH/2;
    const riderY=(player.y-cam.scrollY-GAME_HEIGHT/2)*zoom+GAME_HEIGHT/2;
    const screenX=billboardScreenX(this.startX,(cam.scrollX-this.startCameraX)*zoom,
      this.elapsedMs,!reducedMotion);
    if(screenX< -BILLBOARD_WIDTH||this.elapsedMs>BILLBOARD_LIFETIME_MS){
      this.active=false;this._hide();
      return;
    }
    const terrainX=cam.getWorldPoint(screenX,0).x;
    let surface=Infinity;
    try{
      const h=this.scene.terrain?.heightAt(terrainX);
      if(Number.isFinite(h))surface=(h-cam.scrollY-GAME_HEIGHT/2)*zoom+GAME_HEIGHT/2;
    }catch{}
    // Ease toward the lane so bumpy terrain under the posts cannot jitter the sign.
    const target=billboardScreenY(riderY,surface);
    const k=Number.isFinite(this.screenY)?1-Math.exp(-step/150):1;
    const screenY=this.screenY=Number.isFinite(this.screenY)?this.screenY+(target-this.screenY)*k:target;
    this.screenX=screenX;
    const riderRect={x:riderX-16,y:riderY-RIDER_CLEAR_PX,w:32,h:RIDER_CLEAR_PX+10};
    const wantAlpha=billboardAlpha(billboardRect(screenX,screenY),riderRect,this.elapsedMs);
    this.alpha+=(wantAlpha-this.alpha)*(1-Math.exp(-step/90));
    const w=cam.getWorldPoint(screenX,screenY);
    const pulse=billboardPulseScale(reducedMotion?0:worldDance);
    const W=BILLBOARD_WIDTH,H=BILLBOARD_HEIGHT;
    // Only the frame and posts squash with the dance: scaling the photo and the
    // pixel-font title by 1.045/0.965 makes them shimmer under pixelArt.
    const g=this.g;g.clear();g.setPosition(w.x,w.y).setScale(pulse.x/zoom,pulse.y/zoom).setAlpha(this.alpha).setVisible(true);
    // Posts run down to the actual terrain (hidden behind the ground mesh), so the sign stands on the world.
    const postLen=Number.isFinite(surface)?Math.max(6,Math.min(150,(surface-screenY-H/2+6)/pulse.y)):18;
    g.lineStyle(2,0x59667c,.85).lineBetween(-W/2+12,H/2,-W/2+12,H/2+postLen);
    g.lineBetween(W/2-12,H/2,W/2-12,H/2+postLen);
    // Gantry arm and lamp housing centred over the sign.
    g.lineStyle(1,0x8a96aa,.9).lineBetween(-W/2+12,-H/2,-W/2+12,-H/2-10).lineBetween(-W/2+12,-H/2-10,0,-H/2-10);
    g.fillStyle(0x2a3344,1).fillRect(-6,-H/2-13,12,5);
    g.fillStyle(0xfff1c4,1).fillRect(-4,-H/2-9,8,1);
    // Metal frame and subdued body; the art is a separate texture above it, so
    // even without art the titled sign remains a truthful, recognizable billboard.
    g.fillStyle(0x08151e,.96).fillRoundedRect(-W/2,-H/2,W,H,4);
    g.lineStyle(2,0xffcc60,.95).strokeRoundedRect(-W/2,-H/2,W,H,4);
    const A=BILLBOARD_ART;
    // Only if even the bundled generic card failed to load: a plain panel, still titled.
    if(!this.artKey)g.fillStyle(0x26394f,.9).fillRect(-A.w/2,A.y-A.h/2,A.w,A.h);
    const inv=1/zoom;
    if(this.artKey){
      const src=this.art.frame;
      this.art.setPosition(w.x,w.y+A.y*inv).setScale(A.w/src.width*inv,A.h/src.height*inv)
        .setAlpha(this.alpha).setVisible(true);
    }
    // Full title as a marquee when it is wider than the sign; with reduced motion, the shortened title, static.
    const fullPx=measureText(this.titleFull),marquee=fullPx>BILLBOARD_TITLE_PX&&!reducedMotion;
    const mode=marquee?'marquee':'static';
    if(mode!==this._titleMode){
      this._titleMode=mode;
      const T=this.title;
      if(marquee)T.setText(this.titleFull).setSize(BILLBOARD_TITLE_PX,10);
      else T.setText(fullPx<=BILLBOARD_TITLE_PX?this.titleFull:this.titleShort).setSize(0,0).setScrollX(0);
    }
    const textPx=marquee?BILLBOARD_TITLE_PX:measureText(this.title.text);
    if(marquee)this.title.setScrollX(marqueeOffset(this.elapsedMs,fullPx-BILLBOARD_TITLE_PX));
    this.title.setPosition(w.x-textPx/2*inv,w.y+(H/2-11)*inv).setScale(inv).setAlpha(this.alpha).setVisible(true);
    // Spotlight: a warm additive cone from the lamp over the whole face, a touch brighter on the dance accent.
    const bright=(.1+.08*Math.max(0,Math.min(1,worldDance)))*this.alpha;
    const L=this.light;L.clear();L.setPosition(w.x,w.y).setScale(inv).setVisible(true);
    L.fillStyle(0xffe2a0,bright).fillPoints([{x:-4,y:-H/2-8},{x:4,y:-H/2-8},{x:W/2-3,y:H/2-3},{x:-W/2+3,y:H/2-3}],true);
    L.fillStyle(0xfff4d6,bright*.9).fillEllipse(0,-H/2+4,W*.55,8);
  }
  destroy(){
    // Invalidate any thumbnail still loading: its callback must not touch a shut-down scene.
    this.token=(this.token||0)+1;this.artPending=false;
    this.g.destroy();this.art.destroy();this.title.destroy();this.light.destroy();this.active=false;
  }
}
