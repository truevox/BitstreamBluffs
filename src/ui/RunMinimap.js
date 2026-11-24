/** Read-only rider-relative terrain minimap. No gameplay state or collisions. */
import { GAME_WIDTH, GAME_HEIGHT, SCENES } from '../constants.js';
import { rectsHit } from './HudLayout.js';

export const MINIMAP_BOUNDS=Object.freeze({w:104,h:49,left:8,top:80,bottom:178,right:GAME_WIDTH-112});
/** Dwell before a voluntary corner change; a slot that hits the rider moves at once. */
export const MINIMAP_SWITCH_DWELL_MS=600;
/** Alpha while a centre banner / strip paints over the map. */
export const MINIMAP_OCCLUDED_ALPHA=0.28;

export function minimapCorner(riderScreenX,riderScreenY){
  // Owner rule: never obscure the rider when they drift into the bottom-left quadrant.
  return Number.isFinite(riderScreenX)&&Number.isFinite(riderScreenY)&&
    riderScreenX<GAME_WIDTH*0.37&&riderScreenY>GAME_HEIGHT*0.56
    ? 'top-right':'bottom-left';
}
export function minimapPlacement(corner){
  return corner==='top-right'
    ? {x:MINIMAP_BOUNDS.right,y:MINIMAP_BOUNDS.top,w:MINIMAP_BOUNDS.w,h:MINIMAP_BOUNDS.h}
    : {x:MINIMAP_BOUNDS.left,y:MINIMAP_BOUNDS.bottom,w:MINIMAP_BOUNDS.w,h:MINIMAP_BOUNDS.h};
}
/** Screen box the rider occupies (game px), padded so the map never crowds them. */
export function minimapRiderRect(riderScreenX,riderScreenY){
  if(!Number.isFinite(riderScreenX)||!Number.isFinite(riderScreenY))return null;
  return {x:riderScreenX-16,y:riderScreenY-24,w:32,h:34};
}
/**
 * Candidate slots in preference order. Bottom-left first (owner rule), then the
 * same column lifted clear of the touch buttons, then top-right. When the rider
 * is in the bottom-left quadrant the owner rule puts top-right first.
 */
export function minimapCandidates(riderScreenX,riderScreenY,keepOuts=[]){
  const {w,h,left}=MINIMAP_BOUNDS;
  const bl=minimapPlacement('bottom-left'),tr=minimapPlacement('top-right');
  const out=[{corner:'bottom-left',...bl}];
  // Lift above whatever bottom-left keep-out (the left touch cluster, the
  // power-up row) it would touch, but never into the top HUD rows.
  let top=bl.y;
  for(const k of keepOuts)if(rectsHit({x:left,y:bl.y,w,h},k,2))top=Math.min(top,k.y-h-4);
  if(top<bl.y&&top>=MINIMAP_BOUNDS.top+h/2)out.push({corner:'left-raised',x:left,y:Math.round(top),w,h});
  out.push({corner:'top-right',...tr});
  if(minimapCorner(riderScreenX,riderScreenY)==='top-right')out.sort((a,b)=>(b.corner==='top-right')-(a.corner==='top-right'));
  return out;
}
/**
 * Pick the first candidate clear of the rider and every keep-out. If none is
 * fully clear, the rider still wins: the least-covered slot that misses the rider.
 */
export function chooseMinimapSlot(riderScreenX,riderScreenY,keepOuts=[]){
  const rider=minimapRiderRect(riderScreenX,riderScreenY);
  const cands=minimapCandidates(riderScreenX,riderScreenY,keepOuts);
  let best=null,bestHits=Infinity;
  for(const c of cands){
    if(rider&&rectsHit(c,rider,2))continue;
    const hits=keepOuts.filter(k=>rectsHit(c,k,2)).length;
    if(hits===0)return c;
    if(hits<bestHits){best=c;bestHits=hits;}
  }
  return best||cands[0];
}
/** Sample the SAME deterministic terrain as the physical sled, over a small
 * local span. Never display speculative POIs, discovered hazards, or fake map
 * coordinates. Geometry is scaled into a flat 0..1 preview rectangle.
 */
