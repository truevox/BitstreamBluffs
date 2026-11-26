/** #135: two independent server-only reference ledgers must never silently
 * treat a provisional run as verified or local wallet money as authority.
 * NO public endpoint, issuer or ranked promotion is established by this test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonicalBytes} from '../../src/systems/replay/canonicalJson.js';
import {PublicChallengeLedger} from '../../server/trust/PublicChallengeLedger.mjs';
import {openAdmissionLedger} from '../../server/trust/admission.mjs';

const hash=x=>'sha256:'+x.repeat(64);
const roles=['simulation','authorization','consent'];

test('provisional account challenge cannot be promoted by signed admission alone',()=>{
  const db=new DatabaseSync(':memory:');
  const keys=Object.fromEntries(roles.map(role=>[role,generateKeyPairSync('ed25519')]));
  const issuers=roles.map(role=>({role,keyId:role+'-1',publicKey:keys[role].publicKey}));
  const signed=openAdmissionLedger({databasePath:':memory:',issuers,clock:()=>1000000,challengeTtlMs:1000});
  try {
    const publicLedger=new PublicChallengeLedger({db,now:()=>1000000,stockLoadoutDigest:hash('a')});
    publicLedger.createAuthenticatedAccount('alice');
    const ch=publicLedger.issueServerChallenge('alice',{seed:'course-seven',biomeMask:7,
      lane:'stock',buildId:'bb-build-test',rulesetId:hash('c')});
    const request={format:'bb-dual-proof',version:1,runId:'run-100',
      buildId:ch.buildId,rulesetId:ch.rulesetId,manifestDigest:hash('d'),
      tapeDigest:hash('e'),seed:ch.seed,biomeMask:ch.biomeMask,lane:ch.lane,
      score:170,endTick:600,loadoutDigest:ch.loadoutDigest,
      assistance:'human',intent:'provisional-public',challengeId:ch.challengeId};
    const accepted=publicLedger.submitProvisional('alice',request,{
      consentAuthorized:true,audienceAllowed:true});
    assert.equal(accepted.status,'UNVERIFIED');
    assert.equal(accepted.verifiedRankEligible,false);
    assert.equal(accepted.publicRewardEligible,false);
    const published=publicLedger.publicSubmission(accepted.submissionId);
    assert.equal(published.status,'UNVERIFIED');
    assert.equal(published.verifiedRankEligible,false);
    assert.equal(published.publicRewardEligible,false);
    assert.equal(JSON.stringify(published).includes('alice'),false);
    assert.equal(JSON.stringify(published).includes('tapeDigest'),false);
    // A provisional entry is not a final signed verifier claim, even if an
    // attacker fills each receipt slot with a plausible-looking object.
    const unsigned={request,receipts:{
      simulation:{},authorization:{},consent:{}}};
    const denied=signed.admit('alice',canonicalBytes(unsigned));
    assert.equal(denied.admitted,false);
    assert.equal(denied.reason,'invalid-request');
    assert.equal(publicLedger.serverBalance('alice'),0);
    assert.equal(publicLedger.publicSubmission(accepted.submissionId).status,'UNVERIFIED');

    // Client editing its local balance cannot mint server equipment or a
    // verified receipt; a new challenge must use a server-owned purchase.
    const forged={...request,bank:1_000_000_000,verified:true};
    assert.throws(()=>publicLedger.submitProvisional('alice',forged,{
      consentAuthorized:true,audienceAllowed:true}),e=>
        e.code==='unverified-admission-refused');
    assert.equal(signed.admit('alice',canonicalBytes({...unsigned,request:forged})).admitted,false);
    assert.equal(publicLedger.serverBalance('alice'),0);
  } finally {
    signed.close();
    db.close();
  }
});
