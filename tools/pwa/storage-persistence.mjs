/** Browser storage protection is opt-in, advisory and never a backup. */
export async function storageProtectionStatus(storageManager){
 if(typeof storageManager?.persisted!=='function'||typeof storageManager?.persist!=='function')return 'unsupported';
 try{return await storageManager.persisted()?'granted':'available';}
 catch{return 'unavailable';}
}
/** Invoke persist() before the first await: gesture-sensitive browsers may
 * reject a permission prompt if the direct UI interaction is lost. */
export function requestStorageProtection(storageManager,{consent=false}={}){
 if(consent!==true)return Promise.reject(new Error('Explicit storage-protection consent required'));
 if(typeof storageManager?.persist!=='function')return Promise.resolve('unsupported');
 try{return Promise.resolve(storageManager.persist()).then(ok=>ok?'granted':'denied',()=> 'unavailable');}
 catch{return Promise.resolve('unavailable');}
}
