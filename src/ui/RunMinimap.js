/** Read-only rider-relative terrain minimap. No gameplay state or collisions. */
import { GAME_WIDTH, GAME_HEIGHT, SCENES } from '../constants.js';

export const MINIMAP_BOUNDS=Object.freeze({w:104,h:49,left:8,top:80,bottom:178,right:GAME_WIDTH-112});

export function minimapCorner(riderScreenX,riderScreenY){
  // Never obscure the rider when they drift into the bottom-left quadrant.
  return Number.isFinite(riderScreenX)&&Number.isFinite(riderScreenY)&&
    riderScreenX<GAME_WIDTH*0.37&&riderScreenY>GAME_HEIGHT*0.56
    ? 'top-right':'bottom-left';
}
export function minimapPlacement(corner){
  return corner==='top-right'
    ? {x:MINIMAP_BOUNDS.right,y:MINIMAP_BOUNDS.top,w:MINIMAP_BOUNDS.w,h:MINIMAP_BOUNDS.h}
    : {x:MINIMAP_BOUNDS.left,y:MINIMAP_BOUNDS.bottom,w:MINIMAP_BOUNDS.w,h:MINIMAP_BOUNDS.h};
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

export class RunMinimap {
  constructor(scene){
    this.scene=scene;
    this.g=scene.add.graphics();
    scene.hud.add(this.g);
    this.elapsed=Infinity;
    this.lastCorner=null;
  }
  update(dt){
    this.elapsed+=Number.isFinite(dt)?Math.max(0,dt):16.7;
    if(this.elapsed<110)return;
    this.elapsed=0;
    let run;
    try{run=this.scene.scene.get(SCENES.RUN);}catch{}
    const sled=run?.sled,terrain=run?.terrain,cam=run?.cameras?.main;
    if(!sled||!terrain||!cam||run.crashed){this.g.clear();return;}
    const sx=(sled.x-cam.scrollX-GAME_WIDTH/2)*cam.zoom+GAME_WIDTH/2;
    const sy=(sled.y-cam.scrollY-GAME_HEIGHT/2)*cam.zoom+GAME_HEIGHT/2;
    const corner=minimapCorner(sx,sy),rect=minimapPlacement(corner);
    this.lastCorner=corner;
    // Only sample actual terrain: the current game's deterministic world.
    const profile=minimapTerrainProfile(x=>terrain.heightAt(x),sled.x);
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
