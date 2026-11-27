/**
 * #135 opt-in transport boundary. NO listener, deployment, account provider,
 * public leaderboard, issuer, or settlement is included.
 *
 * The embedding HTTPS/TLS service MUST supply verifyBearer(), and (to issue
 * challenges or publish) trusted policy callbacks. Never use this from the
 * game/browser bundle, never authenticate from a client accountId, and never
 * trust client consent, rank, verifier votes or paid-verifier flags.
 */
import {parseCanonical,canonicalBytes} from '../../src/systems/replay/canonicalJson.js';

const CONTENT_TYPE='application/vnd.bsb.v1+cjson';
const ACCOUNT=/^[\w.\-:@/]{1,120}$/;
const MAX_BODY=2*1024*1024;
const b64=v=>Buffer.from(v).toString('base64url');
const fail=(reason)=>({ok:false,reason});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>plain(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const identifier=x=>typeof x==='string'&&ACCOUNT.test(x);
const opaqueBytes=(v,limit)=>{
 if(typeof v!=='string'||v.length===0||v.length>Math.ceil(limit*4/3)+4||
    !/^[A-Za-z0-9_-]+$/.test(v)||v.length%4===1)return null;
 const bytes=Buffer.from(v,'base64url');
 return bytes.length>0&&bytes.length<=limit&&bytes.toString('base64url')===v?Uint8Array.from(bytes):null;
};
const accountFrom=v=>exact(v,['verified','accountId'])&&v.verified===true&&identifier(v.accountId)?v.accountId:null;

function json(res,status,payload,origin=null){
 res.statusCode=status;
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
 res.end(JSON.stringify(payload));
}
async function boundedBody(req,maxBytes){
 const advertised=req.headers['content-length'];
 if(advertised!==undefined&&(!/^\d+$/.test(advertised)||Number(advertised)>maxBytes))
  throw Error('request-too-large');
 let size=0;const chunks=[];
 for await(const chunk of req){
  size+=chunk.length;
  if(size>maxBytes){req.resume();throw Error('request-too-large');}
  chunks.push(chunk);
 }
 if(size<2)throw Error('malformed-request');
 try{return parseCanonical(Buffer.concat(chunks,size));}
 catch{throw Error('malformed-request');}
}
function incomingBearer(req){
 // Node can join duplicate Authorization headers differently across versions.
 // Reject duplicates explicitly, before consulting an identity provider.
 const n=req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()==='authorization').length;
 const header=req.headers.authorization;
 if(n!==1||typeof header!=='string')return null;
 const match=/^Bearer ([A-Za-z0-9._~+\/-]{1,4096}={0,2})$/.exec(header);
 return match?match[1]:null;
}
/**
 * Factory returns a Node (req,res) handler. Caller owns creating an HTTP
 * server and must not expose one until HTTPS/auth/account-policy is real.
 * @param {{
 * peers: ReturnType<import('./blindPeerCoordinator.mjs').openBlindPeerCoordinator>,
 * provisional: ReturnType<import('./provisional.mjs').openProvisionalLedger>,
 * verifyBearer:(token:string)=>Promise<{verified:true,accountId:string}>,
 * issueTrustedChallenge?:(context:{accountId:string,kind:'human'|'tas'})=>Promise<object>,
 * authorizePublication?:(context:{accountId:string,requestBytes:Uint8Array})=>Promise<object>,
 * allowedOrigins?:string[], maxBodyBytes?:number, maxRequestsPerMinute?:number, clock?:()=>number
 * }} o
 */
