/**
 * #69 Ghost-in-a-Link v1: offline-only, deliberately untrusted, URL-fragment
 * transport. Call encode ONLY from an explicit user share action; decode ONLY
 * after an explicit import action. Never apply to ledger, wallet or rankings.
 * This module does no network I/O, clipboard writes or persistent storage.
 */
import {GHOST_TAPE_FORMAT,GHOST_TAPE_VERSION,GHOST_PHYSICS_VERSION} from './GhostTape.js';
import {SIM_TICK_HZ} from '../SimClock.js';
import {SIM_REVISION} from '../replay/ruleset.js';
import {RUN_RANDOM_VERSION,RUN_STREAMS} from '../RunRandom.js';
import {KODIAK_VERSION} from '../Kodiaks.js';

export const GHOST_LINK_FORMAT='bb-ghost-link';
export const GHOST_LINK_VERSION=1;
export const GHOST_LINK_PARAMETER='bbghost';
// 1,900 chars is a conservative messaging-app/QR-friendly recommendation.
// Modern desktop/mobile browsers accept larger hash-only URLs; 8,192 is a
// bounded opt-in direct-share fallback until an owner-approved host exists.
export const GHOST_LINK_RECOMMENDED_URL=1900;
export const GHOST_LINK_MAX_URL=8192;
export const GHOST_LINK_MAX_GZIP=20000;
export const GHOST_LINK_MAX_JSON=96000;
/** Explicit local download, not an automatic cloud-hosting path. */
export const GHOST_FILE_NAME='bitstream-ghost.bbghost';
export const GHOST_FILE_HEADER='BBGHOST1\n';
export const GHOST_FILE_MAX_BYTES=GHOST_FILE_HEADER.length+24+1+GHOST_LINK_MAX_GZIP;
const MAX_TICKS=120*600,MAX_CHANGES=30000,MAX_CHECKPOINTS=600,MAX_TRACE_CHARS=85000;
const TAPE_FIELDS=[
 'format','version','physicsVersion','simTickHz','runRandomVersion','edgeRows',
 'seed','biomeMask','simRevision','mode','dailyRuleId','dailyRuleSource',
 'syncLevel','bsod','controlLayout','boosts','upgradeRanks','magnetsDrop',
 'kodiaksOn','kodiakPackMode','kodiakVersion','startPose','random',
 'distanceM','score','cause','endTick','inputs','checkpoints','trace',
];

export class GhostLinkError extends Error {
 constructor(code,message=code){super(message);this.name='GhostLinkError';this.code=code;}
}
const reject=(code,message)=>{throw new GhostLinkError(code,message);};
const uint=(x,max)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
const finite=(x)=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e10;
const plain=(x)=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const seedOkay=s=>typeof s==='string'&&s.length>0&&s.length<=128&&!/[\u0000-\u001f\u007f]/u.test(s);
const textOkay=s=>typeof s==='string'&&s.length<=128&&!/[\u0000-\u001f\u007f<>]/u.test(s);