export function minimapTerrainProfile(heightAt,playerX,{behind=150,ahead=550,steps=26}={}){
  if(typeof heightAt!=='function'||!Number.isFinite(playerX))return null;
  const lo=Math.max(0,playerX-behind),hi=Math.max(lo+1,playerX+ahead);
  const points=[];let min=Infinity,max=-Infinity;
  for(let i=0;i<=steps;i++){
    const x=lo+(hi-lo)*i/steps;
    let y=NaN;
    try{y=heightAt(x)}catch{return null;}
    if(!Number.isFinite(y))return null;
    min=Math.min(min,y);max=Math.max(max,y);
    points.push({u:i/steps,y});
  }
  const height=Math.max(44,max-min);
  for(const p of points)p.v=0.18+0.64*(p.y-min)/height;
  return {points,riderU:Math.max(0,Math.min(1,(playerX-lo)/(hi-lo))),minY:min,maxY:max};
}
/** World px of terrain to show ahead: always more than the screen already shows at this zoom. */
export function minimapAheadPx(riderScreenX,zoom){
  const z=Number.isFinite(zoom)&&zoom>0?zoom:1;
  const visible=(GAME_WIDTH-(Number.isFinite(riderScreenX)?riderScreenX:GAME_WIDTH*0.38))/z;
  return Math.round(Math.max(550,Math.min(1400,visible*1.6)));
}

export class RunMinimap {
  constructor(scene){
    this.scene=scene;
    this.g=scene.add.graphics();
    scene.hud.add(this.g);
    this.elapsed=Infinity;
    this.lastCorner=null;
    this.rect=null;
    this._pending=null;
    this._pendingMs=0;
  }
  /** Settle on a slot: move at once off the rider, otherwise only after the new choice holds for the dwell. */
  _settle(choice,rider,dtMs){
    const cur=this.rect;
    if(!cur||(rider&&rectsHit(cur,rider,2))){this._pending=null;return choice;}
    if(choice.corner===this.lastCorner&&choice.y===cur.y){this._pending=null;return choice;}
    if(this._pending?.corner!==choice.corner){this._pending=choice;this._pendingMs=0;return cur;}
    this._pendingMs+=dtMs;
    if(this._pendingMs<MINIMAP_SWITCH_DWELL_MS)return cur;
    this._pending=null;
    return choice;
  }
  /**
   * @param {number} dt
   * @param {{keepOuts?:object[],occluders?:object[]}} [hud] keep-outs (touch buttons,
   *   fixed HUD rows, bottom row) the map must not sit on; occluders (centre banners,
   *   the full-width strip) it dims under instead of pushing them into the playfield.
   */
  update(dt,{keepOuts=[],occluders=[]}={}){
    this.elapsed+=Number.isFinite(dt)?Math.max(0,dt):16.7;
    if(this.rect)this.g.setAlpha(occluders.some(o=>rectsHit(this.rect,o))?MINIMAP_OCCLUDED_ALPHA:1);
    if(this.elapsed<110)return;
    const stepMs=Number.isFinite(this.elapsed)?this.elapsed:110;
    this.elapsed=0;
    let run;
    try{run=this.scene.scene.get(SCENES.RUN);}catch{}
    const sled=run?.sled,terrain=run?.terrain,cam=run?.cameras?.main;
    if(!sled||!terrain||!cam||run.crashed){this.g.clear();this.rect=null;return;}
    const sx=(sled.x-cam.scrollX-GAME_WIDTH/2)*cam.zoom+GAME_WIDTH/2;
    const sy=(sled.y-cam.scrollY-GAME_HEIGHT/2)*cam.zoom+GAME_HEIGHT/2;
    const rect=this._settle(chooseMinimapSlot(sx,sy,keepOuts),minimapRiderRect(sx,sy),stepMs);
    this.lastCorner=rect.corner;
    this.rect=rect;
    // Only sample actual terrain: the current game's deterministic world.
    const profile=minimapTerrainProfile(x=>terrain.heightAt(x),sled.x,
      {ahead:minimapAheadPx(sx,cam.zoom),steps:32});
    const g=this.g;g.clear();if(!profile)return;
    const {x,y,w,h}=rect,pad=6;
    g.fillStyle(0x060f1e,.76).fillRoundedRect(x,y,w,h,3);
    g.lineStyle(1,0x2ccde5,.74).strokeRoundedRect(x+.5,y+.5,w-1,h-1,3);
    const chartX=x+pad,chartY=y+7,chartW=w-pad*2,chartH=h-15;
    g.lineStyle(1,0x81bfff,.84);
    let prev=null;
    for(const p of profile.points){
      const next={x:chartX+p.u*chartW,y:chartY+p.v*chartH};
      if(prev)g.lineBetween(prev.x,prev.y,next.x,next.y);
      prev=next;
    }
    const rp=profile.points[Math.max(0,Math.min(profile.points.length-1,
      Math.round(profile.riderU*(profile.points.length-1))))];
    const rx=chartX+profile.riderU*chartW,ry=chartY+rp.v*chartH;
    g.fillStyle(0xffd24b,1).fillCircle(rx,ry-2,2.6);
    g.lineStyle(1,0xffd24b,1).lineBetween(rx,ry-5,rx,ry-10);
    g.lineStyle(1,0x2ccde5,.4).lineBetween(x+w-11,y+h-5,x+w-5,y+h-5);
  }
  destroy(){this.g?.destroy();this.g=null;}
}
