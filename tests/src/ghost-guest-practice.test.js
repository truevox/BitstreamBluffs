/** #69 draft: fail-closed admission for an already explicitly decoded URL guest. */
import {GHOST_TAPE_FORMAT,GHOST_TAPE_VERSION,GHOST_PHYSICS_VERSION} from '../../src/systems/ghost/GhostTape.js';
import {SIM_TICK_HZ} from '../../src/systems/SimClock.js';
import {SIM_REVISION} from '../../src/systems/replay/ruleset.js';
import {guestPracticeEligible,guestPracticeLaunch} from '../../src/systems/ghost/GuestPractice.js';

const tape=()=>({
 format:GHOST_TAPE_FORMAT,version:GHOST_TAPE_VERSION,physicsVersion:GHOST_PHYSICS_VERSION,
 simTickHz:SIM_TICK_HZ,simRevision:SIM_REVISION,seed:'literal@mask-seed',biomeMask:7,mode:'normal',
 runId:'shared:untrusted-preview',endTick:240,inputs:[[1,0,0]],trace:Buffer.from(
  new Float32Array([42,170,0,55,180,.1]).buffer).toString('base64'),
});

describe('unranked guest trace handoff policy',()=>{
 test('only normal exact-current-SIM tape with finite render-only trace is admitted',()=>{
  const guest=tape();
  expect(guestPracticeEligible(guest)).toBe(true);
  expect(guestPracticeLaunch(guest)).toEqual({seed:'literal@mask-seed',biomeMask:7,tape:guest});
  expect(guest.runId).toBe('shared:untrusted-preview');
  expect(guest.score).toBeUndefined();
 });
 test.each([
  ['no tape',null],['old revision',{simRevision:SIM_REVISION-1}],
  ['daily attempt',{mode:'daily'}],['draft daily',{mode:'daily-draft'}],
  ['old physics',{physicsVersion:999}],['other tick rate',{simTickHz:30}],
  ['invalid mask',{biomeMask:-1}],['mask beyond uint32',{biomeMask:2**32}],
  ['missing seed',{seed:''}],['too long seed',{seed:'a'.repeat(161)}],
  ['missing input rows',{inputs:null}],['no trace',{trace:''}],
  ['nonphysical trace',{trace:Buffer.from(new Float32Array([NaN,170,0]).buffer).toString('base64')}],
  ['invalid endTick',{endTick:0}],['oversize tick',{endTick:2000001}],
 ])('rejects %s, rather than falling back to credited normal play',(_label,change)=>{
  const value=change===null?null:{...tape(),...change};
  expect(guestPracticeEligible(value)).toBe(false);
  expect(guestPracticeLaunch(value)).toBeNull();
 });
});
