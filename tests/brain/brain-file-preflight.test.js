import {TextEncoder,TextDecoder} from 'node:util';
// Jest jsdom omits browser-standard encoding constructors.
globalThis.TextEncoder=TextEncoder;globalThis.TextDecoder=TextDecoder;
import {preflightBrainJson,BRAIN_PREFLIGHT_LIMITS as lim} from '../../src/systems/brain/brainFilePreflight.js';
const check=input=>preflightBrainJson(input);

test('ordinary bounded JSON roundtrips without inherited prototypes or authority',()=>{
 const original={format:'bb-brain-draft',version:1,observation:[1,-0.25,0],
  weights:[[0.3,-0.7],[0,0.9]],metadata:{seed:'test',score:0}};
 const a=check(JSON.stringify(original)),b=check(new TextEncoder().encode(JSON.stringify(original)));
 for(const v of [a,b]){
  expect(v.ok).toBe(true);expect(v.admission).toBe('preflight-only');
  expect(Object.getPrototypeOf(v.tree)).toBe(null);
  expect(Object.getPrototypeOf(v.tree.metadata)).toBe(null);
  expect(JSON.stringify(v.tree)).toBe(JSON.stringify(original));
  expect(v.nodes).toBeGreaterThan(1);
 }
});

test.each([
 ['truncated', '{"weights":[0,1'],
 ['NaN token', '{"weight":NaN}'],
 ['Infinity token', '{"weight":Infinity}'],
 ['nonfinite exponent', '{"weight":1e999}'],
 ['javascript literal', '{"run":()=>3}'],
 ['top-level primitive', '42'],
 ['top-level array', '[1,2,3]'],
 ['not JSON', '<script>alert(1)</script>'],
])('%s never produces executable/admitted data',(_,wire)=>{
 const r=check(wire);expect(r.ok).toBe(false);
 expect(r.code).toBe(['top-level primitive','top-level array'].includes(_)?'expected-object':_==='nonfinite exponent'?'nonfinite-number':'invalid-json');
});

test('reject huge source without parsing or encoding it',()=>{
 expect(check(' '.repeat(lim.maxBytes+1))).toEqual({ok:false,code:'file-too-large'});
 expect(check(new Uint8Array(lim.maxBytes+1))).toEqual({ok:false,code:'file-too-large'});
});
test('malformed UTF-8 and surprising non-wire types are refused',()=>{
 expect(check(Uint8Array.of(0xff,0xfe))).toEqual({ok:false,code:'invalid-input'});
 const cyclic={};cyclic.self=cyclic;
 for(const obj of [cyclic,NaN,Infinity,()=>1,new Map(),new Date(),new ArrayBuffer(4)])
  expect(check(obj)).toEqual({ok:false,code:'invalid-input'});
});
test.each(['__proto__','constructor','prototype'])("reject poisoned key '%s' at any depth",key=>{
 const raw=`{"nested":{"${key}":{"admin":true}}}`;
 expect(check(raw)).toEqual({ok:false,code:'unsafe-key'});
 expect({}.admin).toBeUndefined();
});
test('reject deep nesting iteratively without stack overflow',()=>{
 const raw='{"a":'+ '['.repeat(lim.maxDepth+4)+'0'+']'.repeat(lim.maxDepth+4)+'}';
 expect(check(raw)).toEqual({ok:false,code:'max-depth'});
});
test('bound array length, string length, key count and total nodes',()=>{
 expect(check(JSON.stringify({s:'a'.repeat(lim.maxStringLength+1)}))).toEqual({ok:false,code:'string-too-large'});
 expect(check(JSON.stringify({a:Array(lim.maxArrayLength+1).fill(0)}))).toEqual({ok:false,code:'array-too-large'});
 expect(check(JSON.stringify({a:Object.fromEntries(Array.from({length:lim.maxObjectKeys+1},(_,i)=>['k'+i,i]))}))).toEqual({ok:false,code:'object-too-large'});
 expect(check(JSON.stringify({a:Array.from({length:40001},()=>[[]])}))).toEqual({ok:false,code:'too-many-nodes'});
});
test('out-of-range finite weight refused before any model instantiation',()=>{
 expect(check(JSON.stringify({weights:[lim.maxAbsNumber+1]}))).toEqual({ok:false,code:'number-too-large'});
});
test('byte snapshot unaffected by subsequent mutation',()=>{
 const bytes=new TextEncoder().encode('{"version":1}');const result=check(bytes);
 bytes.fill(0);expect(result.ok).toBe(true);expect(result.tree.version).toBe(1);
});

test('primitive-heavy nested payload cannot bypass the total node cap',()=>{
 const r=check(JSON.stringify({a:Array(60000).fill(0),b:Array(25000).fill(0)}));
 expect(r).toEqual({ok:false,code:'too-many-nodes'});
});
