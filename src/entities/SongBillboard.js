/** Cosmetic song billboard: one roadside pass per ACTUAL track identity change.
 * Original YouTube thumbnail files are bundled locally, never fetched per
 * frame. A local-only recording is explicitly labelled local, not fabricated.
 */
import {GAME_WIDTH,GAME_HEIGHT} from '../constants.js';
import {FONT_KEY} from '../ui/PixelFont.js';

const VIDEO_IDS=Object.freeze(['FEsxYVStla4','WRBGQUqD54U','FYImnz5-hXs']);
export const BILLBOARD_WIDTH=122;
export const BILLBOARD_HEIGHT=82;
export function billboardThumbnail(trackId){
  return VIDEO_IDS.includes(trackId)?`bb-youtube-${trackId}`:null;
}
export function queueBillboardThumbnails(loader){
  for(const id of VIDEO_IDS)loader.image(`bb-youtube-${id}`,`music/thumbnails/${id}.jpg`);
}
export function billboardScreenY(riderScreenY,groundScreenY=Infinity){
  // Prefer the sky above the rider's lane, then keep the sign above ACTUAL
  // nearby terrain. A low sign hidden behind the mesh is not useful.
  const preferred=Number.isFinite(riderScreenY)&&riderScreenY<135?194:74;
  const aboveGround=Number.isFinite(groundScreenY)
    ?groundScreenY-BILLBOARD_HEIGHT*.5-8:preferred;
  return Math.max(BILLBOARD_HEIGHT*.5+3,Math.min(preferred,aboveGround));
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
export class SongBillboard {
  constructor(scene){
    this.scene=scene;
    this.active=false;
    this.elapsedMs=0;
    this.startCameraX=0;
    this.startX=GAME_WIDTH+80;
    this.g=scene.add.graphics().setDepth(-11);
    this.art=scene.add.image(0,0,'__MISSING').setDepth(-10).setVisible(false);
    this.title=scene.add.bitmapText(0,0,FONT_KEY,'',8).setOrigin(.5).setTint(0xffd36e).setDepth(-9).setVisible(false);
    this.g.setVisible(false);
  }
  showTrack(payload,audio){
    if(!payload?.id||!audio)return false;
    const state=audio.jukeboxSnapshot?.();
    if(state?.state!=='playing'&&state?.state!=='loading')return false;
    // Global per-AudioSynth ephemeral marker survives scene/retry. Same track
    // may continue seamlessly across run transitions without repeat signs.
    if(audio._billboardAnnouncedTrackId===payload.id)return false;
    audio._billboardAnnouncedTrackId=payload.id;
    this.active=true;
    this.elapsedMs=0;
    this.startCameraX=this.scene.cameras.main.scrollX;
    this.startX=GAME_WIDTH+BILLBOARD_WIDTH*.5+20;
    this.trackId=payload.id;
    const key=billboardThumbnail(payload.id);
    this.hasVideo=Boolean(key&&this.scene.textures.exists(key));
    this.art.setVisible(false);
    if(this.hasVideo)this.art.setTexture(key).setDisplaySize(110,61);
    this.title.setText((payload.title||payload.id).toUpperCase().slice(0,26)).setVisible(false);
    this.g.setVisible(false);
    return true;
  }
  update(dt,worldDance=0,reducedMotion=false){
    if(!this.active)return;
    const cam=this.scene.cameras.main,player=this.scene.sled;
    if(!cam||!player)return;
    this.elapsedMs+=Number.isFinite(dt)?Math.max(0,Math.min(75,dt)):16.7;
    const p=cam.worldToScreen?.(player.x,player.y);
    // Phaser Camera.worldToScreen can be missing in older PIXI adapters;
    // use the camera's own conversion if available.
    const riderY=p?.y??((player.y-cam.scrollY-GAME_HEIGHT/2)*cam.zoom+GAME_HEIGHT/2);
    const screenX=billboardScreenX(this.startX,(cam.scrollX-this.startCameraX)*cam.zoom,
      this.elapsedMs,!reducedMotion);
    if(screenX< -BILLBOARD_WIDTH||this.elapsedMs>14000){
      this.active=false;this.g.setVisible(false);this.art.setVisible(false);this.title.setVisible(false);
      return;
    }
    const terrainX=cam.getWorldPoint(screenX,0).x;
    let surface=Infinity;
    try{
      const h=this.scene.terrain?.heightAt(terrainX);
      if(Number.isFinite(h))surface=(h-cam.scrollY-GAME_HEIGHT/2)*cam.zoom+GAME_HEIGHT/2;
    }catch{}
    const screenY=billboardScreenY(riderY,surface);
    // Make the actual camera-safe placement inspectable by QA and reuse it
    // for spotlight/panel placement. Camera.worldToScreen is not a Phaser API.
    this.screenX=screenX;this.screenY=screenY;
    const w=cam.getWorldPoint(screenX,screenY);
    const zoom=Number.isFinite(cam.zoom)&&cam.zoom>0?cam.zoom:1;
    const pulse=billboardPulseScale(reducedMotion?0:worldDance);
    const sx=pulse.x/zoom,sy=pulse.y/zoom;
    const W=BILLBOARD_WIDTH,H=BILLBOARD_HEIGHT;
    const g=this.g;g.clear();g.setPosition(w.x,w.y).setScale(sx,sy).setVisible(true);
    // Spotlight from a gantry just above the billboard, with a soft cone.
    const bright=.18+.12*Math.max(0,worldDance);
    g.fillStyle(0xffe8aa,bright).fillTriangle(-45,-H/2-18, -W/2+7,-H/2+4, W/2-7,-H/2+4);
    g.lineStyle(1,0xffe8aa,.35).lineBetween(-45,-H/2-18,-W/2+7,-H/2+4);
    g.lineStyle(1,0xffd678,.8).lineBetween(-45,-H/2-18,-45,-H/2-10);
    // Metal frame and subdued body; original thumbnail is an independent
    // texture just above this shape, so even when art isn't available the
    // title sign remains a truthful, recognizable billboard.
    g.fillStyle(0x08151e,.96).fillRoundedRect(-W/2,-H/2,W,H,5);
    g.lineStyle(2,0xffcc60,.95).strokeRoundedRect(-W/2,-H/2,W,H,5);
    if(!this.hasVideo){
      g.fillStyle(0x26394f,.9).fillRect(-54,-36,108,59);
      g.lineStyle(1,0x54c8f4,.35).lineBetween(-54,-36,54,23);
      g.lineBetween(-54,23,54,-36);
    }
    g.lineStyle(2,0x59667c,.78).lineBetween(-W/2+12,H/2,-W/2+12,H/2+18);
    g.lineBetween(W/2-12,H/2,W/2-12,H/2+18);
    const key=billboardThumbnail(this.trackId);
    if(this.hasVideo&&key){
      this.art.setPosition(w.x,w.y-5/zoom).setScale((110/320)*sx,(61/180)*sy).setVisible(true);
    }
    this.title.setPosition(w.x,w.y+32/zoom).setScale(.65*sx,.65*sy).setVisible(true);
  }
  destroy(){this.g.destroy();this.art.destroy();this.title.destroy();this.active=false;}
}
