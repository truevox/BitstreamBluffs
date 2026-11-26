/** #56 regression: migration must never trust an unavailable IDB inventory. */
import {defaultProfile} from '../../src/systems/Progression.js';
import {ProfileStore,PROFILE_KEY} from '../../src/systems/ProfileStore.js';
import {GhostLibrary} from '../../src/systems/ghost/GhostLibrary.js';
import {activateCourseArchiveLimit,archiveCapacity} from '../../src/systems/ghost/CourseArchiveCapacity.js';

const storage=()=>{
  const m=new Map();
  return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};
};

test('IDB outage cannot stamp a permanently false empty migration',()=>{
  const disk=storage(),store=new ProfileStore({storage:disk});
  store.load();
  const ghosts=new GhostLibrary(); // no successful IDB initialization
  const denied=activateCourseArchiveLimit(ghosts,store);
  expect(denied).toMatchObject({ok:false,reason:'archive-inventory-unavailable'});
  expect(store.archiveLegacyInitialized).toBe(false);
  expect(store.profile.courseArchive.migrated).toBe(false);
  expect(ghosts.archiveStatus().limit).toBeNull();
  expect(JSON.parse(disk.getItem(PROFILE_KEY)).courseArchive.migrated).toBe(false);
  // On a later successful IDB boot, its real 18 archives must be preserved.
  ghosts.backend='idb';
  for(let i=0;i<18;i++)ghosts.courses.set('old-'+i,{key:'old-'+i});
  expect(activateCourseArchiveLimit(ghosts,store).ok).toBe(true);
  expect(ghosts.archiveStatus().limit).toBe(18);
  expect(new ProfileStore({storage:disk}).load().courseArchive.included).toBe(18);
});

test('older already-migrated profile repairs undercount without double-counting purchased slots',()=>{
  const disk=storage(),old={...defaultProfile(),
    courseArchive:{v:1,included:8,purchased:2,migrated:true}};
  disk.setItem(PROFILE_KEY,JSON.stringify(old));
  const store=new ProfileStore({storage:disk});
  store.load();
  expect(store.archiveLegacyInitialized).toBe(true);
  expect(archiveCapacity(store.profile)).toBe(10);
  const fixed=store.ensureCourseArchiveLegacy(21);
  expect(fixed.ok).toBe(true);
  expect(fixed.profile.courseArchive).toMatchObject({included:19,purchased:2,migrated:true});
  expect(archiveCapacity(fixed.profile)).toBe(21);
  const reboot=new ProfileStore({storage:disk});
  reboot.load();
  expect(archiveCapacity(reboot.profile)).toBe(21);
  expect(reboot.ensureCourseArchiveLegacy(18).profile.courseArchive.included).toBe(19);
});

test('without persistent profile storage migration never claims success',()=>{
  const store=new ProfileStore({storage:null});
  store.load();
  expect(store.ensureCourseArchiveLegacy(24)).toMatchObject({ok:false,reason:'storage-unavailable'});
  expect(store.archiveLegacyInitialized).toBe(false);
  expect(store.profile.courseArchive.migrated).toBe(false);
});
