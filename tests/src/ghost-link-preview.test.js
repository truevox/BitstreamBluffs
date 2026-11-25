import { guestPreview } from '../../src/ui/GhostLinkView.js';
import { decodeTrace, tracePose, TRACE_EVERY } from '../../src/systems/ghost/GhostTape.js';

function tape(points) {
 return {trace:Buffer.from(new Float32Array(points.flat()).buffer).toString('base64')};
}

describe('Guest Ghost-in-a-Link trace preview is strictly read-only',()=>{
 test('extracts bounded physical path for an untrusted visual replay',()=>{
  const source=tape([[42,100,0],[64,120,0.2],[110,80,-0.1]]);
  const value=guestPreview(source);
  expect(value).toMatchObject({count:3,minX:42,maxX:110,minY:80,maxY:120});
  expect([...value.trace]).toEqual(expect.arrayContaining([42,100,64,120,110,80]));
  expect(tracePose(value.trace,TRACE_EVERY)).toMatchObject({x:42,y:100});
  expect(source).not.toHaveProperty('runId');
 });
 test('empty, nonfinite, and outrageous coordinates are rejected',()=>{
  expect(()=>guestPreview({trace:''})).toThrow('no trace');
  expect(()=>guestPreview(tape([[Number.NaN,0,0]]))).toThrow('Invalid ghost');
  expect(()=>guestPreview(tape([[0,Infinity,0]]))).toThrow('Invalid ghost');
  expect(()=>guestPreview(tape([[1e15,0,0]]))).toThrow('Invalid ghost');
 });
 test('does not create any persistent ghost or run records',()=>{
  const store=globalThis.localStorage;
  const read=()=>Object.fromEntries(Array.from({length:store.length},(_,i)=>{
   const k=store.key(i);return [k,store.getItem(k)];
  }));
  const before=read();
  guestPreview(tape([[0,0,0],[3,1,0]]));
  expect(read()).toEqual(before);
 });
});
