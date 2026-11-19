import fs from 'node:fs';
import {DRAFT_BUDGET,DRAFT_RULES_VERSION,draftCost,changeDraftRank,
 validDraftRanks,sanitizeDraftRanks,draftActiveRanks,DRAFT_UPGRADES} from '../../src/systems/DailyDraft.js';
import {emptyUpgradeRanks,nextUpgradePrice} from '../../src/systems/PermanentUpgrades.js';
import {ProfileStore,sanitizeProfile} from '../../src/systems/ProfileStore.js';
import {defaultProfile} from '../../src/systems/Progression.js';
const LEVELS=JSON.parse(fs.readFileSync('src/data/progression/levels.json','utf8'));
const mem=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),map};};

test('the budget and rules version are immutable fixed competitive constants',()=>{
 expect(DRAFT_BUDGET).toBe(1200);expect(DRAFT_RULES_VERSION).toBe(1);
 expect(DRAFT_UPGRADES).toHaveLength(7);
});

test('the Draft budget uses the same cumulative per-rank prices as the upgrade shop',()=>{
 const r=emptyUpgradeRanks();r.canopy=3;r.speed=2;
 expect(draftCost(r)).toBe(
  [0,1,2].reduce((t,k)=>t+nextUpgradePrice('canopy',k),0)+
  [0,1].reduce((t,k)=>t+nextUpgradePrice('speed',k),0));
});

test('1,200 credits can buy canopy recovery rank 12, cannot exceed the fixed budget',()=>{
 const r=emptyUpgradeRanks();r.canopy=12;
 expect(draftCost(r)).toBeLessThanOrEqual(1200);
 expect(validDraftRanks(r)).toBe(true);
 for(let i=0;i<200;i++){
  const next=changeDraftRank(r,'canopy',1);
  if(next.ok)r.canopy++;
  else{expect(next.reason).toBe('over-budget');break;}
 }
 expect(draftCost(r)).toBeLessThanOrEqual(1200);
 expect(validDraftRanks({...r,unknown:10})).toBe(false);
 expect(validDraftRanks({...r,speed:'5'})).toBe(false);
});

test('saving/resetting Draft never spends shard bank or changes owned upgrades',()=>{
 const storage=mem();const s=new ProfileStore({storage,levels:LEVELS});s.load();
 const profile={...s.profile,bank:9999,upgrades:{...s.profile.upgrades,speed:14},upgradesEnabled:true};
 s.save(profile);
 const ranks={...emptyUpgradeRanks(),canopy:12};
 const saved=s.setDailyDraftRanks(ranks);
 expect(saved.ok).toBe(true);
 expect(s.profile.bank).toBe(9999);
 expect(s.profile.upgrades.speed).toBe(14);
 expect(s.profile.dailyDraft.ranks.canopy).toBe(12);
 expect(s.setDailyDraftRanks(emptyUpgradeRanks()).ok).toBe(true);
 expect(s.profile.dailyDraft.ranks.canopy).toBe(0);
 expect(s.profile.bank).toBe(9999);
 expect(sanitizeProfile(JSON.parse(storage.getItem('bb.profile')),LEVELS).dailyDraft.ranks.canopy).toBe(0);
});

test('tampered/over-budget preset fails closed on save and clamps on load',()=>{
 const storage=mem();const s=new ProfileStore({storage,levels:LEVELS});s.load();
 const old=s.profile;
 expect(s.setDailyDraftRanks({...emptyUpgradeRanks(),canopy:50000}).ok).toBe(false);
 expect(s.profile).toBe(old);
 const adversarial=defaultProfile();adversarial.dailyDraft={version:1,ranks:{speed:10**7,canopy:10**7,unknown:5}};
 const clean=sanitizeProfile(adversarial,LEVELS).dailyDraft.ranks;
 expect(validDraftRanks(clean)).toBe(true);
 expect(draftCost(clean)).toBeLessThanOrEqual(DRAFT_BUDGET);
 expect(draftActiveRanks(clean).unknown).toBeUndefined();
 const oldVersion=sanitizeProfile({...adversarial,dailyDraft:{version:99,ranks:{speed:20}}},LEVELS);
 expect(oldVersion.dailyDraft.ranks.speed).toBe(0);
});
