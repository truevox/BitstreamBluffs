/**
 * Issue #119 Phase 1 (EXPERIMENTAL, non-production): pins the pure-Matter savestate findings.
 * Uses the Matter build the game ships (Phaser 3.90 / Matter 0.20.0) and the game's installTerrainContactFix.
 * Digests are diagnostic only; #152 owns canonical hashes. See docs/determinism/savestate-feasibility.md.
 */
import { loadDeps, runCase, incompleteChecks, staticGeometryDiff, buildWorld } from '../../tools/savestate-experiment/matter-node-experiment.mjs';

let Matter;
let kit;
beforeAll(async () => { ({ Matter, kit } = await loadDeps()); });

const K = 300;
const N = 700;

describe('savestate feasibility: pure Matter round trip (contact-heavy fixture)', () => {
  test('GhostTape-style checkpoint (sled pose + velocity only) diverges on the first tick after restore', () => {
    const r = runCase(Matter, kit, { level: 'pose', history: 'same', K, N });
    expect(r.firstDivergentTick).toBe(K + 1);
  });

  test('raw kinematics without the pair table (cached impulses) still diverge on the first tick', () => {
    const r = runCase(Matter, kit, { level: 'kinematic', history: 'same', K, N });
    expect(r.firstDivergentTick).toBe(K + 1);
  });

  test('full restore is bit-exact per tick even when the fresh world was built with a different id history', () => {
    for (const history of ['same', 'shuffled', 'permuted']) {
      const r = runCase(Matter, kit, { level: 'full', history, K, N });
      expect({ history, first: r.firstDivergentTick }).toEqual({ history, first: null });
    }
  });

  test('without id alignment a permuted fresh world diverges once a NEW pair forms (collision.bodyA = lower id)', () => {
    const r = runCase(Matter, kit, { level: 'contacts', history: 'permuted', K, N });
    expect(r.firstDivergentTick).toBeGreaterThan(K + 1);
  });

  test('pooled static colliders differ in the last bits; restoring static geometry closes the gap', () => {
    expect(staticGeometryDiff(Matter, 'pooled').staticBodiesWithDifferentBits).toBeGreaterThan(0);
    expect(runCase(Matter, kit, { level: 'full', history: 'pooled', K, N }).firstDivergentTick).not.toBeNull();
    expect(runCase(Matter, kit, { level: 'full', history: 'pooled', K, N, captureStatics: true }).firstDivergentTick).toBeNull();
  });

  // Items needed in EVERY tested state: removing any one breaks exactness on the first tick, at both K.
  test.each([
    [300, 'impulses'], [300, 'staleSupport'], [300, 'deltaTime'], [300, 'rawGeometry'],
    [450, 'impulses'], [450, 'staleSupport'], [450, 'deltaTime'], [450, 'rawGeometry'],
  ])('K=%i: leaving out %s breaks exactness at K+1', (k, skip) => {
    const r = runCase(Matter, kit, { level: 'full', history: 'same', K: k, N: k + 300, skip: [skip] });
    expect(r.firstDivergentTick).toBe(k + 1);
  });

  // State-dependent items: needed at K=300, not needed in the K=450 window. "Not needed in one window" is not
  // evidence of "not needed"; the doc keeps both as required.
  test.each(['timing', 'positionImpulse'])('%s is state-dependent: K+1 at K=300, exact at K=450', (skip) => {
    expect(runCase(Matter, kit, { level: 'full', history: 'same', K: 300, N: 600, skip: [skip] }).firstDivergentTick).toBe(301);
    expect(runCase(Matter, kit, { level: 'full', history: 'same', K: 450, N: 750, skip: [skip] }).firstDivergentTick).toBeNull();
  });

  test('incomplete snapshots fail visibly (set checks, version, and a live key-set audit of every Matter object)', () => {
    const out = incompleteChecks(Matter, kit);
    for (const k of ['missingBody', 'wrongVersion', 'unknownPairPart']) expect(out[k]).toMatch(/^threw: /);
    for (const [name, r] of Object.entries(out.liveAudit)) {
      expect({ name, auditEntries: r.audit.length, restore: r.restore }).toEqual({ name, auditEntries: 1, restore: 'threw' });
    }
    expect(Object.keys(out.liveAudit)).toEqual(['rootBody', 'pair', 'collision', 'contact', 'engine', 'timing', 'detector', 'resolverStatic']);
  });
});

