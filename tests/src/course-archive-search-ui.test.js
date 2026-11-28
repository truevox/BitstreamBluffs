/** ShopView search state cannot silently delete an archive or share another course. */
import { jest } from '@jest/globals';
jest.unstable_mockModule('phaser',()=>({default:{Scene:class{},GameObjects:new Proxy({},{get:()=>class{}})}}));
jest.unstable_mockModule('../../src/data/index.js',()=>({content:{},loadContent:()=>({})}));
const {ShopView}=await import('../../src/ui/Views.js');
const {courseKey}=await import('../../src/systems/ghost/GhostTape.js');
const proto=ShopView.prototype;
const archive=(seed,biomeMask=0)=>({seed,biomeMask,key:courseKey(seed,biomeMask),favorites:[]});
function ctx(){
  return {alive:true,archivePage:true,archiveBusy:false,archiveQuery:'',archivePageIndex:3,
    archives:[archive('alpha',7),archive('beta',0)],archiveSelected:courseKey('alpha',7),
    _closeArchiveSearch:jest.fn(),_build:jest.fn()};
}

test('new query clears selection and resets paging, never calls delete',()=>{
  const c=ctx();const library={deleteArchiveCourse:jest.fn()};c._archiveLibrary=()=>library;
  proto._applyArchiveSearch.call(c,'   BETA   ');
  expect(c.archiveQuery).toBe('BETA');
  expect(c.archiveSelected).toBeNull();
  expect(c.archivePageIndex).toBe(0);
  expect(c._build).toHaveBeenCalledTimes(1);
  expect(library.deleteArchiveCourse).not.toHaveBeenCalled();
});

test('page navigation counts matching items and clears stale selected key',()=>{
  const c=ctx();c.archiveQuery='beta';
  proto._turnArchivePage.call(c,1);
  expect(c.archivePageIndex).toBe(0);
  expect(c.archiveSelected).toBeNull();
  expect(c._build).toHaveBeenCalled();
});

test('copy uses the exact stored seed and biome mask, without writing archive storage',async()=>{
  const c=ctx();const writeText=jest.fn(async()=>{});
  const prior=navigator.clipboard;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  try {
    await proto._copySelectedArchive.call(c);
    expect(writeText).toHaveBeenCalledWith('alpha@7');
    expect(c.archiveNotice).toMatch(/COPIED/);
    expect(c._build).toHaveBeenCalledTimes(1);
  } finally {Object.defineProperty(navigator,'clipboard',{configurable:true,value:prior});}
});

test('selection disappeared from current filter: copy is a no-op',async()=>{
  const c=ctx();c.archiveQuery='beta';
  await proto._copySelectedArchive.call(c);
  expect(c._build).not.toHaveBeenCalled();
});


test('search modal captures menu cancel/confirm without leaving the Shop',()=>{
  const ctx={archiveSearchBox:{getValue:jest.fn(()=> 'beta')},_closeArchiveSearch:jest.fn(),
    _applyArchiveSearch:jest.fn(),close:jest.fn()};
  expect(proto.handleAction.call(ctx,'cancel')).toBe(true);
  expect(ctx._closeArchiveSearch).toHaveBeenCalledTimes(1);
  expect(ctx.close).not.toHaveBeenCalled();
  expect(proto.handleAction.call(ctx,'confirm')).toBe(true);
  expect(ctx._applyArchiveSearch).toHaveBeenCalledWith('beta');
});
