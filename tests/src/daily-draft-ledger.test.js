import {SaveStore,sanitizeRun,verifyLedgerHash,DRAFT_LEDGER_HASH_V} from '../../src/systems/SaveStore.js';
import {DailyPatch} from '../../src/systems/DailyPatch.js';
import {countsForDraftDailyBest,countsForDailyBest,countsForStreak,
  isRankable,isModdedOnly,sameBoardAs} from '../../src/systems/Ranking.js';
import {DRAFT_BUDGET,DRAFT_RULES_VERSION} from '../../src/systems/DailyDraft.js';

const when=new Date(Date.UTC(2026,10,18,12));
const info=DailyPatch.getDailyInfo(when);
let serial=0;
function draft(over={}){
  serial++;
  const r={version:1,id:`draft-${serial}`,seed:info.seed,dailyRuleId:info.rule.id,
    biomeMask:info.biomeMask,startedAt:when.valueOf(),endedAt:when.valueOf()+5000,
    durationMs:5000,score:1000,distanceM:150,trickPoints:0,tricks:{},
    bestCombo:1,bestFlow:1,maxAirtimeMs:0,cause:'crash',
    hashV:4,dailyOfficial:true,modded:true,boosts:[],
    dailyMode:'draft',draftRulesVersion:DRAFT_RULES_VERSION,
    draftBudget:DRAFT_BUDGET,upgradeRanks:{canopy:3},
    initials:'MAR',ledgerHash:'',...over};
  r.ledgerHash=SaveStore.computeLedgerHash(r);
  return r;
}
function classic(over={}){
  serial++;
  const r={version:1,id:`classic-${serial}`,seed:info.seed,dailyRuleId:info.rule.id,
    biomeMask:info.biomeMask,startedAt:when.valueOf(),endedAt:when.valueOf()+5000,
    durationMs:5000,score:1400,distanceM:160,trickPoints:0,tricks:{},
    bestCombo:1,bestFlow:1,maxAirtimeMs:0,cause:'crash',
    hashV:2,dailyOfficial:true,modded:false,boosts:[],initials:'CAR',ledgerHash:'',...over};
  r.ledgerHash=SaveStore.computeLedgerHash(r);
  return r;
}

test('v4 Draft ledger signs every competition rule independently from old v2/v3',()=>{
  const r=draft();
  expect(DRAFT_LEDGER_HASH_V).toBe(4);
  expect(verifyLedgerHash(r)).toBe(true);
  const persisted=sanitizeRun(r);
  expect(verifyLedgerHash(persisted)).toBe(true);
  expect(persisted).toMatchObject({dailyMode:'draft',draftRulesVersion:2,
    draftBudget:1200,upgradeRanks:{canopy:3}});
  for(const [k,v] of Object.entries({
    dailyMode:'classic',draftRulesVersion:1,draftBudget:1250,
    upgradeRanks:{canopy:4},boosts:['headStart'],modded:false,
    score:777,dailyOfficial:false,seed:'daily-2030-01-01',
  })){
    expect(verifyLedgerHash({...r,[k]:v})).toBe(false);
  }
  expect(verifyLedgerHash({...r,initials:'XYZ'})).toBe(true);
});

test('Classic and Draft are separate ranked surfaces with independent day bests',async()=>{
  const store=new SaveStore();await store.init();
  const c=classic(),d=draft();
  await store.saveRun(c);await store.saveRun(d);
  expect(countsForDailyBest(c)).toBe(true);
  expect(countsForDraftDailyBest(c)).toBe(false);
  expect(countsForDraftDailyBest(d)).toBe(true);
  expect(countsForDailyBest(d)).toBe(false);
  expect(isRankable(d)).toBe(false);
  expect(isModdedOnly(d)).toBe(false);
  expect(countsForStreak(d)).toBe(true);
  expect(store.getDailyStats(when,{mode:'classic'}).bestScore).toBe(c.score);
  expect(store.getDailyStats(when,{mode:'draft'}).bestScore).toBe(d.score);
  expect((await store.getLeaderboard(10)).map(r=>r.id)).not.toContain(d.id);
  expect((await store.getModdedLeaderboard(10)).map(r=>r.id)).not.toContain(d.id);
  const draftBoard=await store.getDailyDraftLeaderboard(10,when);
  expect(draftBoard.map(r=>r.id)).toEqual([d.id]);
  expect(await store.qualifiesForDailyDraftTop10(1000,when)).toBe(true);
  expect(sameBoardAs(d)(d)).toBe(true);
  expect(sameBoardAs(d)(c)).toBe(false);
});

test('overbudget, wrong rules, purchased boosts, custom/practice seed cannot rank as Daily Draft',()=>{
  const overrides=[{upgradeRanks:{canopy:500}},{draftBudget:999},
    {draftRulesVersion:1},{boosts:['headStart']},{dailyOfficial:false},
    {seed:'test-plain'},{modded:false},{dailyMode:'classic'},
    {hashV:3},{biomeMask:info.biomeMask^1},{dailyRuleId:'fake-rule'}];
  for(const o of overrides){const r=draft(o);expect(countsForDraftDailyBest(r)).toBe(false);}
});

test('Draft becomes a separate streak-eligible day without double-counting both modes',async()=>{
  const store=new SaveStore();await store.init();
  await store.saveRun(draft());await store.saveRun(classic());
  const st=store.getDailyStreak(when);
  expect(st.streak).toBe(1);
  expect(st.playedToday).toBe(true);
});