test('diagnostic snapshot V2 captures changed gravity and rejects absent or nonfinite gravity before restore', () => {
  const a = buildWorld(Matter);
  Object.assign(a.engine.gravity, { x: 0.125, y: 0.67, scale: 0.002 });
  const snap = JSON.parse(JSON.stringify(kit.capture(a.engine, a.keyOf, {selectBody:()=>true})));
  expect(snap.gravity).toEqual({ x: 0.125, y: 0.67, scale: 0.002 });
  for (const bad of [undefined, {x:0,y:null,scale:.001}, {x:0,y:1,scale:.001,extra:0}]) {
    const b = buildWorld(Matter);
    const before = {...b.engine.gravity};
    expect(()=>kit.restore(b.engine,{...snap,gravity:bad},b.keyOf,'full')).toThrow(/gravity/);
    expect(b.engine.gravity).toEqual(before);
  }
  const b = buildWorld(Matter);
  kit.restore(b.engine,snap,b.keyOf,'full');
  expect(b.engine.gravity).toEqual(snap.gravity);
});

test('explicit full Matter preflight rejects malformed identity and geometry before modifying destination',()=>{
  const a=buildWorld(Matter);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  const b=buildWorld(Matter);
  const before=JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}));
  for(const mutate of [
    s=>delete s.bodies.sled,
    s=>s.ids.sled[1]=s.ids.sled[0],
    s=>s.bodies.sled.parts[0].verts[0]=[null,0],
    s=>s.worldOrder.push('sled'),
    s=>s.gravity.extra=0,
    s=>s.statics={},
    s=>s.statics.Common._baseDelta=false,
    s=>s.statics.Body._timeCorrection=1,
    s=>s.bodies.sled.parts[0].axes.push([1,0]),
    s=>s.bodies.sled.parts[0].verts.push([1,0]),
    s=>{s.bodies.sled.parts.push(s.bodies.sled.parts[0]);s.ids.sled.push(s.nextId++);},
    s=>s.pairs.push({a:'missing'}),
    s=>s.orphanPairs.push({labels:['a','b']}),
  ]){
    const bad=JSON.parse(JSON.stringify(good));mutate(bad);
    expect(()=>kit.restore(b.engine,bad,b.keyOf,'full',{completePreflight:true})).toThrow(/Matter preflight/);
    expect(JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}))).toBe(before);
  }
  expect(()=>kit.restore(b.engine,good,b.keyOf,'full',{completePreflight:true})).not.toThrow();
});
test('unsupported constraints are audited rather than silently omitted',()=>{
  const a=buildWorld(Matter);
  Matter.Composite.add(a.engine.world,Matter.Constraint.create({bodyA:a.sled,pointB:{x:0,y:0}}));
  const snap=kit.capture(a.engine,a.keyOf,{selectBody:()=>true});
  expect(snap.audit).toContain('unsupported Matter constraints');
});

test('modified world permits stale detector entries only when the order will be rebuilt',()=>{
  const a=buildWorld(Matter);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  good.worldModified=true;
  good.detectorOrder=[null,null,'stale:removed'];
  expect(kit.preflight(good)).toBe(true);
  good.worldModified=false;
  expect(()=>kit.preflight(good)).toThrow(/world\/detector order/);
});
test('full preflight requires both contact slots even for a one-contact pair',()=>{
  const a=buildWorld(Matter);
  for(let i=0;i<300&&!a.engine.pairs.list.length;i++) Matter.Engine.update(a.engine,1000/240);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  expect(good.pairs.length).toBeGreaterThan(0);
  expect(kit.preflight(good)).toBe(true);
  const bad=JSON.parse(JSON.stringify(good));
  bad.pairs[0].contactCount=1;
  bad.pairs[0].contacts.pop();
  expect(()=>kit.preflight(bad)).toThrow(/pair\/contact reference/);
});

test('active contacts and collision supports must belong to the actual pair endpoints',()=>{
  const a=buildWorld(Matter);
  for(let i=0;i<300&&!a.engine.pairs.list.some(p=>p.contactCount>0);i++)Matter.Engine.update(a.engine,1000/240);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  expect(kit.preflight(good)).toBe(true);
  const idx=good.pairs.findIndex(p=>p.contactCount>0&&p.col.supportCount>0);
  expect(idx).toBeGreaterThanOrEqual(0);
  const p=good.pairs[idx];
  const other=Object.keys(good.bodies).map(k=>k+'#0').find(k=>k!==p.a&&k!==p.b);
  for(const mutate of [p=>p.contacts[0][0]=[other,0],p=>p.col.supports[0]=[other,0]]){
    const bad=JSON.parse(JSON.stringify(good));mutate(bad.pairs[idx]);
    expect(()=>kit.preflight(bad)).toThrow(/reference/);
  }
});

