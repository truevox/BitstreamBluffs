import {validateSectionBindings,indexSectionNodes} from '../../src/systems/savestate/sectionBindings.js';
const o=(id,fields)=>({__id:id,__c:null,__obj:fields});
const a=(id,items)=>({__id:id,__arr:items});
const m=(id,items)=>({__id:id,__map:items});
const ref=id=>({__alias:id});
function fixture(){
 const chunk=o(5,{index:1,hazards:a(6,[o(7,{defId:'spike',x:40,y:80}),o(8,{defId:'spike',x:41,y:81})]),
  powerups:a(9,[o(10,{defId:'clock',x:60,y:90})]),shards:a(11,[o(12,{id:'s1-0',x:2,y:4})])});
 const queued=o(13,{index:2,hazards:a(14,[]),powerups:a(15,[]),shards:a(16,[])});
 return {game:{
  runRandom:o(1,{}),terrain:o(2,{active:m(3,[[1,chunk],[2,queued]]),activeList:a(4,[ref(5),ref(13)])}),
  _chunkQueue:m(17,[[2,ref(13)]]),sled:o(18,{body:{__body:'sled'},random:ref(1)}),
  hazards:m(19,[[1,a(20,[o(21,{hid:'1:0',spawn:ref(7),def:{__content:'/hazards/spike'},body:{__body:'hazard:1:0'}})])]]),
  powerups:m(22,[[1,a(23,[o(24,{key:'1:0',spawn:ref(10),def:{__content:'/powerups/clock'},body:{__body:'powerup:1:0'}})])]]),
  shardField:o(25,{byChunk:m(26,[[1,a(27,[o(28,{id:'s1-0',x:2,y:4})])]])})
 },matter:{bodies:{sled:{},'hazard:1:0':{},'powerup:1:0':{},'terrain:1:0':{}}},meshOrder:[1]};
}
const hz=f=>f.game.hazards.__map[0][1].__arr[0].__obj;
const pu=f=>f.game.powerups.__map[0][1].__arr[0].__obj;
const shard=f=>f.game.shardField.__obj.byChunk.__map[0][1].__arr[0].__obj;
const validate=f=>validateSectionBindings(f.game,f.matter,f.meshOrder);
test('cross-section references bind to exact generated records and live body keys',()=>{
 const f=fixture();
 expect(validate(f)).toBe(true);
 expect(indexSectionNodes(f.game).size).toBe(28);
 shard(f).pulled=true;shard(f).x+=10;
 expect(validate(f)).toBe(true);
});
test.each([
 ['duplicate graph node',f=>f.game.sled.__id=1,'duplicate-node'],
 ['dangling spawn alias',f=>hz(f).spawn=ref(999),'dangling-alias'],
 ['same-type wrong hazard spawn',f=>hz(f).spawn=ref(8),'hazard-spawn'],
 ['wrong hazard definition',f=>hz(f).def.__content='/hazards/other','hazard-spawn'],
 ['foreign pickup spawn',f=>pu(f).spawn=ref(7),'pickup-spawn'],
 ['wrong pickup definition',f=>pu(f).def.__content='/powerups/other','pickup-spawn'],
 ['missing entity body',f=>delete f.matter.bodies['hazard:1:0'],'entity-body'],
 ['orphan body',f=>f.matter.bodies['hazard:1:99']={},'unbound-entity-body'],
 ['duplicate entity body',f=>pu(f).body.__body='hazard:1:0','entity-body'],
 ['wrong shared RNG',f=>f.game.sled.__obj.random=ref(5),'sled'],
 ['bad queued chunk alias',f=>f.game._chunkQueue.__map[0][1]=ref(5),'queue'],
 ['mesh contains queued chunk',f=>f.meshOrder.push(2),'queue'],
 ['foreign shard',f=>shard(f).id='s1-9','shard-spawn'],
 ['unpulled shard changed position',f=>shard(f).x+=1,'shard-spawn'],
])('rejects %s',(_n,mutate,code)=>{
 const f=fixture();mutate(f);
 expect(()=>validate(f)).toThrow('section-binding:'+code);
});
