/** Browser-only, explicit local download of an incompatible old save.
 * No migration, network request, IndexedDB mutation or authority claim.
 * Must run synchronously on the SECOND user gesture (browser download policy).
 */
export function requestSuspendBackupDownload(bytes,{
 documentRef=globalThis.document,urlRef=globalThis.URL,BlobCtor=globalThis.Blob,
 delayRevoke=cb=>globalThis.setTimeout(cb,60000),
 now=()=>new Date(),
}={}){
 if(!(bytes instanceof Uint8Array)||bytes.length===0||
    !documentRef?.body||typeof urlRef?.createObjectURL!=='function'||
    typeof BlobCtor!=='function')return {ok:false,code:'download-unavailable'};
 let href=null,link=null;
 try{
  const blob=new BlobCtor([Uint8Array.from(bytes)],{type:'application/octet-stream'});
  href=urlRef.createObjectURL(blob);
  link=documentRef.createElement('a');
  link.href=href;
  link.download='bitstream-bluffs-old-save-'+now().toISOString().replace(/[.:]/g,'-')+'.bbsave';
  link.style.display='none';
  documentRef.body.appendChild(link);
  link.click();
  return {ok:true,requested:true};
 }catch{return {ok:false,code:'download-unavailable'};}
 finally{
  try{link?.remove();}catch{}
  if(href)try{delayRevoke(()=>urlRef.revokeObjectURL(href));}catch{}
 }
}
