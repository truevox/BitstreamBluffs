/** #84: local course search and sharing without creating unverified traits. */
import { searchArchiveCourses, normalizeArchiveSearch, MAX_ARCHIVE_QUERY_LENGTH } from '../../src/systems/ghost/CourseArchiveSearch.js';
import { courseKey } from '../../src/systems/ghost/GhostTape.js';
import { courseArchiveManagerLayout } from '../../src/ui/ShopLayout.js';
import { shareableSeed } from '../../src/ui/Format.js';

function entry(seed,biomeMask=0,favorites=[null,null,null]){
  return {seed,biomeMask,key:courseKey(seed,biomeMask),favorites,lastPlayedAt:1};
}
const alpha=entry('GAP-BASE',7),beta=entry('safe-RUN',0,['run-2',null,null]),gamma=entry('MAGIC-gap',15);

test('search by seed is case-insensitive and preserves original newest-first ordering',()=>{
  const archives=[alpha,beta,gamma];
  expect(searchArchiveCourses(archives,'  GaP  ')).toEqual([alpha,gamma]);
  expect(searchArchiveCourses(archives,'SAFE')).toEqual([beta]);
  expect(searchArchiveCourses(archives,'zZz')).toEqual([]);
  expect(searchArchiveCourses(archives)).toEqual(archives);
  expect(archives).toEqual([alpha,beta,gamma]);
});

test('search matching canonical biome-mask and actual saved favorites',()=>{
  expect(searchArchiveCourses([alpha,beta,gamma],'@7')).toEqual([alpha]);
  expect(searchArchiveCourses([alpha,beta,gamma],'@0')).toEqual([beta]);
  expect(searchArchiveCourses([alpha,beta,gamma],'@4294967296')).toEqual([]);
  expect(searchArchiveCourses([alpha,beta,gamma],'#fav')).toEqual([beta]);
  expect(searchArchiveCourses([alpha,beta,gamma],'#favorites')).toEqual([beta]);
  expect(searchArchiveCourses([alpha,beta,gamma],'danger')).toEqual([]);
  expect(shareableSeed(beta)).toBe('safe-RUN');
  expect(shareableSeed(alpha)).toBe('GAP-BASE@7');
});

test('never admits duplicate, corrupt or mismatched canonical course identities',()=>{
  const bad={...alpha,key:'OTHER|00000007'};
  const invalid={...alpha,biomeMask:-1};
  const exotic={...alpha,biomeMask:NaN};
  expect(searchArchiveCourses([bad,alpha,{...alpha},invalid,exotic,beta])).toEqual([alpha,beta]);
  expect(searchArchiveCourses(null)).toEqual([]);
  expect(normalizeArchiveSearch('  abc  ')).toBe('abc');
  expect(normalizeArchiveSearch('x'.repeat(900))).toHaveLength(MAX_ARCHIVE_QUERY_LENGTH);
  expect(normalizeArchiveSearch({query:'bad'})).toBe('');
});

test('filtered layout retains separate share and DELETE confirmation, no overflow',()=>{
  const all=Array.from({length:17},(_,i)=>entry(`seed-${i}`,i%3));
  const hits=searchArchiveCourses(all,'seed-1');
  const picked=hits[0];
  const out=courseArchiveManagerLayout({archives:hits,totalArchives:all.length,query:'seed-1',page:0,
    selected:picked.key,notice:'FILTER ACTIVE'});
  expect(out.rows.find(r=>r.key==='archiveHeader').label).toContain(`${hits.length}/${all.length}`);
  expect(out.rows.find(r=>r.kind==='archiveShare').archiveKey).toBe(picked.key);
  expect(out.rows.find(r=>r.kind==='archiveConfirm').archiveKey).toBe(picked.key);
  expect(out.rows.find(r=>r.kind==='archivePager').label).toContain('FIND SEED');
  const withoutSelection=courseArchiveManagerLayout({archives:hits,selected:null});
  expect(withoutSelection.rows.some(r=>r.kind==='archiveConfirm')).toBe(false);
  expect(withoutSelection.rows.some(r=>r.kind==='archiveShare')).toBe(false);
  expect(out.rows.at(-1).y+8).toBeLessThanOrEqual(out.h-22);
  for (let i=0;i<out.texts.length;i++)for (let j=i+1;j<out.texts.length;j++){
    const a=out.texts[i],b=out.texts[j];
    expect(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h).toBe(false);
  }
});
