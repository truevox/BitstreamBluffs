/** #172 staged browser-only PWA download coordinator (no automatic SW registration).
 * The user chooses whether to start downloads. Never prunes source masters or caches.
 * It cannot itself assert that playback crossed a genuine segment boundary.
 */
import {musicMode,musicDownloadOrder} from './music-quality-policy.mjs';
import {downloadRealSong,isRealSongDownloaded} from './music-cache-prototype.mjs';

const TOKEN=/^[a-zA-Z0-9_-]{1,100}$/;
const GROUP=/^[a-zA-Z0-9:_-]{1,100}$/;

/** Exact source-bound policy includes only required, selected song groups.
 * Optional prefetch is a download priority, never a readiness requirement.
 */
export function musicPolicyForPlan(groups,mode,active={}){
  musicMode(mode);
  if(!Array.isArray(groups)||!groups.length)throw new TypeError('Expected nonempty tiered group inventory');
  const songs=new Map();
  const ids=new Set();
  for(const group of groups){
    const {lite,full,priority,originalId}=group||{};
    const songId=lite?.songId;
    if(!TOKEN.test(songId||'')||!GROUP.test(originalId||'')||ids.has(originalId)||
      !['required','bonus'].includes(priority)||lite?.quality!=='lite'||full?.quality!=='full'||
      lite?.songId!==full?.songId||lite?.originalId!==originalId||full?.originalId!==originalId||
      lite?.priority!==priority||full?.priority!==priority)
      throw new TypeError('Inconsistent source-backed quality inventory');
    ids.add(originalId);
    if(priority!=='required')continue;
    if(!songs.has(songId))songs.set(songId,{id:songId,activeQuality:'lite',required:[]});
    songs.get(songId).required.push(originalId);
  }
  if(!songs.size||songs.size>64)throw new TypeError('Missing required selected song groups');
  for(const song of songs.values()){
    song.required.sort();
    song.activeQuality=mode==='high'&&active[song.id]==='full'?'full':'lite';
  }
  return {mode,songs:[...songs.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}

/** Browser MessageChannel acknowledgment occurs only AFTER CacheStorage policy
 * write succeeds. Supplying a worker controller is explicit (not registration).
 */
export function postMusicPreference(controller,policy,{timeoutMs=8000}={}){
  if(typeof controller?.postMessage!=='function'||typeof MessageChannel==='undefined'||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)
    return Promise.reject(new TypeError('Controlled service worker and MessageChannel required'));
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    let settled=false;
    const done=(error)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      channel.port1.onmessage=null;
      channel.port1.close();channel.port2.close();
      error?reject(error):resolve(true);
    };
    const timer=setTimeout(()=>done(new Error('Music preference acknowledgment timed out')),timeoutMs);
    channel.port1.onmessage=event=>event.data?.ok?done(null):
      done(new Error(event.data?.error||'Music preference change rejected'));
    try{controller.postMessage({type:'bb-set-music-preference',policy},[channel.port2]);}
    catch(error){done(error)}
  });
}

