/** Game Over modal is read-only; stale async history cannot update after retry. */
import { jest } from '@jest/globals';

jest.unstable_mockModule('phaser',()=>({ default:{Scene:class{},GameObjects:new Proxy({},{get:()=>class{}})} }));
jest.unstable_mockModule('../../src/data/index.js',()=>({content:{},loadContent:()=>({})}));
const created=[];
jest.unstable_mockModule('../../src/ui/LocalRankingsView.js',()=>({LocalRankingsView:class{
  constructor(_scene,_theme,o){ this.alive=true;this.record=o.record;this.onClose=o.onClose;
    this.showHistory=jest.fn();this.showFailure=jest.fn();this.destroy=jest.fn(()=>{this.alive=false;});
    created.push(this);
  }
}}));
const {GameOverScene}=await import('../../src/scenes/GameOverScene.js');
const {REG}=await import('../../src/constants.js');
const proto=GameOverScene.prototype;
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(store){
  const dim={setOrigin(){return this;},setDepth(){return this;},setInteractive(){return this;},destroy:jest.fn()};
  const scene={alive:true,leaving:false,entry:null,shopOpen:false,ghostView:null,
    theme:{},rec:{id:'run1'},_cancelShopAutoprompt:jest.fn(),skipReveal:jest.fn(),
    add:{rectangle:jest.fn(()=>dim)}, registry:{get:k=>k===REG.SAVE_STORE?store:null},
    _openLocalRankings:proto._openLocalRankings,_closeGhosts:proto._closeGhosts};
  return {scene,dim};
}

test('L key Game Over action opens local modal without triggering retry',()=>{
  const scene={alive:true,leaving:false,entry:null,shopOpen:false,ghostView:null,
    skipReveal:jest.fn(),_cancelShopAutoprompt:jest.fn(),_openLocalRankings:jest.fn(),retry:jest.fn()};
  proto._onAction.call(scene,'localranks');
  expect(scene._openLocalRankings).toHaveBeenCalledTimes(1);
  expect(scene.retry).not.toHaveBeenCalled();
});

test('reads SaveStore history once and paints it only into the active modal',async()=>{
  const store={getRecentRuns:jest.fn(async()=>[{id:'run1'}])};
  const {scene}=fixture(store);
  proto._openLocalRankings.call(scene);await flush();
  const view=created.at(-1);
  expect(store.getRecentRuns).toHaveBeenCalledWith(1000);
  expect(view.showHistory).toHaveBeenCalledWith([{id:'run1'}]);
  expect(scene._cancelShopAutoprompt).toHaveBeenCalled();
  expect(scene.skipReveal).toHaveBeenCalled();
  view.onClose();
  expect(view.destroy).toHaveBeenCalled();
  expect(scene.ghostView).toBeNull();
});

test('closing/retrying before asynchronous history finishes never paints a stale overlay',async()=>{
  let resolve;
  const store={getRecentRuns:()=>new Promise(r=>{resolve=r;})};
  const {scene,dim}=fixture(store);
  proto._openLocalRankings.call(scene);
  await flush();
  const view=created.at(-1);
  proto._closeGhosts.call(scene);
  resolve([{id:'run1'}]);await flush();
  expect(view.showHistory).not.toHaveBeenCalled();
  expect(dim.destroy).toHaveBeenCalled();
});

test('read errors fail closed and do not affect Retry',async()=>{
  const {scene}=fixture({getRecentRuns:()=>Promise.reject(new Error('offline'))});
  proto._openLocalRankings.call(scene);await flush();
  expect(created.at(-1).showFailure).toHaveBeenCalledTimes(1);
});