/** Exact-compatible, bounded replay input. Fail CLOSED, not a verifier. */
function validate(t){
 if(!plain(t)||t.format!==GHOST_TAPE_FORMAT||t.version!==GHOST_TAPE_VERSION||
   t.physicsVersion!==GHOST_PHYSICS_VERSION||t.simTickHz!==SIM_TICK_HZ||
   t.edgeRows!=='every-tick')reject('unsupported-tape','Unsupported ghost input format');
 if(t.simRevision!==SIM_REVISION||t.runRandomVersion!==RUN_RANDOM_VERSION||
   (t.kodiaksOn===true&&t.kodiakVersion!==KODIAK_VERSION))reject('unsupported-ruleset','This ghost needs another simulation ruleset');
 if(!seedOkay(t.seed)||!uint(t.biomeMask,2047))reject('invalid-course','Invalid course seed or biome mask');
 if(!['normal','daily','daily-draft'].includes(t.mode)||!textOkay(t.dailyRuleId||'')||
   !textOkay(t.dailyRuleSource||'')||!['tricksRight','tricksLeft','classic'].includes(t.controlLayout))reject('invalid-mode');
 if(!uint(t.syncLevel,100000)||!Array.isArray(t.startPose)||t.startPose.length!==6||
   !t.startPose.every(finite)||!plain(t.random)||!plain(t.bsod)||
   t.random.version!==RUN_RANDOM_VERSION||
   !Object.keys(RUN_STREAMS).every(k=>uint(t.random[k],0xffffffff))||
   !finite(t.bsod.leftEdgeX)||!plain(t.bsod.initial)||
   !finite(t.bsod.initial.wallX)||!finite(t.bsod.initial.wallSpeedPxS)||
   !finite(t.bsod.initial.accelerationPxS2))reject('invalid-initial-state');
 if(!uint(t.endTick,MAX_TICKS)||!t.endTick||!finite(t.distanceM)||t.distanceM<0||
   !finite(t.score)||t.score<0||!textOkay(t.cause||''))reject('invalid-outcome');
 if(!Array.isArray(t.inputs)||t.inputs.length>MAX_CHANGES||!Array.isArray(t.checkpoints)||
   t.checkpoints.length>MAX_CHECKPOINTS)reject('invalid-size','Too many input changes or checkpoints');
 let tick=0;
 for(const row of t.inputs){
  if(!Array.isArray(row)||row.length!==3||!uint(row[0],MAX_TICKS)||row[0]===0||
    !uint(row[1],0xffffffff)||!Number.isInteger(row[2])||Math.abs(row[2])>127)reject('invalid-input');
  tick+=row[0];if(tick>t.endTick)reject('invalid-input');
 }
 let prev=0;
 for(const row of t.checkpoints){
  if(!Array.isArray(row)||row.length!==8||!uint(row[0],t.endTick)||row[0]<=prev||
    !row.slice(1).every(finite))reject('invalid-checkpoint');
  prev=row[0];
 }
 if(typeof t.trace!=='string'||t.trace.length>MAX_TRACE_CHARS||
   !/^(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(t.trace))reject('invalid-trace');
 const decoded=atob(t.trace);
 if(decoded.length%12!==0||decoded.length<12)reject('invalid-trace');
 const dv=new DataView(new ArrayBuffer(decoded.length));
 for(let i=0;i<decoded.length;i++)dv.setUint8(i,decoded.charCodeAt(i));
 for(let i=0;i<decoded.length/4;i++)if(!Number.isFinite(dv.getFloat32(i*4,true)))reject('invalid-trace');
 if(decoded.length/12 > Math.ceil(t.endTick/4)+1)reject('invalid-trace');
 if(!Array.isArray(t.boosts)||t.boosts.length>32||!t.boosts.every(x=>typeof x==='string'&&textOkay(x))||
   !(t.upgradeRanks===null||plain(t.upgradeRanks))||typeof t.magnetsDrop!=='boolean'||
   typeof t.kodiaksOn!=='boolean'||!['same','mixed'].includes(t.kodiakPackMode))reject('invalid-loadout');
 if(JSON.stringify(t).length>GHOST_LINK_MAX_JSON)reject('oversize','Ghost input is too large');
 return t;
}

function selected(tape){
 const t={};for(const k of TAPE_FIELDS)if(Object.prototype.hasOwnProperty.call(tape,k))t[k]=tape[k];
 validate(t);
 // Exact allowlist, including nested runtime state. Do not accidentally include
 // extensions such as player identifiers, future tokens, or private annotations.
 t.random={version:t.random.version};
 for(const key of Object.keys(RUN_STREAMS))t.random[key]=tape.random[key];
 t.bsod={leftEdgeX:t.bsod.leftEdgeX,initial:{
  wallX:t.bsod.initial.wallX,wallSpeedPxS:t.bsod.initial.wallSpeedPxS,
  accelerationPxS2:t.bsod.initial.accelerationPxS2,
 }};
 // Kodiak ruleset version is causally relevant only when bears are enabled.
 // Never transport arbitrary unchecked nested data from an inactive field.
 if(!t.kodiaksOn)delete t.kodiakVersion;
 if(t.upgradeRanks!==null){
  const ranks=Object.create(null), entries=Object.entries(t.upgradeRanks);
  if(entries.length>60)reject('invalid-loadout');
  for(const [key,val] of entries){
   if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(key)||
     ['__proto__','constructor','prototype'].includes(key)||!uint(val,1000))reject('invalid-loadout');
   ranks[key]=val;
  }
  t.upgradeRanks=ranks;
 }
 return t;
}
function base64url(bytes){
 let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function fromUrl64(s){
 if(typeof s!=='string'||!s||! /^(?:[A-Za-z0-9_-]{2,})$/.test(s))reject('bad-encoding');
 try{const b=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));
  return Uint8Array.from(b,ch=>ch.charCodeAt(0));
 }catch{reject('bad-encoding');}
}
async function digest(bytes){
 if(!globalThis.crypto?.subtle)reject('unsupported-browser','WebCrypto SHA-256 is required');
 const b=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(b)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function source(bytes){return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});}
