import {digestOfBytes} from '../../src/systems/replay/canonicalSha256.js';
import {utf8Encode} from '../../src/systems/replay/canonicalJson.js';
import { GhostRecorder } from '../../src/systems/ghost/GhostTape.js';
import {captureRecorderPrefix,prepareRecorderPrefix,applyRecorderPrefix,decodeRecorderPrefix} from '../../tools/savestate-experiment/recorder-snapshot-kit.js';

function fresh(startedAt=1) {
  return {runId:'fixture-'+startedAt,startedAt,simClock:{tick:0},ghostRecorder:new GhostRecorder({seed:'test',startedAt})};
}
function prefix() {
  const a=fresh(),r=a.ghostRecorder;
  for (let t=1;t<=8;t++) {
    r.input(t,{push:t<6,tilt:0,pressed:{hop:t===4||t===5}});
    r.afterTick(t,{sled:{body:{position:{x:t,y:-0},angle:0}}});
    a.simClock.tick=t;
  }
  return a;
}
test('recorder prefix round-trips all fields and signed zero, retains same held/edge cursor',()=>{
  const a=prefix(),b=fresh(2),snap=JSON.parse(JSON.stringify(captureRecorderPrefix(a)));
  const prepared=prepareRecorderPrefix(b,snap,8);
  applyRecorderPrefix(b,prepared);
  expect(captureRecorderPrefix(b)).toEqual(snap);
  expect(Object.is(b.ghostRecorder.trace[1],-0)).toBe(true);
  for(const run of [a,b]) run.ghostRecorder.input(9,{push:true,tilt:0,pressed:{}});
  expect(b.ghostRecorder.inputs).toEqual(a.ghostRecorder.inputs);
  expect(b.ghostRecorder.inputs.at(-1)[0]).toBe(3);
  expect(b.ghostRecorder._lastTick).toBe(a.ghostRecorder._lastTick);
});
test.each([
  ['missing section',()=>undefined],
  ['cursor',s=>{const d=JSON.parse(s.data);d.recorder._lastTick++;return {...s,data:JSON.stringify(d)};}],
  ['wrong course',s=>{const d=JSON.parse(s.data);d.recorder.header.seed='other';return {...s,data:JSON.stringify(d)};}],
  ['missing trace',s=>{const d=JSON.parse(s.data);d.recorder.trace.pop();return {...s,data:JSON.stringify(d)};}],
  ['invalid row',s=>{const d=JSON.parse(s.data);d.recorder.inputs[0][1]=0xffffffff;return {...s,data:JSON.stringify(d)};}],
])('rejects %s without modifying fresh recorder',(_label,mutate)=>{
  const a=prefix(),b=fresh(2),before=captureRecorderPrefix(b);
  const bad=mutate(captureRecorderPrefix(a));
  // Re-seal these shape/cursor negatives to exercise structural validation
  // independently of the accidental-corruption checksum.
  if(bad)bad.integrity=digestOfBytes(utf8Encode(bad.data));
  expect(()=>prepareRecorderPrefix(b,bad,8)).toThrow(/recorder prefix/);
  expect(captureRecorderPrefix(b)).toEqual(before);
});
test('unclassified recorder field and nonfresh destination fail closed',()=>{
  const a=prefix(),b=fresh(2);
  b.simClock.tick=1;
  expect(()=>prepareRecorderPrefix(b,captureRecorderPrefix(a),8)).toThrow(/not fresh/);
  a.ghostRecorder.newField=true;
  expect(()=>captureRecorderPrefix(a)).toThrow(/unclassified/);
});

test('interior repeated edge removal with an unchanged final cursor fails the captured integrity check',()=>{
  const a=prefix(),b=fresh(2),s=captureRecorderPrefix(a),d=JSON.parse(s.data);
  expect(d.recorder.inputs[1][1]).toBe(d.recorder.inputs[2][1]);
  d.recorder.inputs[2][0]+=d.recorder.inputs[1][0];
  d.recorder.inputs.splice(1,1);
  expect(d.recorder.inputs.reduce((n,row)=>n+row[0],0)).toBe(d.recorder._lastTick);
  const before=captureRecorderPrefix(b);
  expect(()=>prepareRecorderPrefix(b,{...s,data:JSON.stringify(d)},8)).toThrow(/integrity mismatch/);
  expect(captureRecorderPrefix(b)).toEqual(before);
});

test('zero tick restores a genuinely empty native recorder and rejects nonempty history',()=>{
  const a=fresh(1),b=fresh(2);
  const snapshot=captureRecorderPrefix(a);
  applyRecorderPrefix(b,prepareRecorderPrefix(b,snapshot,0));
  expect(captureRecorderPrefix(b)).toEqual(snapshot);
  const bad=JSON.parse(snapshot.data);
  bad.recorder.inputs.push([1,0,0]);
  const data=JSON.stringify(bad);
  expect(()=>prepareRecorderPrefix(fresh(3),{...snapshot,data,integrity:digestOfBytes(utf8Encode(data))},0)).toThrow(/zero-tick history/);
});

test('terminal history reader verifies integrity and preserves signed-zero trace samples',()=>{
  const a=prefix(),snap=captureRecorderPrefix(a),decoded=decodeRecorderPrefix(snap);
  expect(Object.is(decoded.recorder.trace[1],-0)).toBe(true);
  expect(decodeRecorderPrefix(snap).recorder.lastTick).toBe(8);
  expect(()=>decodeRecorderPrefix({...snap,data:snap.data+' '})).toThrow(/integrity mismatch/);
});
