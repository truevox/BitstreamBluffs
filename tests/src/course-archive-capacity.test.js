/** #56: repeatable DISTINCT-course archives; no sixth ghost and no lost legacy tape. */
import {defaultProfile} from '../../src/systems/Progression.js';
import {ProfileStore, PROFILE_KEY, sanitizeProfile} from '../../src/systems/ProfileStore.js';
import {GhostLibrary,MAX_GHOSTS_PER_COURSE,courseGhostRuns} from '../../src/systems/ghost/GhostLibrary.js';
import {INCLUDED_COURSE_ARCHIVES,archiveCapacity,activateCourseArchiveLimit,grandfatherArchives,mayArchiveNewCourse,
  nextArchiveSlotPrice,purchaseArchiveSlot,sanitizeCourseArchive} from '../../src/systems/ghost/CourseArchiveCapacity.js';
import {upgradeShopLayout,courseArchiveManagerLayout} from '../../src/ui/ShopLayout.js';

const sample=(n,changes={})=>({runId:`archive-run-${n}`,seed:`seed-${n}`,biomeMask:7,
  mode:'normal',distanceM:10+n,endedAt:1000+n,simRevision:9,trace:'AAAA',inputs:[[1,0,0]],...changes});
const makeStorage=()=>{
  const map=new Map();let denied=false;
  return {getItem:k=>map.get(k)||null,setItem:(k,v)=>{if(denied)throw Error('quota');map.set(k,v)},
    deny:v=>{denied=v},raw:()=>map.get(PROFILE_KEY)};
};

test('archive slot economy is repeatable, strictly bounded and does not add a ghost role',()=>{
  expect(INCLUDED_COURSE_ARCHIVES).toBe(8);
  expect(archiveCapacity(defaultProfile())).toBe(8);
  expect(nextArchiveSlotPrice(0)).toBe(40);
  expect(nextArchiveSlotPrice(1)).toBeGreaterThan(40);
  expect(nextArchiveSlotPrice(5)).toBeGreaterThan(nextArchiveSlotPrice(4));
  for(const bad of [-1,1.2,Infinity,NaN,'0',1_000_001])expect(nextArchiveSlotPrice(bad)).toBeNull();
  expect(sanitizeCourseArchive({v:1,included:'999',purchased:-3})).toEqual({v:1,included:8,purchased:0,migrated:false});
  expect(mayArchiveNewCourse(7,8)).toBe(true);
  expect(mayArchiveNewCourse(8,8)).toBe(false);
  const p={...defaultProfile(),bank:1000,courseArchive:{...defaultProfile().courseArchive,migrated:true}};
  const next=purchaseArchiveSlot(p);
  expect(next).not.toBe(p);
  expect(next.bank).toBe(960);
  expect(archiveCapacity(next)).toBe(9);
  expect(p.courseArchive.purchased).toBe(0);
  expect(purchaseArchiveSlot({...p,bank:39})).toBeDefined();
  expect(purchaseArchiveSlot({...p,bank:39})).toEqual({...p,bank:39});
  expect(MAX_GHOSTS_PER_COURSE).toBe(5);
});

test('legacy migration preserves full existing inventory; one-time durable baseline survives reload',()=>{
  const storage=makeStorage(),store=new ProfileStore({storage});
  store.load();expect(store.archiveLegacyInitialized).toBe(false);
  const original=store.ensureCourseArchiveLegacy(19);
  expect(original.ok).toBe(true);
  expect(original.profile.courseArchive.migrated).toBe(true);
  expect(archiveCapacity(original.profile)).toBe(19);
  expect(store.ensureCourseArchiveLegacy(19).profile.courseArchive.included).toBe(19); // already covered
  expect(sanitizeProfile(JSON.parse(storage.raw()),null).courseArchive.included).toBe(19);
  const reboot=new ProfileStore({storage});reboot.load();
  expect(reboot.archiveLegacyInitialized).toBe(true);
  expect(archiveCapacity(reboot.profile)).toBe(19);
  expect(reboot.ensureCourseArchiveLegacy(18).profile.courseArchive.included).toBe(19);
});

