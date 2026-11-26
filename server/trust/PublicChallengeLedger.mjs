/**
 * #135 SERVER-SIDE ONLY: durable admission ledger for provisional public runs.
 * NO HTTP route, account authentication, replay execution, provider payouts,
 * verifier keys, player JS or ranked publication is installed by this module.
 *
 * A caller MUST be an authenticated server adapter. Never expose these class
 * methods to the browser or let a client supply authenticated account IDs,
 * server challenge specs, credits, catalogue prices or consent/audience facts.
 * An unverified public entry is NOT trusted score eligibility, and there is
 * intentionally NO method to promote a result to Verified / award rewards.
 *
 * Real payouts require a separately audited authoritative replay verifier,
 * receipt/entitlement issuer and free/paid peer parity under #135.
 */
import {randomBytes} from 'node:crypto';
import {canonicalBytes,parseCanonical} from '../../src/systems/replay/canonicalJson.js';
import {adjudicateDualProof} from '../../src/systems/trust/dualProof.js';

const HASH=/^sha256:[a-f0-9]{64}$/;
const ID=/^[a-zA-Z0-9_.:-]{1,96}$/;
const isId=x=>typeof x==='string'&&ID.test(x);
const isDigest=x=>typeof x==='string'&&HASH.test(x);
const safeNum=x=>Number.isSafeInteger(x)&&x>=0&&x<=Number.MAX_SAFE_INTEGER;
const USER_VISIBLE=Object.freeze({status:'UNVERIFIED',verifiedRankEligible:false,publicRewardEligible:false});
const fail=(code)=>{const err=new Error(code);err.code=code;throw err;};
const deadlineMs=15*60*1000;

