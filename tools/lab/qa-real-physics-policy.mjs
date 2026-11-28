/** Deterministic input tape generator for real RunScene worker parity.
 * Test-only, no clock, global RNG or human/TAS/training attribution.
 */
export const PHYSICS_QA_CASES=Object.freeze([
 Object.freeze({seed:'PHYSICS-WORKER-BASE',ticks:420,biomeMask:0,policy:'neutral'}),
 Object.freeze({seed:'PHYSICS-WORKER-TRICKS',ticks:420,biomeMask:3,policy:'tricks'}),
 Object.freeze({seed:'PHYSICS-WORKER-VERTIGO',ticks:720,biomeMask:1024,policy:'tricks'}),
]);
export function physicsQaPad(policy,tick){
 if(policy==='neutral')return {push:tick<300,tilt:0,variableHop:true,noAutoNudge:true,
  pressed:{hop:tick===101||tick===301}};
 if(policy==='tricks')return {push:tick<420,tilt:tick%90<45?1:-1,
  heli:tick%80<40?1:0,airBrake:tick%120===40,variableHop:true,noAutoNudge:true,
  pressed:{hop:tick%135===1,airBrake:tick%120===40}};
 throw new TypeError('Unknown real physics QA input tape policy');
}