test('complete preflight rejects sparse physics arrays and reversed saved pair IDs without mutation',()=>{
  const a=buildWorld(Matter);
  for(let i=0;i<300&&!a.engine.pairs.list.some(p=>p.contactCount>0);i++)Matter.Engine.update(a.engine,1000/240);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  expect(kit.preflight(good)).toBe(true);
  const b=buildWorld(Matter), before=JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}));
  for(const mutate of [
    s=>delete s.bodies.sled.v.velocity[0],
    s=>delete s.bodies.sled.parts[0].verts[0],
    s=>delete s.pairs[0].contacts[1],
    s=>delete s.pairs[0],
    s=>{const p=s.pairs[0];[p.a,p.b]=[p.b,p.a];[p.ca,p.cb]=[p.cb,p.ca];},
  ]){
    const bad=JSON.parse(JSON.stringify(good));mutate(bad);
    expect(()=>kit.restore(b.engine,bad,b.keyOf,'full',{completePreflight:true})).toThrow(/Matter preflight/);
    expect(JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}))).toBe(before);
  }
});

test('order entries must be actual strings, not coercible array keys',()=>{
  const a=buildWorld(Matter);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  for(const field of ['worldOrder','detectorOrder']){
    const bad=JSON.parse(JSON.stringify(good));
    bad.worldModified=false;
    bad.detectorOrder=[...bad.worldOrder];
    bad[field][0]=[bad[field][0]];
    expect(()=>kit.preflight(bad)).toThrow(/world\/detector order/);
  }
});
test('inactive dead contact/support references survive repeated capture and restore',()=>{
  const a=buildWorld(Matter);
  for(let i=0;i<300&&!a.engine.pairs.list.some(p=>p.contactCount>0);i++)Matter.Engine.update(a.engine,1000/240);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  const p=good.pairs.find(p=>p.contactCount>0&&p.col.supportCount>0);
  expect(p).toBeDefined();
  p.contactCount=1;p.col.supportCount=1;
  p.contacts[1][0]=['<dead>',-1];p.col.supports[1]=['<dead>',-1];
  expect(kit.preflight(good)).toBe(true);
  const b=buildWorld(Matter);
  kit.restore(b.engine,good,b.keyOf,'full',{completePreflight:true});
  const second=JSON.parse(JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true})));
  expect(second.pairs.find(q=>q.a===p.a&&q.b===p.b).contacts[1][0]).toEqual(['<dead>',-1]);
  expect(second.pairs).toEqual(good.pairs);
  expect(kit.preflight(second)).toBe(true);
  const c=buildWorld(Matter);
  expect(()=>kit.restore(c.engine,second,c.keyOf,'full',{completePreflight:true})).not.toThrow();
  p.contacts[0][0]=['<dead>',-1];
  expect(()=>kit.preflight(good)).toThrow(/pair\/contact reference/);
});

test('pair activity and contact count must agree before full restore',()=>{
  const a=buildWorld(Matter);
  for(let i=0;i<300&&!a.engine.pairs.list.some(p=>p.isActive&&p.contactCount>0);i++)Matter.Engine.update(a.engine,1000/240);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  const i=good.pairs.findIndex(p=>p.isActive&&p.contactCount>0);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(kit.preflight(good)).toBe(true);
  const b=buildWorld(Matter),before=JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}));
  for(const mutate of [p=>p.contactCount=0,p=>p.isActive=false]){
    const bad=JSON.parse(JSON.stringify(good));mutate(bad.pairs[i]);
    expect(()=>kit.restore(b.engine,bad,b.keyOf,'full',{completePreflight:true})).toThrow(/pair activity\/contact count/);
    expect(JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}))).toBe(before);
  }
});