export function createPrivateVerificationHttpHandler({
 peers,provisional,verifyBearer,issueTrustedChallenge,authorizePublication,
 allowedOrigins=[],maxBodyBytes=MAX_BODY,maxRequestsPerMinute=60,clock=Date.now
}){
 if(!peers||typeof peers.begin!=='function'||typeof peers.claimForAutomaticPeer!=='function'||
    !provisional||typeof provisional.submit!=='function'||typeof verifyBearer!=='function'||
    (issueTrustedChallenge!==undefined&&typeof issueTrustedChallenge!=='function')||
    (authorizePublication!==undefined&&typeof authorizePublication!=='function')||
    !Array.isArray(allowedOrigins)||allowedOrigins.length>12||
    !allowedOrigins.every(x=>typeof x==='string'&&
      (/^https:\/\/[^/\s]+$/.test(x)||/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(x)))||
    !Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<32768||maxBodyBytes>MAX_BODY||
    !Number.isSafeInteger(maxRequestsPerMinute)||maxRequestsPerMinute<1||maxRequestsPerMinute>600||
    typeof clock!=='function')throw Error('invalid private verification transport configuration');
 const origins=new Set(allowedOrigins),slots=new Map();
 function limited(account){
  const now=clock();
  if(!Number.isSafeInteger(now)||now<0)throw Error('invalid clock');
  let slot=slots.get(account);
  if(!slot||now-slot.start>=60000){
   // Bound even the rate-limiter's private memory. A real distributed
   // gateway still needs its own account and IP abuse controls.
   if(slots.size>=4096){
    for(const [k,v] of slots)if(now-v.start>=60000)slots.delete(k);
    if(slots.size>=4096)return true;
   }
   slot={start:now,hits:0};slots.set(account,slot);
  }
  slot.hits++;
  return slot.hits>maxRequestsPerMinute;
 }
 return async function privateVerificationRequest(req,res){
  if(res.headersSent)return;
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  const origin=req.headers.origin;
  const permitted=typeof origin==='string'&&origins.has(origin)?origin:null;
  if(origin!==undefined&&!permitted){json(res,403,fail('origin-not-allowed'));return;}
  if(req.method==='OPTIONS'&&permitted){
   res.statusCode=204;
   res.setHeader('Access-Control-Allow-Origin',permitted);
   res.setHeader('Vary','Origin');
   res.setHeader('Access-Control-Allow-Methods','POST');
   res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
   res.setHeader('Access-Control-Max-Age','300');
   res.end();return;
  }
  const routes=new Set(['/v1/private/challenge','/v1/private/begin','/v1/private/local',
   '/v1/private/peer/claim','/v1/private/peer/complete','/v1/private/status',
   '/v1/private/publish']);
  if(!routes.has(req.url)){json(res,404,fail('not-found'),permitted);return;}
  if(req.method!=='POST'){json(res,405,fail('method-not-allowed'),permitted);return;}
  if(req.headers['content-encoding']!==undefined){json(res,415,fail('unsupported-encoding'),permitted);return;}
  const token=incomingBearer(req);
  if(!token){json(res,401,fail('authentication-required'),permitted);return;}
  let account;
  try{account=accountFrom(await verifyBearer(token));}catch{account=null;}
  if(!account){json(res,401,fail('authentication-required'),permitted);return;}
  if(limited(account)){json(res,429,fail('rate-limited'),permitted);return;}
  if(req.headers['content-type']!==CONTENT_TYPE){
   json(res,415,fail('canonical-content-type-required'),permitted);return;
  }
  let body;
  try{body=await boundedBody(req,maxBodyBytes);}
  catch(e){json(res,e.message==='request-too-large'?413:400,
    fail(e.message==='request-too-large'?'request-too-large':'malformed-request'),permitted);return;}
  let result;
  try{
   switch(req.url){
    case '/v1/private/challenge':{
     if(!exact(body,['kind'])||!['human','tas'].includes(body.kind)){result=fail('malformed-request');break;}
     if(!issueTrustedChallenge){result=fail('trusted-challenge-service-unavailable');break;}
     const issued=await issueTrustedChallenge({accountId:account,kind:body.kind});
     // Whitelist returned fields: never relay private policy/callback data.
     if(!issued||issued.ok!==true||!identifier(issued.challengeId)) {
      result=fail('trusted-challenge-service-unavailable');break;
     }
     result={ok:true,challengeId:issued.challengeId,kind:body.kind};break;
    }
    case '/v1/private/begin':{
     if(!exact(body,['board','challengeId','evidenceB64','optedIn'])||
        !['human','tas'].includes(body.board)||body.optedIn!==true||
        !identifier(body.challengeId)){result=fail('malformed-request');break;}
     const evidence=opaqueBytes(body.evidenceB64,maxBodyBytes);
     result=evidence?peers.begin(account,body.challengeId,evidence,
      {board:body.board,optedIn:true}):fail('malformed-evidence');break;
    }
    case '/v1/private/local':{
     if(!exact(body,['submissionId','reportB64'])||!identifier(body.submissionId)){
      result=fail('malformed-request');break;
     }
     const report=opaqueBytes(body.reportB64,32768);
     result=report?peers.completeLocal(account,body.submissionId,report):
      fail('malformed-report');break;
    }
    case '/v1/private/peer/claim':
     result=exact(body,['deviceReady'])&&body.deviceReady===true?
      peers.claimForAutomaticPeer(account,{deviceReady:true}):fail('not-ready');break;
    case '/v1/private/peer/complete':{
     if(!exact(body,['assignmentId','leaseToken','reportB64'])||
        !identifier(body.assignmentId)){result=fail('malformed-request');break;}
     const report=opaqueBytes(body.reportB64,32768);
     result=report?peers.completePeer(account,body.assignmentId,body.leaseToken,report):
      fail('malformed-report');break;
    }
    case '/v1/private/status':
     result=exact(body,['submissionId'])&&identifier(body.submissionId)?
      peers.ownStatus(account,body.submissionId):fail('malformed-request');break;
    case '/v1/private/publish':{
     if(!exact(body,['requestB64'])){result=fail('malformed-request');break;}
     const requestBytes=opaqueBytes(body.requestB64,256*1024);
     if(!requestBytes){result=fail('malformed-request');break;}
     if(!authorizePublication){result=fail('trusted-publication-policy-unavailable');break;}
     const authorization=await authorizePublication({accountId:account,requestBytes});
     // Client-provided consent/audience booleans are not accepted anywhere.
     if(!exact(authorization,['consentAuthorized','audienceAllowed'])||
        authorization.consentAuthorized!==true||authorization.audienceAllowed!==true){
      result=fail('consent-or-audience-required');break;
     }
     result=provisional.submit(account,requestBytes,
      {consentAuthorized:true,audienceAllowed:true});break;
    }
   }
  }catch{json(res,503,fail('trusted-service-unavailable'),permitted);return;}
  if(result?.ok===true&&result.job){
   const j=result.job;
   result={ok:true,job:{id:j.id,kind:j.kind,board:j.board,leaseToken:j.leaseToken,
    rulesetId:j.rulesetId,verifierBuildId:j.verifierBuildId,expiresAt:j.expiresAt,
    evidenceB64:b64(j.evidence)}};
  }
  json(res,result?.ok===true?200:400,result??fail('not-available'),permitted);
 };
}

export const PRIVATE_VERIFICATION_CONTENT_TYPE=CONTENT_TYPE;
