import {evaluateLabWorkerBudget as budget,readBrowserLabSignals as sample,
 LAB_RESOURCE_GOVERNOR_ABI} from '../../src/systems/lab/LabResourceGovernor.js';
const base={authorizedSlots:3,requestedSlots:3,activeWorkers:0,rideActive:false,
 visibility:'visible',hardwareConcurrency:8,deviceMemoryGiB:16};
const withSignals=patch=>budget({...base,...patch});

test('P0 admission never invents slots or active worker counts',()=>{
 const r=withSignals({activeWorkers:1});
 expect(LAB_RESOURCE_GOVERNOR_ABI).toBe(1);
 expect(r).toMatchObject({authorizedSlots:3,requestedSlots:3,admissionLimit:3,
  activeWorkers:1,startsAvailable:2,draining:false,admission:'allow'});
 expect(withSignals({authorizedSlots:1,requestedSlots:3}).admissionLimit).toBe(1);
 expect(withSignals({authorizedSlots:0}).admissionLimit).toBe(0);
 expect(withSignals({requestedSlots:0}).startsAvailable).toBe(0);
 expect(withSignals({activeWorkers:4})).toMatchObject({admissionLimit:3,startsAvailable:0,draining:true});
});

test('Ride begins and tab hides: admission drops immediately without pretending in-flight jobs vanished',()=>{
 expect(withSignals({activeWorkers:2,rideActive:true})).toMatchObject({
  admissionLimit:0,activeWorkers:2,startsAvailable:0,draining:true,admission:'hold'});
 expect(withSignals({activeWorkers:2,visibility:'hidden'})).toMatchObject({
  admissionLimit:0,draining:true,admission:'hold'});
 expect(withSignals({visibility:'unknown'}).reasons).toContain('visibility-unknown');
 expect(withSignals({rideActive:false,visibility:'visible',activeWorkers:0}).startsAvailable).toBe(3);
});

test('School preset and cautious hardware estimates bound concurrency without claiming actual memory',()=>{
 expect(withSignals({schoolPreset:true}).admissionLimit).toBe(1);
 expect(withSignals({hardwareConcurrency:2,deviceMemoryGiB:32}).admissionLimit).toBe(1);
 expect(withSignals({hardwareConcurrency:16,deviceMemoryGiB:2}).admissionLimit).toBe(1);
 expect(withSignals({hardwareConcurrency:NaN,deviceMemoryGiB:undefined})).toMatchObject({
  admissionLimit:1,observations:{cpu:'unknown',memory:'unknown'}});
 expect(withSignals({hardwareConcurrency:16,deviceMemoryGiB:16}).admissionLimit).toBe(3);
});

test('Real reported battery and pressure throttle, unknown values do not pretend measured',()=>{
 expect(withSignals({batteryLevel:.12,batteryCharging:false}).admissionLimit).toBe(0);
 expect(withSignals({batteryLevel:.29,batteryCharging:false}).admissionLimit).toBe(1);
 expect(withSignals({batteryLevel:.12,batteryCharging:true}).admissionLimit).toBe(3);
 expect(withSignals({batteryLevel:undefined,batteryCharging:undefined}).observations.battery).toBe('unknown');
 expect(withSignals({batteryLevel:0,batteryCharging:undefined}).admissionLimit).toBe(3);
 expect(withSignals({pressure:'moderate'}).admissionLimit).toBe(1);
 expect(withSignals({pressure:'critical'})).toMatchObject({admissionLimit:0,draining:false});
 expect(withSignals({pressure:'unknown'}).observations.pressure).toBe('not-reported');
});

test('Browser probe uses only genuinely exposed hints; rejects fabricated thermals and handles battery refusal',async()=>{
 expect(await sample()).toMatchObject({visibility:'unknown',batterySource:'unsupported',pressure:'unknown'});
 const r=await sample({navigatorRef:{hardwareConcurrency:4,deviceMemory:2,
  getBattery:async()=>({level:.17,charging:false})},documentRef:{visibilityState:'hidden'}});
 expect(r).toMatchObject({visibility:'hidden',hardwareConcurrency:4,deviceMemoryGiB:2,
  batteryLevel:.17,batteryCharging:false,batterySource:'reported',pressure:'unknown'});
 expect(r).not.toHaveProperty('temperature');
 const denied=await sample({navigatorRef:{getBattery:async()=>{throw Error('permission denied');}},
  documentRef:{hidden:false}});
 expect(denied).toMatchObject({visibility:'visible',batterySource:'unavailable'});
 expect(denied.batteryLevel).toBeUndefined();
});

test('Explicit capacity contract rejects malformed or negative counts and cannot mint slots',()=>{
 for(const patch of [{authorizedSlots:undefined},{requestedSlots:-1},{activeWorkers:-1},
  {activeWorkers:NaN},{authorizedSlots:33},{requestedSlots:5.5},{rideActive:undefined},
  {schoolPreset:1},{pressure:'made-up-thermal'},{visibility:'probably'}]){
  expect(()=>withSignals(patch)).toThrow(TypeError);
 }
});

test('Budget is read-only deterministic and has no RNG or time dependence',()=>{
 const input={...base,activeWorkers:2,schoolPreset:true};
 const first=budget(input),second=budget(input);
 expect(first).toEqual(second);
 expect(Object.isFrozen(first)).toBe(true);
 expect(Object.isFrozen(first.observations)).toBe(true);
 expect(input.activeWorkers).toBe(2);
 expect(first).toMatchObject({admissionLimit:1,activeWorkers:2,draining:true});
});