async function collect(reader,max){
 const chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;
  size+=value.byteLength;if(size>max){await reader.cancel();reject('oversize','Expanded ghost payload exceeds maximum');}
  chunks.push(value);
 }
 const all=new Uint8Array(size);let o=0;for(const c of chunks){all.set(c,o);o+=c.length;}return all;
 }finally{try{reader.releaseLock();}catch{}}
}
async function gzip(bytes){
 if(typeof CompressionStream!=='function'||typeof ReadableStream!=='function')reject('unsupported-browser','gzip support required');
 const stream=source(bytes).pipeThrough(new CompressionStream('gzip'));
 return collect(stream.getReader(),GHOST_LINK_MAX_GZIP);
}
async function ungzip(bytes){
 if(typeof DecompressionStream!=='function'||typeof ReadableStream!=='function')reject('unsupported-browser','gzip support required');
 try{return await collect(source(bytes).pipeThrough(new DecompressionStream('gzip')).getReader(),GHOST_LINK_MAX_JSON);}
 catch(e){if(e instanceof GhostLinkError)throw e;reject('bad-gzip','Cannot decompress ghost data');}
}

/** Both transports carry exactly the same allowlisted, bounded payload.
 * The SHA-256 prefix catches corruption; it DOES NOT authenticate the sender. */
async function encodePackage(tape){
 if(!plain(tape))reject('invalid-tape');
 const payload={format:GHOST_LINK_FORMAT,version:GHOST_LINK_VERSION,tape:selected(tape)};
 const raw=new TextEncoder().encode(JSON.stringify(payload));if(raw.length>GHOST_LINK_MAX_JSON)reject('oversize');
 const zipped=await gzip(raw);if(!zipped.length||zipped.length>GHOST_LINK_MAX_GZIP)reject('oversize');
 return {zipped,checksum:(await digest(zipped)).slice(0,24)};
}
async function decodePackage(zipped,checksum,sourceName,corruptionCode){
 if(!(zipped instanceof Uint8Array)||!zipped.length||zipped.length>GHOST_LINK_MAX_GZIP)reject('oversize');
 const check=(await digest(zipped)).slice(0,24);
 if(check!==checksum)reject(corruptionCode,'Compressed replay checksum mismatch');
 const raw=await ungzip(zipped);
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{reject('invalid-json');}
 if(!plain(body)||body.format!==GHOST_LINK_FORMAT||body.version!==GHOST_LINK_VERSION||!plain(body.tape))reject('unsupported-link');
 const t=selected(body.tape);
 // The original run ID/timestamps and any publisher claims NEVER survive.
 return {trust:'unverified-local-practice',source:sourceName,
  digest:check,tape:{...t,runId:`shared:${check}`,startedAt:0,endedAt:0},
  canCreditScore:false,canCreditWallet:false,canSubmitOfficial:false};
}