export class PublicChallengeLedger {
  /**
   * @param {{db:import('node:sqlite').DatabaseSync, now?:()=>number,
   *  rng?:(n:number)=>Uint8Array, stockLoadoutDigest:string,
   *  catalogue?:Record<string,{price:number,loadoutDigest:string}>}} opts
   */
  constructor({db,now=Date.now,rng=randomBytes,stockLoadoutDigest,catalogue={}}){
    if(!db?.exec||!db?.prepare||typeof now!=='function'||typeof rng!=='function'||!isDigest(stockLoadoutDigest))
      fail('invalid-server-configuration');
    const entries=Object.entries(catalogue);
    if(entries.length>200||entries.some(([k,v])=>!isId(k)||!v||!safeNum(v.price)||v.price<1||!isDigest(v.loadoutDigest)))
      fail('invalid-catalogue');
    this.db=db;this.now=now;this.rng=rng;this.stockLoadoutDigest=stockLoadoutDigest;
    this.catalogue=new Map(entries.map(([id,v])=>[id,Object.freeze({...v})]));
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS public_accounts (
        account_id TEXT PRIMARY KEY, server_shards INTEGER NOT NULL DEFAULT 0 CHECK(server_shards>=0));
      CREATE TABLE IF NOT EXISTS public_credit_grants (
        grant_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES public_accounts(account_id),
        amount INTEGER NOT NULL CHECK(amount>0), grant_time INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS public_equipment_receipts (
        receipt_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES public_accounts(account_id),
        sku TEXT NOT NULL, loadout_digest TEXT NOT NULL, paid_shards INTEGER NOT NULL CHECK(paid_shards>0),
        issued_time INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS public_challenges (
        challenge_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES public_accounts(account_id),
        issued_time INTEGER NOT NULL, expires_time INTEGER NOT NULL,
        seed TEXT NOT NULL, biome_mask INTEGER NOT NULL, lane TEXT NOT NULL,
        build_id TEXT NOT NULL, ruleset_id TEXT NOT NULL, loadout_digest TEXT NOT NULL,
        entitlement_receipt_id TEXT REFERENCES public_equipment_receipts(receipt_id),
        consumed_submission_id TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS public_submissions (
        submission_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES public_accounts(account_id),
        challenge_id TEXT NOT NULL UNIQUE REFERENCES public_challenges(challenge_id),
        received_time INTEGER NOT NULL, canonical_request TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK(status='UNVERIFIED'),
        verified_rank_eligible INTEGER NOT NULL DEFAULT 0 CHECK(verified_rank_eligible=0),
        public_reward_eligible INTEGER NOT NULL DEFAULT 0 CHECK(public_reward_eligible=0));`);
  }
  _now(){const n=this.now();if(!safeNum(n))fail('invalid-server-clock');return n;}
  _token(){const b=this.rng(24);if(!(b instanceof Uint8Array)||b.length!==24)fail('invalid-server-randomness');
    const t=Buffer.from(b).toString('hex');if(/^0+$/.test(t))fail('invalid-server-randomness');return 'ch_'+t;}
  _tx(fn){
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=fn();this.db.exec('COMMIT');return result;}
    catch(e){try{this.db.exec('ROLLBACK');}catch{/* already aborted */}throw e;}
  }
  _account(accountId){if(!isId(accountId))fail('invalid-authenticated-account');
    const a=this.db.prepare('SELECT account_id,server_shards FROM public_accounts WHERE account_id=?').get(accountId);
    if(!a)fail('authenticated-account-missing');return a;}
  /** Trusted account-creation adapter ONLY; NEVER auto-create from a client claim. */
  createAuthenticatedAccount(accountId){
    if(!isId(accountId))fail('invalid-authenticated-account');
    return this._tx(()=>{
      const r=this.db.prepare('INSERT OR IGNORE INTO public_accounts(account_id,server_shards) VALUES(?,0)').run(accountId);
      if(r.changes!==1)fail('account-already-exists');return Object.freeze({accountId,serverShards:0});
    });
  }
  /**
   * Trusted server settlement/award adapter ONLY, never from localStorage,
   * claimed hours, wallet JSON, or merely paying a verification fee.
   * `grantId` is an independently authenticated unique settlement identifier.
   */
  creditFromTrustedIssuer(accountId,grantId,amount){
    if(!isId(grantId)||!safeNum(amount)||amount<1||amount>100_000_000)fail('invalid-server-grant');
    return this._tx(()=>{
      const a=this._account(accountId);
      if(!safeNum(a.server_shards+amount))fail('balance-overflow');
      if(this.db.prepare('SELECT 1 FROM public_credit_grants WHERE grant_id=?').get(grantId))fail('grant-replayed');
      this.db.prepare('INSERT INTO public_credit_grants(grant_id,account_id,amount,grant_time) VALUES(?,?,?,?)')
        .run(grantId,accountId,amount,this._now());
      this.db.prepare('UPDATE public_accounts SET server_shards=server_shards+? WHERE account_id=?').run(amount,accountId);
      return Object.freeze({accountId,serverShards:a.server_shards+amount});
    });
  }
  /** Trusted server purchase; price/loadout come ONLY from the catalogue. */
  purchaseServerEquipment(accountId,sku,receiptId){
    if(!isId(receiptId)||!this.catalogue.has(sku))fail('unknown-server-equipment');
    return this._tx(()=>{
      const item=this.catalogue.get(sku),a=this._account(accountId);
      if(this.db.prepare('SELECT 1 FROM public_equipment_receipts WHERE receipt_id=?').get(receiptId))fail('receipt-replayed');
      if(a.server_shards<item.price)fail('insufficient-server-shards');
      const result=this.db.prepare('UPDATE public_accounts SET server_shards=server_shards-? WHERE account_id=? AND server_shards>=?')
        .run(item.price,accountId,item.price);
      if(result.changes!==1)fail('purchase-conflict');
      this.db.prepare('INSERT INTO public_equipment_receipts(receipt_id,account_id,sku,loadout_digest,paid_shards,issued_time) VALUES(?,?,?,?,?,?)')
        .run(receiptId,accountId,sku,item.loadoutDigest,item.price,this._now());
      return Object.freeze({receiptId,accountId,sku,loadoutDigest:item.loadoutDigest,price:item.price});
    });
  }
  /**
   * Trusted server-issued race spec: never accept a claimed client loadout or
   * bank. Upgraded lane MUST have a receipt owned by THIS account. Stock
   * lane is frozen to the server-side stock digest regardless of local gear.
   */
  issueServerChallenge(accountId,{seed,biomeMask,lane,buildId,rulesetId,entitlementReceiptId=null}){
    if(typeof seed!=='string'||!seed||seed.length>120||/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(seed)||
       !Number.isSafeInteger(biomeMask)||biomeMask<0||biomeMask>0xffffffff||
       !['stock','modded'].includes(lane)||!isId(buildId)||!isDigest(rulesetId))fail('invalid-server-course');
    return this._tx(()=>{
      this._account(accountId);let loadoutDigest=this.stockLoadoutDigest;
      if(lane==='modded'){
        if(!isId(entitlementReceiptId))fail('server-entitlement-required');
        const receipt=this.db.prepare('SELECT account_id,loadout_digest FROM public_equipment_receipts WHERE receipt_id=?').get(entitlementReceiptId);
        if(!receipt||receipt.account_id!==accountId)fail('server-entitlement-required');
        loadoutDigest=receipt.loadout_digest;
      }else if(entitlementReceiptId!==null)fail('stock-cannot-use-purchased-gear');
      const issued=this._now(),challengeId=this._token(),expires=issued+deadlineMs;
      if(!safeNum(expires))fail('invalid-expiry');
      this.db.prepare('INSERT INTO public_challenges(challenge_id,account_id,issued_time,expires_time,seed,biome_mask,lane,build_id,ruleset_id,loadout_digest,entitlement_receipt_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(challengeId,accountId,issued,expires,seed,biomeMask,lane,buildId,rulesetId,loadoutDigest,entitlementReceiptId);
      return Object.freeze({challengeId,seed,biomeMask,lane,buildId,rulesetId,loadoutDigest,issuedAtMs:issued,expiresAtMs:expires});
    });
  }
  /**
   * Immediate, NON-RANKED, explicit opt-in provisional submission. The
   * adapter must independently authenticate account/consent/audience first.
   * Client may submit only the strict dual-proof V1 request (no local wallet
   * or `verified:true`), and must match a fresh unspent SERVER challenge.
   */
  submitProvisional(accountId,request,{consentAuthorized=false,audienceAllowed=false}={}){
    if(!consentAuthorized||!audienceAllowed)fail('public-consent-or-audience-missing');
    let copied,serialized;
    try{serialized=canonicalBytes(request);if(serialized.length>256*1024)fail('oversized-submission');copied=parseCanonical(serialized);}
    catch {fail('malformed-client-request');}
    if(!copied||typeof copied!=='object'||Array.isArray(copied)||
       copied.intent!=='provisional-public'||copied.assistance!=='human'||!isId(copied.challengeId))
      fail('not-provisional-human-submission');
    // Privacy receipt is created in trusted server context AFTER consent is
    // authenticated, bound to this exact copy; not lifted from client JSON.
    const consent={kind:'trusted-consent-receipt',status:'granted',runId:copied.runId,
      manifestDigest:copied.manifestDigest,tapeDigest:copied.tapeDigest,score:copied.score,
      endTick:copied.endTick,seed:copied.seed,biomeMask:copied.biomeMask,lane:copied.lane,
      loadoutDigest:copied.loadoutDigest,intent:copied.intent,scope:'score-and-evidence',audienceGate:'passed'};
    const verdict=adjudicateDualProof({request:copied,simulation:null,authorization:null,consent,allowProvisional:true});
    if(verdict.publication!=='provisional-unverified'||verdict.verifiedRankEligible||verdict.publicRewardEligible)
      fail('unverified-admission-refused');
    return this._tx(()=>{
      this._account(accountId);
      const c=this.db.prepare('SELECT * FROM public_challenges WHERE challenge_id=?').get(copied.challengeId);
      if(!c||c.account_id!==accountId)fail('challenge-account-mismatch');
      const now=this._now();
      if(now>c.expires_time||now<c.issued_time)fail('challenge-expired');
      if(c.consumed_submission_id!==null)fail('challenge-already-consumed');
      for(const [key,field] of [['seed','seed'],['biomeMask','biome_mask'],['lane','lane'],
        ['buildId','build_id'],['rulesetId','ruleset_id'],['loadoutDigest','loadout_digest']])
        if(copied[key]!==c[field])fail('challenge-course-mismatch');
      const submissionId='sub_'+Buffer.from(this.rng(24)).toString('hex');
      if(!isId(submissionId)||submissionId==='sub_'+('00'.repeat(24)))fail('invalid-server-randomness');
      this.db.prepare('INSERT INTO public_submissions(submission_id,account_id,challenge_id,received_time,canonical_request) VALUES(?,?,?,?,?)')
        .run(submissionId,accountId,copied.challengeId,now,Buffer.from(serialized).toString('utf8'));
      const updated=this.db.prepare('UPDATE public_challenges SET consumed_submission_id=? WHERE challenge_id=? AND consumed_submission_id IS NULL').run(submissionId,copied.challengeId);
      if(updated.changes!==1)fail('challenge-already-consumed');
      return Object.freeze({submissionId,...USER_VISIBLE,receivedAtMs:now});
    });
  }
  /** A PUBLIC safe projection; no account IDs, peer identities, or raw tape. */
  publicSubmission(submissionId){
    if(!isId(submissionId))return null;
    const row=this.db.prepare('SELECT submission_id,status,received_time,canonical_request FROM public_submissions WHERE submission_id=?').get(submissionId);
    if(!row)return null;
    const request=JSON.parse(row.canonical_request);
    return Object.freeze({submissionId:row.submission_id,status:row.status,
      score:request.score,seed:request.seed,biomeMask:request.biomeMask,lane:request.lane,
      receivedAtMs:row.received_time,verifiedRankEligible:false,publicRewardEligible:false});
  }
  /** Read-only trusted adapter introspection; never expose as public JSON. */
  serverBalance(accountId){return this._account(accountId).server_shards;}
}
