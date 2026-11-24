import { ACHIEVEMENTS, visibleAchievements, metricsFrom, newlyUnlocked } from '../../src/systems/Achievements.js';
import { achievementRows, achievementsLayout, pageCount } from '../../src/ui/AchievementsLayout.js';
import { ProfileStore, sanitizeProfile } from '../../src/systems/ProfileStore.js';
import { defaultProfile } from '../../src/systems/Progression.js';
import fs from 'node:fs';
const LEVELS=JSON.parse(fs.readFileSync('src/data/progression/levels.json','utf8'));

const mem=()=>{
  const data=new Map();
  return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v), data};
};

test('57 canonical achievements, including real score 100k/250k/500k/1m and Sync Level 30',()=>{
  expect(ACHIEVEMENTS).toHaveLength(57);
  const score=ACHIEVEMENTS.filter(a=>a.metric==='bestScore').map(a=>a.target);
  expect(score).toEqual([10000,50000,100000,250000,500000,1000000]);
  const sync=ACHIEVEMENTS.filter(a=>a.metric==='level').map(a=>a.target);
  expect(sync).toEqual([10,15,20,25,30]);
});

test('both BSOD achievements are invisible before real first Bluff',()=>{
  const p=defaultProfile();
  const ids=visibleAchievements(p).map(a=>a.id);
  expect(ids).not.toContain('bluff-the-bsod');
  expect(ids).not.toContain('surfing-the-void');
  expect(achievementRows(p).filter(r=>r.kind==='row').length).toBe(55);
  expect(achievementsLayout({profile:p}).pages).toBe(pageCount(achievementRows(p)));
});

test('first genuinely scored live Bluff reveals only its own achievement and a LOCKED Surfing',()=>{
  const storage=mem(), store=new ProfileStore({storage});store.load();
  const before=store.profile.bank;
  const first=store.recordBsodBluff(1,1000);
  expect(first.added.map(a=>a.id)).toEqual(['bluff-the-bsod']);
  expect(first.profile.bsodGym.owned).toBe(false);
  expect(first.profile.bank).toBe(before);
  const ids=visibleAchievements(first.profile).map(a=>a.id);
  expect(ids).toContain('bluff-the-bsod');
  expect(ids).toContain('surfing-the-void');
  const shown=Array.from({length:achievementsLayout({profile:first.profile}).pages},(_,page)=>
    achievementsLayout({profile:first.profile,page}).rows).flat();
  expect(shown.find(r=>r.id==='bluff-the-bsod').done).toBe(true);
  expect(shown.find(r=>r.id==='surfing-the-void').done).toBe(false);
  expect(store.recordBsodBluff(1,1500).added).toEqual([]);
});

test('second consecutive LIVE Bluff unlocks Surfing once, cannot unlock Gym, no bank mutation',()=>{
  const storage=mem(),s=new ProfileStore({storage});s.load();
  s.recordBsodBluff(1,1100);
  const second=s.recordBsodBluff(2,1900);
  expect(second.added.map(a=>a.id)).toEqual(['surfing-the-void']);
  expect(second.profile.achievements['surfing-the-void']).toBe(1900);
  expect(second.profile.lifetime.bsodSurfs).toBe(1);
  expect(second.profile.bsodGym.owned).toBe(false);
  expect(second.profile.bank).toBe(0);
  expect(s.recordBsodBluff(3,2100).added).toEqual([]);
  expect(sanitizeProfile(JSON.parse(storage.getItem('bb.profile'))).achievements['surfing-the-void']).toBe(1900);
});

test('invalid/synthetic events do not award secrets',()=>{
  const s=new ProfileStore({storage:mem()});s.load();
  for(const v of [0,-1,1.5,NaN,Infinity,'2'])expect(s.recordBsodBluff(v,100).added).toEqual([]);
  expect(s.recordBsodBluff(1,NaN).added).toEqual([]);
  expect(s.profile.lifetime.bsodBluffs).toBe(0);
});

test('existing profile that had discovered the Gym is grandfathered without creating fake Surfing mastery',()=>{
  const old=defaultProfile();old.bsodGym={discovered:true,owned:true};
  old.lifetime.nearMisses=4;old.lifetime.bsodBluffs=0;
  const p=sanitizeProfile(old);
  expect(p.achievements['bluff-the-bsod']).toBe(0);
  expect(p.achievements['surfing-the-void']).toBeUndefined();
  expect(visibleAchievements(p).some(a=>a.id==='surfing-the-void')).toBe(true);
});

test('score and level additions are independently unlockable from existing lifetime records',()=>{
  const p=defaultProfile();p.level=25;p.lifetime.bestScore=500001;
  const qualifying=newlyUnlocked(metricsFrom(p),p.achievements).map(a=>a.id);
  expect(qualifying).toEqual(expect.arrayContaining(['score-100k','score-250k','score-500k','level-15','level-25']));
  expect(qualifying).not.toContain('bluff-the-bsod');
  expect(qualifying).not.toContain('surfing-the-void');
});


test('existing level-11 pilot receives newly added earned milestones at load, just once',()=>{
  const storage=mem();
  const old=defaultProfile();old.xp=24500;old.level=11;
  old.lifetime.runs=65;old.lifetime.bestScore=275000;
  storage.setItem('bb.profile',JSON.stringify(old));
  const store=new ProfileStore({storage,levels:LEVELS});store.load();
  expect(store.profile.level).toBe(11);
  expect(store.profile.achievements['score-100k']).toBeGreaterThan(0);
  expect(store.profile.achievements['score-250k']).toBeGreaterThan(0);
  expect(store.profile.achievements['level-10']).toBeGreaterThan(0);
  expect(store.profile.achievements['bluff-the-bsod']).toBeUndefined();
  const stamp=store.profile.achievements['score-250k'];
  store.load();
  expect(store.profile.achievements['score-250k']).toBe(stamp);
});