export class MusicDownloadController {
  constructor({groups,storage,origin,subtle,fetcher,postPolicy,onProgress=()=>{},onStatus=()=>{},concurrency=4}){
    musicPolicyForPlan(groups,'off');
    if(!storage?.open||!subtle?.digest||!fetcher||!postPolicy||
      !/^https?:\/\//.test(origin||'')||!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>8)
      throw new TypeError('Missing music download capabilities');
    this.groups=groups;
    this.storage=storage;this.origin=origin;this.subtle=subtle;this.fetcher=fetcher;
    this.postPolicy=postPolicy;this.onProgress=onProgress;this.onStatus=onStatus;
    this.concurrency=concurrency;
    this.mode='off';this.active={};this.generation=0;this.abort=null;
    this.setting=Promise.resolve();this.running=Promise.resolve();
    this.lastError=null;
  }

  get policy(){return musicPolicyForPlan(this.groups,this.mode,this.active)}
  _notify(status,detail={}){this.onStatus({status,mode:this.mode,...detail})}

  /** Changing modes aborts the previous queue before dispatching any new one.
   * AudioSynth separately handles actual music muting immediately, without
   * waiting on downloads. This API never deletes cached assets.
   */
  async setMode(mode){
    musicMode(mode);
    const epoch=++this.generation;
    this.abort?.abort();
    const prior=this.setting.catch(()=>{});
    const setting=prior.then(async()=>{
      if(epoch!==this.generation)return false;
      const previousMode=this.mode,previousActive={...this.active};
      this.mode=mode;
      if(mode!=='high')this.active={};
      this.lastError=null;
      try{await this.postPolicy(this.policy)}
      catch(error){
        // The SW may still hold the earlier policy. Don't claim a new
        // preference as active until its CacheStorage ACK actually succeeds.
        // A newer setMode call has its own generation and must not be undone.
        if(epoch===this.generation){
          this.mode=previousMode;this.active=previousActive;
          this.lastError=error;
          this._notify('policy-failed',{error:String(error)});
        }
        throw error;
      }
      if(epoch!==this.generation)return false;
      this._notify(mode==='off'?'disabled':'policy-stored');
      if(mode!=='off'){
        const controller=new AbortController();this.abort=controller;
        this.running=this._download(epoch,controller.signal);
      }else{this.abort=null;this.running=Promise.resolve();}
      return true;
    });
    this.setting=setting;
    return setting;
  }

  async _download(epoch,signal){
    const ordered=musicDownloadOrder(this.mode,this.groups);
    try{
      for(const item of ordered){
        if(signal.aborted||epoch!==this.generation||this.mode==='off')return;
        const {group,quality}=item;
        this._notify('checking',{id:group.id,quality});
        // Normal downloader validates every existing asset before trusting
        // its marker and resumes missing assets without deleting old data.
        const result=await downloadRealSong(group,{
          storage:this.storage,origin:this.origin,subtle:this.subtle,fetcher:this.fetcher,
          concurrency:this.concurrency,signal,onProgress:p=>{
            if(epoch===this.generation&&!signal.aborted)this.onProgress({...p,quality});
          },
        });
        if(signal.aborted||epoch!==this.generation)return;
        this._notify('group-ready',{id:group.id,quality,result});
      }
      if(epoch===this.generation)this._notify('downloads-complete');
    }catch(error){
      if(signal.aborted||epoch!==this.generation)return;
      this.lastError=error;
      this._notify('download-failed',{error:String(error)});
    }
  }

  async whenIdle(){await this.setting;await this.running}

  /** Must be called ONLY by a renderer/transport integration at an actual
   * safe musical boundary. This changes only future fetches, never decoded
   * audio buffers already scheduled in StemMusicDirector. That latter work
   * is a separate, mandatory production integration gate.
   */
  async atVerifiedBoundary(songId){
    await this.setting;
    if(this.mode!=='high'||!TOKEN.test(songId||'')||this.active[songId]==='full')return false;
    const required=this.groups.filter(x=>x.priority==='required'&&x.lite.songId===songId);
    if(!required.length)return false;
    // Race guard: downloaded != integrity verified until ALL required pieces
    // pass SHA-256 checks, and the owner's preferred mode hasn't changed.
    const epoch=this.generation;
    for(const group of required){
      if(!await isRealSongDownloaded(group.full,{storage:this.storage,origin:this.origin,subtle:this.subtle}))return false;
      if(epoch!==this.generation)return false;
    }
    if(epoch!==this.generation||this.mode!=='high')return false;
    // Serialize preference writes with setMode: a late promotion ACK must
    // NEVER replace a newer OFF/SAVER preference after the player toggles it.
    const prior=this.setting.catch(()=>{});
    const update=prior.then(async()=>{
      if(epoch!==this.generation||this.mode!=='high'||this.active[songId]==='full')return false;
      this.active[songId]='full';
      try{await this.postPolicy(this.policy)}
      catch(error){if(epoch===this.generation)delete this.active[songId];throw error}
      if(epoch!==this.generation)return false;
      this._notify('full-ready-for-future-fetches',{songId});
      return true;
    });
    this.setting=update;
    return update;
  }
}