test('write failure is never a charge or a migration success; no implicit purchases',()=>{
  const storage=makeStorage(),store=new ProfileStore({storage});store.load();
  storage.deny(true);
  const fail=store.ensureCourseArchiveLegacy(17);
  expect(fail.ok).toBe(false);
  expect(store.archiveLegacyInitialized).toBe(false);
  expect(store.profile.courseArchive.included).toBe(8);
  storage.deny(false);expect(store.ensureCourseArchiveLegacy(17).ok).toBe(true);
  store.save({...store.profile,bank:900});
  const old=JSON.stringify(store.profile),raw=storage.raw();
  storage.deny(true);
  expect(store.buyCourseArchiveSlot().ok).toBe(false);
  expect(JSON.stringify(store.profile)).toBe(old);
  expect(storage.raw()).toBe(raw);
  storage.deny(false);
  const tx=store.buyCourseArchiveSlot();
  expect(tx.ok).toBe(true);
  expect(tx.profile.bank).toBe(860);
  expect(archiveCapacity(tx.profile)).toBe(18);
  expect(new ProfileStore({storage}).load().courseArchive.purchased).toBe(1);
});

test('exactly eight distinct courses allowed; full refuses ninth without evicting pinned favorites',async()=>{
  const lib=new GhostLibrary();lib.setArchiveLimit(8);
  for(let i=0;i<8;i++)expect(await lib.saveRun(sample(i))).not.toBeNull();
  await lib.setFavorite('seed-0',7,0,'archive-run-0');
  const old=await lib.getTape('archive-run-0');
  expect(lib.archiveStatus()).toMatchObject({used:8,limit:8,full:true});
  expect(await lib.saveRun(sample(8))).toBeNull();
  expect(lib.lastArchiveFailure).toBe('full');
  expect(await lib.getTape('archive-run-0')).toEqual(old);
  expect(lib.course('seed-0',7).favorites[0]).toBe('archive-run-0');
  expect(await lib.saveRun(sample(9,{seed:'seed-0'}))).not.toBeNull();
  expect(lib.archiveStatus().used).toBe(8);
  expect(courseGhostRuns(lib.course('seed-0',7))).toHaveLength(2);
  lib.setArchiveLimit(9);
  expect(await lib.saveRun(sample(8))).not.toBeNull();
  expect(lib.archiveStatus()).toMatchObject({used:9,limit:9,full:true});
  expect((await lib.listArchiveCourses())).toHaveLength(9);
  expect(await lib.deleteArchiveCourse('seed-2|00000007')).toBe(true);
  expect(await lib.getTape('archive-run-2')).toBeNull();
  expect(lib.course('seed-0',7).favorites[0]).toBe('archive-run-0');
  expect(await lib.saveRun(sample(10))).not.toBeNull();
  expect(await lib.deleteArchiveCourse('seed-2|00000007')).toBe(false);
});

test('manager demands a separate explicit confirm row and page layout never overlaps',()=>{
  const archives=Array.from({length:17},(_,i)=>({key:`seed-${i}|00000007`,seed:`seed-${i}`,biomeMask:7,
    favorites:i===0?['A',null,null]:[null,null,null]}));
  const p={...defaultProfile(),bank:999};
  const upgrade=upgradeShopLayout({profile:p});
  expect(upgrade.rows.find(x=>x.kind==='archiveBuy')).toMatchObject({state:'40',disabled:false});
  expect(upgrade.rows.some(x=>x.kind==='archiveLink')).toBe(true);
  const pages=[0,1,2].map(page=>courseArchiveManagerLayout({profile:p,archives,page}));
  expect(pages.map(x=>x.page)).toEqual([0,1,2]);
  expect(pages[0].rows.filter(r=>r.kind==='archiveEntry')).toHaveLength(7);
  expect(pages[0].rows.some(r=>r.kind==='archiveConfirm')).toBe(false);
  const selected=courseArchiveManagerLayout({profile:p,archives,selected:archives[0].key});
  expect(selected.rows.find(r=>r.kind==='archiveConfirm').archiveKey).toBe(archives[0].key);
  for(const layout of [upgrade,...pages,selected]){
    expect(layout.rows.at(-1).y+8).toBeLessThanOrEqual(layout.h-22);
    const overlaps=[];
    for(let i=0;i<layout.texts.length;i++)for(let j=i+1;j<layout.texts.length;j++){
      const a=layout.texts[i],b=layout.texts[j];
      if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h)overlaps.push([a.key,b.key]);
    }
    expect(overlaps).toEqual([]);
  }
});
