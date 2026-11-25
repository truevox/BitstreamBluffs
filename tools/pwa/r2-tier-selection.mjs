/** Pure quality transition policy. A caller must independently establish
 * complete hash-verified group readiness and a stopped transport boundary. */
export function selectR2Tier({mode,current=null,stopped=false,required=[]}={}){
 if(!['high','space-saver','no-music'].includes(mode)||![null,'lite','full'].includes(current)||typeof stopped!=='boolean'||!Array.isArray(required)||required.some(g=>!g||typeof g.lite!=='boolean'||typeof g.full!=='boolean'))throw Error('Invalid tier state');
 if(mode==='no-music')return {quality:null,reason:'disabled'};
 const lite=required.length>0&&required.every(g=>g.lite),full=required.length>0&&required.every(g=>g.full);
 if(current!==null&&!stopped){
  if(current==='lite'&&lite)return {quality:'lite',reason:mode==='high'&&full?'await-stopped-boundary':'continue'};
  if(current==='full'&&full)return {quality:'full',reason:mode==='space-saver'?'await-stopped-boundary':'continue'};
  return {quality:null,reason:'active-tier-incomplete-stop-required'};
 }
 if(mode==='space-saver')return lite?{quality:'lite',reason:'space-saver'}:{quality:null,reason:'download-lite'};
 if(current===null&&lite)return {quality:'lite',reason:'lite-first'};
 if(stopped&&full)return {quality:'full',reason:'verified-full-at-stop'};
 if(lite)return {quality:'lite',reason:'upgrading'};
 return {quality:null,reason:'download-lite'};
}
