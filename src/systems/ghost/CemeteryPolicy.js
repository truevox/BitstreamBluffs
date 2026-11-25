/** #68 owner-approved device-local pose history policy, not GhostLibrary #56. */
export const CEMETERY_DEFAULT_ATTEMPTS=5;
export const CEMETERY_MAX_ATTEMPTS=24;
export const CEMETERY_RENDER_LIMIT=12;
export const CEMETERY_TOTAL_BYTE_BUDGET=8*1024*1024;
export const CEMETERY_ENTRY_TRACE_CHARS=180000;

export function cemeteryKeepCount(value){
 return Number.isInteger(value)&&value>=0&&value<=CEMETERY_MAX_ATTEMPTS
  ?value:CEMETERY_DEFAULT_ATTEMPTS;
}

/** Arrow keys change the retained attempt count by ONE. Zero explicitly erases
 * history from this separate store (but never GhostLibrary or trusted evidence).
 */
export const CEMETERY_KEEP_CHOICES=Object.freeze(Array.from({length:CEMETERY_MAX_ATTEMPTS+1},(_,n)=>({
 value:n,label:n===0?'0 OFF/ERASE':n===CEMETERY_MAX_ATTEMPTS?`${n} MAX`:`${n} KEEP / LESS ERASES`,
})));
