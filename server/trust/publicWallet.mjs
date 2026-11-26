import {createHash,createPublicKey,verify} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonicalBytes,parseCanonical} from '../../src/systems/replay/canonicalJson.js';
import {UPGRADE_IDS,nextUpgradePrice} from '../../src/systems/PermanentUpgrades.js';
import {KODIAK_VERSION} from '../../src/systems/Kodiaks.js';

const id=v=>typeof v==='string'&&/^[\w.\-:@/]{1,120}$/.test(v);
const int=v=>Number.isSafeInteger(v)&&v>=0;
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const keys=(x,ks)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===ks.length&&ks.every(k=>Object.hasOwn(x,k));
const deny=reason=>({ok:false,reason});
const read=bytes=>{
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>65536)throw Error('bounded canonical bytes required');
 return parseCanonical(Uint8Array.from(bytes));
};
const text=x=>Buffer.from(canonicalBytes(x)).toString('utf8');

// Shared database with admission. No browser import, no balance import,
// no public endpoints. Reward authority is an independent trusted process.
export function initWallet(db){
 db.exec(`
 CREATE TABLE IF NOT EXISTS public_wallet(account TEXT PRIMARY KEY,balance INTEGER NOT NULL CHECK(balance>=0)) STRICT;
 CREATE TABLE IF NOT EXISTS public_ranks(account TEXT NOT NULL,upgrade TEXT NOT NULL,rank INTEGER NOT NULL CHECK(rank>0),PRIMARY KEY(account,upgrade)) STRICT;
 CREATE TABLE IF NOT EXISTS public_rewards(run TEXT PRIMARY KEY REFERENCES admissions(run),account TEXT NOT NULL,claim TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>=0),receipt TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS public_purchases(account TEXT NOT NULL,operation TEXT NOT NULL,upgrade TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(account,operation)) STRICT;
 CREATE TABLE IF NOT EXISTS public_equipment(challenge TEXT PRIMARY KEY REFERENCES challenges(id),account TEXT NOT NULL,loadout TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
 `);
}
const balance=(db,account)=>db.prepare('SELECT balance FROM public_wallet WHERE account=?').get(account)?.balance??0;
const ranks=(db,account)=>Object.fromEntries(db.prepare('SELECT upgrade,rank FROM public_ranks WHERE account=? ORDER BY upgrade').all(account).map(r=>[r.upgrade,r.rank]));
const setBalance=(db,account,n)=>db.prepare('INSERT INTO public_wallet VALUES (?,?) ON CONFLICT(account) DO UPDATE SET balance=excluded.balance').run(account,n);
const transaction=(db,fn)=>{
 db.exec('BEGIN IMMEDIATE');
 try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}
};

// For now only ordinary stock/modded runs with fixed level 1 and no boost.
// The full effective modifier projection is pinned, not just purchased ranks.
export function equipmentProjection(causal){
 return {upgradeRanks:causal.loadout.upgradeRanks,boosts:causal.loadout.boosts,magnetsDrop:causal.loadout.magnetsDrop,
  kodiak:causal.kodiak,syncLevel:causal.bsod.syncLevel,dailyRuleId:causal.course.dailyRuleId,dailyRuleSource:causal.course.dailyRuleSource};
}
export function equipmentDigest(loadout){return hash(canonicalBytes(loadout));}
export function checkEquipment(db,account,course,loadoutBytes){
 let l;try{l=read(loadoutBytes);}catch{return deny('malformed-loadout');}
 if(!keys(l,['upgradeRanks','boosts','magnetsDrop','kodiak','syncLevel','dailyRuleId','dailyRuleSource'])||
    !l.upgradeRanks||typeof l.upgradeRanks!=='object'||Array.isArray(l.upgradeRanks)||
    !Array.isArray(l.boosts)||l.boosts.length!==0||l.magnetsDrop!==false||l.syncLevel!==1||
    !keys(l.kodiak,['enabled','packMode','version'])||l.kodiak.enabled!==false||
    !['same','mixed'].includes(l.kodiak.packMode)||l.kodiak.version!==KODIAK_VERSION||
    typeof l.dailyRuleId!=='string'||!l.dailyRuleId||!['seed-date','clock-at-start'].includes(l.dailyRuleSource))
   return deny('unsupported-modifiers');
 const owned=ranks(db,account);
 for(const [k,v] of Object.entries(l.upgradeRanks))
  if(!UPGRADE_IDS.includes(k)||!int(v)||v===0||v>(owned[k]??0))return deny('unowned-upgrade');
 const lane=Object.keys(l.upgradeRanks).length?'modded':'stock';
 if(course.lane!==lane||course.loadoutDigest!==equipmentDigest(l))return deny('loadout-mismatch');
 return {ok:true,loadout:l,digest:course.loadoutDigest};
}
export function persistEquipment(db,challenge,account,checked){
 db.prepare('INSERT INTO public_equipment VALUES (?,?,?,?)').run(challenge,account,text(checked.loadout),checked.digest);
}
export function readEquipment(db,challenge,account){
 const row=db.prepare('SELECT loadout,digest FROM public_equipment WHERE challenge=? AND account=?').get(challenge,account);
 return row?{loadout:parseCanonical(row.loadout),digest:row.digest}:null;
}