test('active contact must reference the identical support vertex, not a different vertex on its endpoint',()=>{
  const a=buildWorld(Matter);
  for(let i=0;i<300&&!a.engine.pairs.list.some(p=>p.isActive&&p.contactCount>0);i++)Matter.Engine.update(a.engine,1000/240);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  const bad=JSON.parse(JSON.stringify(good)),p=bad.pairs.find(p=>p.isActive&&p.contactCount>0);
  expect(p).toBeDefined();
  const [key,index]=p.contacts[0][0],split=key.lastIndexOf('#');
  const count=bad.bodies[key.slice(0,split)].parts[Number(key.slice(split+1))].verts.length;
  p.contacts[0][0]=[key,(index+1)%count];
  const b=buildWorld(Matter),before=JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}));
  expect(()=>kit.restore(b.engine,bad,b.keyOf,'full',{completePreflight:true})).toThrow(/contact\/support mismatch/);
  expect(JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}))).toBe(before);
});

test('single-support active pair must preserve the unused contact slot used for the next swap',()=>{
  const a=buildWorld(Matter);
  for(let i=0;i<300&&!a.engine.pairs.list.some(p=>p.isActive&&p.contactCount===1);i++)Matter.Engine.update(a.engine,1000/240);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  const i=good.pairs.findIndex(p=>p.isActive&&p.contactCount===1);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(kit.preflight(good)).toBe(true);
  const bad=JSON.parse(JSON.stringify(good)),p=bad.pairs[i];
  p.contacts[1][0]=p.col.supports[1]===null?[...p.col.supports[0]]:null;
  const b=buildWorld(Matter),before=JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}));
  expect(()=>kit.restore(b.engine,bad,b.keyOf,'full',{completePreflight:true})).toThrow(/contact\/support mismatch/);
  expect(JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}))).toBe(before);
});

test('retained inactive pairs must preserve both old contact references for warm start',()=>{
  const a=buildWorld(Matter);
  for(let i=0;i<300&&!a.engine.pairs.list.some(p=>p.isActive&&p.contactCount>0);i++)Matter.Engine.update(a.engine,1000/240);
  const pair=a.engine.pairs.list.find(p=>p.isActive&&p.contactCount>0);
  expect(pair).toBeDefined();
  Matter.Pair.setActive(pair,false,a.engine.timing.timestamp);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  const i=good.pairs.findIndex(p=>!p.isActive&&p.col.supportCount>0);
  expect(i).toBeGreaterThanOrEqual(0);
  expect(kit.preflight(good)).toBe(true);
  const bad=JSON.parse(JSON.stringify(good));bad.pairs[i].contacts[0][0]=null;
  const b=buildWorld(Matter),before=JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}));
  expect(()=>kit.restore(b.engine,bad,b.keyOf,'full',{completePreflight:true})).toThrow(/contact\/support mismatch/);
  expect(JSON.stringify(kit.capture(b.engine,b.keyOf,{selectBody:()=>true}))).toBe(before);
});

test('pending detector rebuild preserves raw resolvable order and modified flag',()=>{
  const a=buildWorld(Matter);
  Matter.Engine.update(a.engine,1000/240);
  const good=JSON.parse(JSON.stringify(kit.capture(a.engine,a.keyOf,{selectBody:()=>true})));
  good.worldModified=true;
  good.detectorOrder=good.detectorOrder.slice(1).reverse();
  expect(kit.preflight(good)).toBe(true);
  const b=buildWorld(Matter);
  kit.restore(b.engine,good,b.keyOf,'full',{completePreflight:true});
  const restored=kit.capture(b.engine,b.keyOf,{selectBody:()=>true});
  expect(restored.worldModified).toBe(true);
  expect(restored.detectorOrder).toEqual(good.detectorOrder);
});

test('pending detector rebuild must not alias a removed body to its same-key replacement',()=>{
  const a=buildWorld(Matter);
  Matter.Engine.update(a.engine,1000/240);
  const old=a.engine.detector.bodies.find(b=>b.isStatic);
  const key=a.keyOf(old);
  const replacement=Matter.Bodies.rectangle(old.position.x,old.position.y,10,10,{isStatic:true,label:old.label});
  Matter.Composite.remove(a.engine.world,old);
  Matter.Composite.add(a.engine.world,replacement);
  const keyOf=b=>b===replacement?key:a.keyOf(b);
  const snap=kit.capture(a.engine,keyOf,{selectBody:()=>true});
  expect(snap.worldModified).toBe(true);
  expect(snap.worldOrder).toContain(key);
  expect(snap.detectorOrder).toContain(null);
  expect(snap.detectorOrder).not.toContain(key);
  expect(kit.preflight(snap)).toBe(true);
});
