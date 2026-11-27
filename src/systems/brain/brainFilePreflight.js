/** #450 bounded JSON-only hostile brain-file preflight, no schema admission.
 *
 * It rejects oversized / malformed / prototype-poisoning wire bytes before a
 * trainer can see them. A successful result is ONLY a safe syntax tree; the
 * observation/action/model ABI validator has NOT been applied and must be
 * implemented with #24 before any training, execution or publishing.
 *
 * User-controlled input is accepted ONLY as raw text/bytes, NEVER a JS object,
 * function, proxy, File URL, module, or code. No eval, imports or execution.
 */
export const BRAIN_PREFLIGHT_LIMITS=Object.freeze({
 maxBytes:2*1024*1024,maxDepth:32,maxNodes:80000,
 maxArrayLength:65536,maxObjectKeys:1024,maxStringLength:8192,
 maxAbsNumber:1e12,
});
const fail=code=>({ok:false,code});
const badKeys=new Set(['__proto__','prototype','constructor']);

/** A bounded iterative copy into null-prototype objects, never accessors or
 * inherited keys. Reflection/reads are limited to JSON.parse's own output;
 * callers cannot pass arbitrary JS objects into this function.
 */
function safeTree(source){
 if(source===null||Array.isArray(source)||typeof source!=='object')return fail('expected-object');
 const output=Object.create(null),stack=[{source,target:output,depth:0}];
 let nodes=1; // the root itself counts, as do all primitive leaves
 while(stack.length){
  const {source:node,target,depth}=stack.pop();
  if(depth>BRAIN_PREFLIGHT_LIMITS.maxDepth)return fail('max-depth');
  if(Array.isArray(node)){
   if(node.length>BRAIN_PREFLIGHT_LIMITS.maxArrayLength)return fail('array-too-large');
   for(let i=0;i<node.length;i++){
    const value=node[i];const result=copyValue(value,depth+1);
    if(!result.ok)return result;
    target[i]=result.value;
    if(result.child)stack.push(result.child);
   }
  }else{
   if(Object.getPrototypeOf(node)!==Object.prototype)return fail('unsafe-object');
   const keys=Object.keys(node);
   if(keys.length>BRAIN_PREFLIGHT_LIMITS.maxObjectKeys)return fail('object-too-large');
   for(let i=0;i<keys.length;i++){
    const key=keys[i];
    if(key.length>BRAIN_PREFLIGHT_LIMITS.maxStringLength)return fail('string-too-large');
    if(badKeys.has(key))return fail('unsafe-key');
    const result=copyValue(node[key],depth+1);
    if(!result.ok)return result;
    target[key]=result.value;
    if(result.child)stack.push(result.child);
   }
  }
 }
 return {ok:true,tree:output,nodes};
 function copyValue(value,depth){
  if(++nodes>BRAIN_PREFLIGHT_LIMITS.maxNodes)return fail('too-many-nodes');
  if(depth>BRAIN_PREFLIGHT_LIMITS.maxDepth)return fail('max-depth');
  if(value===null||typeof value==='boolean')return {ok:true,value};
  if(typeof value==='string')return value.length<=BRAIN_PREFLIGHT_LIMITS.maxStringLength?
   {ok:true,value}:fail('string-too-large');
  if(typeof value==='number'){
   if(!Number.isFinite(value))return fail('nonfinite-number');
   if(Math.abs(value)>BRAIN_PREFLIGHT_LIMITS.maxAbsNumber)return fail('number-too-large');
   return {ok:true,value};
  }
  if(Array.isArray(value)){
   if(value.length>BRAIN_PREFLIGHT_LIMITS.maxArrayLength)return fail('array-too-large');
   const valueCopy=new Array(value.length);
   return {ok:true,value:valueCopy,child:{source:value,target:valueCopy,depth}};
  }
  if(value&&typeof value==='object'){
   const valueCopy=Object.create(null);
   return {ok:true,value:valueCopy,child:{source:value,target:valueCopy,depth}};
  }
  return fail('unsafe-value');
 }
}

/** Accept only JSON UTF-8 bytes or JSON string, enforce wire size BEFORE parse.
 * @returns {{ok:true,admission:'preflight-only',tree:object,bytes:number,nodes:number}|{ok:false,code:string}}
 */
export function preflightBrainJson(input){
 let bytes;
 try{
  if(typeof input==='string'){
   // UTF-8 length >= ASCII character count; bound length before encoding.
   if(input.length>BRAIN_PREFLIGHT_LIMITS.maxBytes)return fail('file-too-large');
   bytes=new TextEncoder().encode(input);
  }else if(ArrayBuffer.isView(input)&&Object.prototype.toString.call(input)==='[object Uint8Array]'){
   if(input.byteLength>BRAIN_PREFLIGHT_LIMITS.maxBytes)return fail('file-too-large');
   bytes=Uint8Array.from(input); // snapshot to prevent caller mutation
  }else return fail('invalid-input'); // cyclic objects, proxies and functions rejected
  if(bytes.byteLength>BRAIN_PREFLIGHT_LIMITS.maxBytes)return fail('file-too-large');
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  let parsed;
  try{parsed=JSON.parse(source);}catch{return fail('invalid-json');}
  const accepted=safeTree(parsed);
  return accepted.ok?{ok:true,admission:'preflight-only',tree:accepted.tree,
   bytes:bytes.length,nodes:accepted.nodes}:accepted;
 }catch{return fail('invalid-input');}
}
