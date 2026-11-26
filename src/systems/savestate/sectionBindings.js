/** #119 integration checks for trusted internal reconstruction projections.
 * Not an external admission boundary: the remaining scene graph is still
 * diagnostic. Explicitly bind generated terrain, entity and body identities
 * before the candidate world is touched.
 */
const need=(v,p)=>{if(!v)throw Error('section-binding:'+p);};
const uint=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const own=(o,k)=>o!=null&&Object.hasOwn(o,k);
const obj=n=>n?.__obj;
const arr=n=>n?.__arr;
/** Exact node ID uniqueness and no dangling aliases across all section roots. */
export function indexSectionNodes(game){
 const nodes=new Map(),aliases=[],pending=[game],seen=new Set();let budget=1000000;
 while(pending.length){
  const n=pending.pop();
  if(!n||typeof n!=='object')continue;
  need(--budget>0&&!seen.has(n),'graph-size-or-identity');seen.add(n);
  if(own(n,'__id')){
   need(uint(n.__id)&&n.__id<1000000&&!nodes.has(n.__id),'duplicate-node');
   nodes.set(n.__id,n);
  }
  if(own(n,'__alias')){
   need(Object.keys(n).length===1&&uint(n.__alias),'alias-shape');aliases.push(n.__alias);
  }
  for(const v of Object.values(n))pending.push(v);
 }
 need(aliases.every(id=>nodes.has(id)),'dangling-alias');
 return nodes;
}
const resolve=(n,nodes)=>own(n,'__alias')?nodes.get(n.__alias):n;
const readMap=(n,nodes)=>resolve(n,nodes)?.__map;
const readArray=(n,nodes)=>arr(resolve(n,nodes));
const readObject=(n,nodes)=>obj(resolve(n,nodes));

/** Validate references against the independently generated early projection.
 * Never accept a same-shaped but different chunk/spawn alias. */
export function validateSectionBindings(game,matter,meshOrder){
 const nodes=indexSectionNodes(game);
 const terrain=readObject(game.terrain,nodes);
 const active=readMap(terrain?.active,nodes);
 need(Array.isArray(active),'terrain-active');
 const chunks=new Map(active.map(([index,v])=>[index,readObject(v,nodes)]));
 need(chunks.size===active.length&&active.every(([i])=>uint(i)&&chunks.get(i)?.index===i),'terrain-index');
 need(Array.isArray(meshOrder)&&new Set(meshOrder).size===meshOrder.length&&meshOrder.every(i=>chunks.has(i)),'mesh-order');
 const mesh=new Set(meshOrder),q=readMap(game._chunkQueue,nodes);
 need(Array.isArray(q)&&q.every(([i,v])=>!mesh.has(i)&&readObject(v,nodes)===chunks.get(i)),'queue');
 const seenBodies=new Set(['sled']);
 need(game.sled?.__obj?.body?.__body==='sled'&&game.sled.__obj.random?.__alias===game.runRandom?.__id,'sled');
 const bindBody=(key)=>{
  need(typeof key==='string'&&!seenBodies.has(key)&&own(matter?.bodies,key),'entity-body');
  seenBodies.add(key);
 };
 need(own(matter?.bodies,'sled'),'sled-body');
 for(const [idx,list] of readMap(game.hazards,nodes)??[]){
  need(mesh.has(idx),'hazard-chunk');
  const spawns=readArray(chunks.get(idx).hazards,nodes);
  need(Array.isArray(spawns),'hazard-spawns');
  for(const h of readArray(list,nodes)??[]){
   const v=readObject(h,nodes),ordinal=Number(v?.hid?.split(':')[1]),spawn=spawns[ordinal];
   need(v?.hid===idx+':'+ordinal&&uint(ordinal)&&spawn&&
    resolve(v.spawn,nodes)===resolve(spawn,nodes)&&v.def?.__content==='/hazards/'+readObject(spawn,nodes)?.defId,'hazard-spawn');
   bindBody(v.body?.__body);
  }
 }
 for(const [idx,list] of readMap(game.powerups,nodes)??[]){
  need(mesh.has(idx),'pickup-chunk');
  const spawns=readArray(chunks.get(idx).powerups,nodes);
  need(Array.isArray(spawns),'pickup-spawns');
  for(const p of readArray(list,nodes)??[]){
   const v=readObject(p,nodes),suffix=v?.key?.split(':')[1];
   if(suffix==='magnet'){
    // Magnet placement is not part of deterministic chunk records. Its
    // independent spawn recipe still needs full-config validation.
    need(v.key===idx+':magnet'&&v.def?.__content==='/powerups/shardMagnet'&&readObject(v.spawn,nodes)?.defId==='shardMagnet','magnet-spawn');
   }else{
    const ordinal=Number(suffix),spawn=spawns[ordinal];
    need(v?.key===idx+':'+ordinal&&uint(ordinal)&&spawn&&resolve(v.spawn,nodes)===resolve(spawn,nodes)&&
      v.def?.__content==='/powerups/'+readObject(spawn,nodes)?.defId,'pickup-spawn');
   }
   bindBody(v.body?.__body);
  }
 }
 const shardField=readObject(game.shardField,nodes);
 for(const [idx,list] of readMap(shardField?.byChunk,nodes)??[]){
  need(mesh.has(idx),'shard-chunk');
  const source=readArray(chunks.get(idx).shards,nodes);
  need(Array.isArray(source),'shard-spawns');
  const byId=new Map(source.map(s=>{const v=readObject(s,nodes);return [v.id,v];}));
  for(const s of readArray(list,nodes)??[]){
   const v=readObject(s,nodes),original=byId.get(v.id);
   need(original&&(v.pulled===true||(Object.is(v.x,original.x)&&Object.is(v.y,original.y))),'shard-spawn');
  }
 }
 for(const k of Object.keys(matter.bodies))
  if(k==='sled'||k.startsWith('hazard:')||k.startsWith('powerup:'))need(seenBodies.has(k),'unbound-entity-body');
 return true;
}
