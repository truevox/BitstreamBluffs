import {armPrivateRunSceneStage,takePrivateRunSceneStage} from '../../src/systems/savestate/privateStageOwnership.js';

const fakeGame=()=>{
 const state={TitleScene:true,RunScene:false};
 return {scene:{isActive:key=>state[key]===true},state};
};
test('a private staging arm requires Title active and no existing RunScene',()=>{
 const g=fakeGame();
 g.state.TitleScene=false;expect(()=>armPrivateRunSceneStage(g)).toThrow('title-required');
 g.state.TitleScene=true;g.state.RunScene=true;
 expect(()=>armPrivateRunSceneStage(g)).toThrow('title-required');
 expect(()=>armPrivateRunSceneStage(null)).toThrow('invalid-game');
});
test('arm and take are one-shot without exposing tokens through scene data or the registry',async()=>{
 const g=fakeGame(),h=armPrivateRunSceneStage(g);
 expect(()=>armPrivateRunSceneStage(g)).toThrow('already-armed');
 const a=takePrivateRunSceneStage(g);
 expect(a).toBeTruthy();
 expect(takePrivateRunSceneStage(g)).toBeNull();
 const scene={simClock:{tick:0}};
 a.accept(scene);
 expect(await h.ready).toBe(scene);
 a.accept({simClock:{tick:999}});
 expect(await h.ready).toBe(scene);
 h.cancel();
});
test('a pending stage can be cancelled before creation without poisoning future runs',async()=>{
 const g=fakeGame(),h=armPrivateRunSceneStage(g);
 h.cancel();
 await expect(h.ready).rejects.toThrow('cancelled');
 expect(takePrivateRunSceneStage(g)).toBeNull();
 const later=armPrivateRunSceneStage(g);
 const a=takePrivateRunSceneStage(g);
 a.fail(Error('synthetic scene creation refused'));
 await expect(later.ready).rejects.toThrow('synthetic scene creation refused');
 expect(takePrivateRunSceneStage(g)).toBeNull();
});
test('taking an arm does not consume any future unrelated normal scene start',async()=>{
 const g=fakeGame();
 expect(takePrivateRunSceneStage(g)).toBeNull();
 const first=armPrivateRunSceneStage(g),taken=takePrivateRunSceneStage(g);
 const second=armPrivateRunSceneStage(g);
 const nextTaken=takePrivateRunSceneStage(g);
 expect(nextTaken).not.toBe(taken);
 taken.accept({kind:'first'});
 expect(takePrivateRunSceneStage(g)).toBeNull();
 // Cleanup independent already-consumed handles; a new normal start does not
 // inherit an armed staging capability.
 second.cancel();
 nextTaken.fail(Error('expected synthetic error'));
 await expect(first.ready).resolves.toEqual({kind:'first'});
 await expect(second.ready).rejects.toThrow('cancelled');
});
