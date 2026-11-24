import { GhostRecorder } from '../../src/systems/ghost/GhostTape.js';
import {captureRecorderPrefix,prepareRecorderPrefix,applyRecorderPrefix} from '../../tools/savestate-experiment/recorder-snapshot-kit.js';

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
  expect(()=>prepareRecorderPrefix(b,mutate(captureRecorderPrefix(a)),8)).toThrow(/recorder prefix/);
  expect(captureRecorderPrefix(b)).toEqual(before);
});
test('unclassified recorder field and nonfresh destination fail closed',()=>{
  const a=prefix(),b=fresh(2);
  b.simClock.tick=1;
  expect(()=>prepareRecorderPrefix(b,captureRecorderPrefix(a),8)).toThrow(/not fresh/);
  a.ghostRecorder.newField=true;
  expect(()=>captureRecorderPrefix(a)).toThrow(/unclassified/);
});