/** Explicit export. A URL fragment is local to the browser until someone shares it. */
export async function createGhostLink(tape,baseUrl,{maxLength=GHOST_LINK_MAX_URL}={}){
 const {zipped,checksum}=await encodePackage(tape);
 const encoded=`${GHOST_LINK_VERSION}.${checksum}.${base64url(zipped)}`;
 let target;try{target=new URL(baseUrl);}catch{reject('invalid-url');}
 if(target.username||target.password||!(['https:','http:'].includes(target.protocol))||
   (target.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(target.hostname)))reject('invalid-url');
 target.username='';target.password='';target.search='';target.hash=`${GHOST_LINK_PARAMETER}=${encoded}`;
 if(target.href.length>Math.min(GHOST_LINK_MAX_URL,maxLength))reject('url-too-long','Ghost exceeds portable link length; no automatic hosting or upload');
 return target.href;
}

/** Parse as untrusted local practice; NEVER directly save/import or confer a wallet/replay verdict. */
export async function parseGhostLink(url,{maxLength=GHOST_LINK_MAX_URL}={}){
 let target;try{target=new URL(url);}catch{reject('invalid-url');}
 if(target.href.length>Math.min(GHOST_LINK_MAX_URL,maxLength)||
   target.hash.length>GHOST_LINK_MAX_URL)reject('url-too-long');
 if(target.username||target.password||!(['https:','http:'].includes(target.protocol))||
    (target.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(target.hostname)))reject('invalid-url');
 const fragment=target.hash.slice(1),prefix=`${GHOST_LINK_PARAMETER}=`;
 if(!fragment.startsWith(prefix)||fragment.indexOf('&')>=0)reject('invalid-fragment');
 const match=/^1\.([a-f0-9]{24})\.([A-Za-z0-9_-]+)$/.exec(fragment.slice(prefix.length));
 if(!match)reject('unsupported-link','Malformed or future ghost-link version');
 const zipped=fromUrl64(match[2]);if(zipped.length>GHOST_LINK_MAX_GZIP)reject('oversize');
 return decodePackage(zipped,match[1],'user-pasted-url-fragment','corrupt-link');
}

/** This file is ONLY prepared by the sender's explicit SHARE action. The
 * filename intentionally contains no seed, score, name or player identity. */
export async function createGhostFile(tape){
 const {zipped,checksum}=await encodePackage(tape);
 const header=new TextEncoder().encode(`${GHOST_FILE_HEADER}${checksum}\n`);
 const bytes=new Uint8Array(header.length+zipped.length);
 bytes.set(header);bytes.set(zipped,header.length);
 if(bytes.length>GHOST_FILE_MAX_BYTES)reject('oversize');
 return {filename:GHOST_FILE_NAME,bytes,digest:checksum};
}

/** Explicit native file-picker input, never URL/file-system/network fetch.
 * All trust, stripping, version and size rules are shared with URL previews. */
export async function parseGhostFile(bytes){
 if(!ArrayBuffer.isView(bytes)||Object.prototype.toString.call(bytes)!=='[object Uint8Array]'||
    bytes.byteLength>GHOST_FILE_MAX_BYTES||bytes.byteLength<GHOST_FILE_HEADER.length+24+2)
  reject('invalid-file','Not a supported bounded .bbghost file');
 const head=new TextEncoder().encode(GHOST_FILE_HEADER);
 for(let i=0;i<head.length;i++)if(bytes[i]!==head[i])reject('unsupported-file','Unsupported ghost file format/version');
 const offset=head.length;
 const checksum=String.fromCharCode(...bytes.subarray(offset,offset+24));
 if(!/^[0-9a-f]{24}$/.test(checksum)||bytes[offset+24]!==10)reject('invalid-file','Invalid ghost file header');
 const zipped=bytes.subarray(offset+25);
 if(!zipped.length||zipped.length>GHOST_LINK_MAX_GZIP)reject('oversize');
 return decodePackage(zipped,checksum,'user-chosen-local-file','corrupt-file');
}
