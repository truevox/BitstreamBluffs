/** #172 experimental, never deployed: owner choice separate from song ON/OFF.
 * 'high' gives instant Lite and optional later Full; 'saver' keeps Lite;
 * 'off' is silence and no new audio downloads. Nothing deletes old caches.
 */
export const MUSIC_QUALITY_MODES=Object.freeze(['high','saver','off']);
export function musicMode(mode){
  if(!MUSIC_QUALITY_MODES.includes(mode))throw new TypeError('Invalid music quality mode');
  return mode;
}
export function musicDownloadOrder(mode,groups){
  musicMode(mode);
  if(!Array.isArray(groups))throw new TypeError('Music groups required');
  if(mode==='off')return [];
  const ordered=groups.flatMap(x=>{
    if(!x||!x.lite||!x.full||!['required','bonus'].includes(x.priority))
      throw new TypeError('Each selected group requires Lite, Full, and priority');
    return [{priority:x.priority,quality:'lite',group:x.lite},
      ...(mode==='high'?[{priority:x.priority,quality:'full',group:x.full}]:[])];
  });
  // Finish ALL Lite required groups before ANY Full; optional future-biome
  // prefetch is last, and is never required for ready status.
  return ['required:lite','required:full','bonus:lite','bonus:full']
    .flatMap(key=>ordered.filter(x=>x.priority+':'+x.quality===key));
}
export function chooseMusicQuality({mode,current='lite',atBoundary=false,required=[]}={}){
  musicMode(mode);
  if(!Array.isArray(required)||required.some(x=>!x||typeof x.lite!=='boolean'||typeof x.full!=='boolean'))
    throw new TypeError('Required verification states missing');
  if(mode==='off')return {audible:false,quality:null,reason:'off'};
  const hasLite=required.length>0&&required.every(x=>x.lite);
  const hasFull=required.length>0&&required.every(x=>x.full);
  if(mode==='saver'){
    if(!hasLite)return {audible:false,quality:null,reason:'download-lite'};
    return {audible:true,quality:'lite',reason:'space-saver'};
  }
  if(!hasLite&&!hasFull)return {audible:false,quality:null,reason:'download-lite'};
  if(current==='full'&&hasFull)return {audible:true,quality:'full',reason:'high-ready'};
  if(atBoundary&&hasFull)return {audible:true,quality:'full',reason:'promoted'};
  if(hasLite)return {audible:true,quality:'lite',reason:hasFull?'upgrade-pending-boundary':'upgrading'};
  // Full is already cached but Lite was evicted: don't pretend the song is
  // unavailable just because the bootstrap tier disappeared.
  if(hasFull)return {audible:true,quality:'full',reason:'full-only'};
  return {audible:false,quality:null,reason:'download-lite'};
}