export function openPublicWallet({databasePath,rewardPublicKey,allowUnboundTestClaims=false}){
 const key=rewardPublicKey?.type==='public'?rewardPublicKey:createPublicKey(rewardPublicKey);
 if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 reward key required');
 const db=new DatabaseSync(databasePath);
 db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
 initWallet(db);
 function purchase(account,bytes){
  if(!id(account))return deny('account-required');
  let r;try{r=read(bytes);}catch{return deny('malformed-purchase');}
  if(!keys(r,['operationId','upgradeId'])||!id(r.operationId)||!UPGRADE_IDS.includes(r.upgradeId))return deny('malformed-purchase');
  return transaction(db,()=>{
   const prior=db.prepare('SELECT upgrade,result FROM public_purchases WHERE account=? AND operation=?').get(account,r.operationId);
   if(prior)return prior.upgrade===r.upgradeId?{...parseCanonical(prior.result)}:deny('operation-conflict');
   const old=ranks(db,account)[r.upgradeId]??0,b=balance(db,account),price=nextUpgradePrice(r.upgradeId,old);
   let result;
   if(price===null||!int(old+1)||b<price)result=deny('insufficient-shards');
   else{
    setBalance(db,account,b-price);
    db.prepare('INSERT INTO public_ranks VALUES (?,?,?) ON CONFLICT(account,upgrade) DO UPDATE SET rank=excluded.rank').run(account,r.upgradeId,old+1);
    result={ok:true,rank:old+1,price,balance:b-price};
   }
   db.prepare('INSERT INTO public_purchases VALUES (?,?,?,?)').run(account,r.operationId,r.upgradeId,text(result));
   return result;
  });
 }
 function settle(account,bytes){
  if(!id(account))return deny('account-required');
  let r;try{r=read(bytes);}catch{return deny('malformed-settlement');}
  const b=r?.body;
  if(!keys(r,['body','signature'])||!keys(b,['format','version','account','runId','claimDigest','shards'])||
     b.format!=='bb-public-shard-settlement'||b.version!==1||b.account!==account||!id(b.runId)||
     typeof b.claimDigest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(b.claimDigest)||!int(b.shards)||
     typeof r.signature!=='string'||! /^[A-Za-z0-9_-]{86}$/.test(r.signature))return deny('malformed-settlement');
  const sig=Buffer.from(r.signature,'base64url');
  if(sig.length!==64||sig.toString('base64url')!==r.signature||!verify(null,canonicalBytes(b),key,sig))return deny('unauthenticated-settlement');
  return transaction(db,()=>{
   const a=db.prepare('SELECT account,claim FROM admissions WHERE run=?').get(b.runId);
   if(!a||a.account!==account||a.claim!==b.claimDigest)return deny('admission-required');
   if(!allowUnboundTestClaims&&!db.prepare('SELECT 1 FROM admissions a JOIN public_equipment e ON e.challenge=a.challenge AND e.account=a.account WHERE a.run=? AND a.evidence_digest IS NOT NULL').get(b.runId))return deny('equipment-not-pinned');
   const previous=db.prepare('SELECT receipt FROM public_rewards WHERE run=?').get(b.runId);
   const receipt=hash(canonicalBytes(r));
   if(previous)return deny(previous.receipt===receipt?'already-settled':'settlement-conflict');
   const next=balance(db,account)+b.shards;
   if(!int(next))return deny('balance-overflow');
   setBalance(db,account,next);
   db.prepare('INSERT INTO public_rewards VALUES (?,?,?,?,?)').run(b.runId,account,b.claimDigest,b.shards,receipt);
   return {ok:true,balance:next};
  });
 }
 return Object.freeze({purchase,settle,snapshot:account=>{if(!id(account))throw Error('invalid account');return transaction(db,()=>({balance:balance(db,account),ranks:ranks(db,account)}));},close:()=>db.close()});
}
