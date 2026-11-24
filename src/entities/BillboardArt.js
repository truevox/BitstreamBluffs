/** Issue #54: which artwork a song billboard shows, driven only by catalog metadata.
 *
 * 1. A confirmed YouTube ID: explicit `track.youtubeId`, or (backward
 *    compatible) a catalog `track.id` that is itself an 11-character YouTube
 *    video ID. `youtubeId: null` explicitly opts a track out.
 * 2. Otherwise, or while/if that thumbnail is unavailable, the bundled generic
 *    NOW PLAYING card. No track is special-cased.
 *
 * Thumbnails load at most once per ID per session, never per frame: the bundled
 * `music/thumbnails/<id>.jpg` first, then YouTube's public thumbnail URL. A
 * failure is remembered and the generic card stays.
 */
export const YOUTUBE_ID_RE=/^[A-Za-z0-9_-]{11}$/;
export const GENERIC_ART_KEY='bb-art-generic';
export const GENERIC_ART_URL='music/billboard/generic-now-playing.png';
export const CATALOG_CACHE_KEY='bb-music-catalog';
export const CATALOG_URL='music/catalog.json';

export const isYoutubeId=(v)=>typeof v==='string'&&YOUTUBE_ID_RE.test(v);

/** Confirmed YouTube video ID for a catalog track, or null. */
export function trackYoutubeId(track){
  if(!track||typeof track!=='object')return null;
  if(Object.prototype.hasOwnProperty.call(track,'youtubeId'))return isYoutubeId(track.youtubeId)?track.youtubeId:null;
  return isYoutubeId(track.id)?track.id:null;
}
export const youtubeArtKey=(id)=>`bb-youtube-${id}`;
/** Load order for one YouTube ID: bundled copy, then YouTube's own thumbnail (sends CORS `*`). */
export function youtubeArtSources(id){
  return isYoutubeId(id)?[`music/thumbnails/${id}.jpg`,`https://i.ytimg.com/vi/${id}/mqdefault.jpg`]:[];
}
/** Catalog entry for a playing track: the event payload overlaid on the catalog row with the same id. */
export function catalogTrack(catalog,payload){
  if(!payload?.id)return null;
  const row=Array.isArray(catalog?.tracks)?catalog.tracks.find(t=>t&&t.id===payload.id):null;
  return {...(row||{}),...payload};
}

/** Per-game, scene-independent thumbnail loader (Phaser's TextureManager is global). */
export class BillboardArtLoader {
  /** @param {{exists:(k:string)=>boolean, addImage:(k:string,img:any)=>any}} textures */
  constructor(textures,makeImage=()=>(typeof Image==='function'?new Image():null)){
    this.textures=textures;
    this.makeImage=makeImage;
    this.state=new Map();   // id -> 'loading' | 'ready' | 'failed'
    this.waiters=new Map(); // id -> [callbacks]
  }
  status(id){
    if(!isYoutubeId(id))return 'failed';
    if(this.textures.exists(youtubeArtKey(id)))return 'ready';
    return this.state.get(id)||'idle';
  }
  /** Start loading (once) and call `done(ready:boolean)` when settled. Returns the current status. */
  ensure(id,done){
    const s=this.status(id);
    if(s==='ready'||s==='failed'){done?.(s==='ready');return s;}
    if(done){const w=this.waiters.get(id)||[];w.push(done);this.waiters.set(id,w);}
    if(s==='idle'){this.state.set(id,'loading');this._try(id,youtubeArtSources(id),0);}
    return 'loading';
  }
  _settle(id,ok){
    this.state.set(id,ok?'ready':'failed');
    const w=this.waiters.get(id)||[];this.waiters.delete(id);
    for(const fn of w){try{fn(ok);}catch{/* a stale scene must not break other waiters */}}
  }
  _try(id,sources,i){
    const img=i<sources.length?this.makeImage():null;
    if(!img){this._settle(id,false);return;}
    img.crossOrigin='anonymous'; // a tainted image cannot become a WebGL texture
    img.onload=()=>{
      if(!(img.naturalWidth>0)){this._try(id,sources,i+1);return;}
      try{
        if(!this.textures.exists(youtubeArtKey(id)))this.textures.addImage(youtubeArtKey(id),img);
        this._settle(id,true);
      }catch{this._try(id,sources,i+1);}
    };
    img.onerror=()=>this._try(id,sources,i+1);
    img.src=sources[i];
  }
}
const loaders=new WeakMap();
/** The one loader for this Phaser game. */
export function billboardArtLoader(game){
  let l=loaders.get(game);
  if(!l){l=new BillboardArtLoader(game.textures);loaders.set(game,l);}
  return l;
}
/** PreloadScene: the generic card and the catalog (for youtubeId metadata). */
export function queueBillboardArt(loader){
  loader.image(GENERIC_ART_KEY,GENERIC_ART_URL);
  loader.json(CATALOG_CACHE_KEY,CATALOG_URL);
}
/** Warm every catalog track's thumbnail once at boot, so a song's first billboard rarely waits. */
export function prewarmBillboardArt(game){
  const catalog=game.cache?.json?.get?.(CATALOG_CACHE_KEY);
  if(!Array.isArray(catalog?.tracks))return 0;
  const loader=billboardArtLoader(game);
  let n=0;
  for(const t of catalog.tracks){const id=trackYoutubeId(t);if(id){loader.ensure(id);n++;}}
  return n;
}
