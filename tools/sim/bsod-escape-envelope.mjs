#!/usr/bin/env node
/** Source-backed reduced-order envelope probe for BSOD near-miss flight.
 *
 * Evaluates the shipped pure BsodPursuit, aerodynamicStep, canopyFuelStep,
 * BsodBluffTracker, PHYSICS and PermanentUpgrades curves. Not a real
 * Matter/Terrain game simulation: it deliberately ignores terrain drag,
 * slopes, tricks, collisions and player reaction latency. Report is an
 * optimistic diagnostic, never evidence that a human can execute a maneuver.
 * The SIM9 brake is an instantaneous paid one-shot AirBrake kick during
 * `brakeBeforeMs`, not continuously accumulated drag or gravity reduction.
 */
import { BSOD_DEFAULTS, BsodPursuit } from '../../src/systems/BsodPursuit.js';
import { aerodynamicStep, airBrakeKickStep, canopyFuelStep } from '../../src/systems/BsodAerodynamics.js';
import { BsodBluffTracker } from '../../src/systems/BsodBluffTracker.js';
import { PHYSICS } from '../../src/constants.js';
import { TUNING } from '../../src/systems/PhysicsTuner.js';
import { upgradeEffects } from '../../src/systems/PermanentUpgrades.js';

import path from "node:path";
import { fileURLToPath } from "node:url";

const DT=0.008;
const fmt=(n)=>Number(n.toFixed(1));
export function scenario({wallSpeed=600, closing=30, gap=230, ranks={}, brakeBeforeMs=0, canopyStartMs=100}) {
  const fx=upgradeEffects(ranks);
  const wall=new BsodPursuit({sledLeftEdgeX:gap,config:{
    ...BSOD_DEFAULTS,initialGapPx:gap,initialSpeedPxS:wallSpeed,
    accelerationPxS2:BSOD_DEFAULTS.accelerationPxS2*fx.bsodAccelerationMul,
  }});
  let x=gap, y=0, vx=wallSpeed-closing, vy=-360*fx.hopMul, fuel=PHYSICS.parachuteDurationMs*fx.canopyFuelMul;
  const tracker=new BsodBluffTracker();
  let minGap=gap,maxGap=gap,maxSpeed=vx, awards=[], airMs=0;
  let brakeKicks=0,brakeSpentSpeedPxS=0;
  for(let i=0;i<2000;i++){
    const nowMs=i*DT*1000;
    const snap=wall.state(x,vx,1);
    // SIM9 AirBrake is ONE IMMEDIATE paid speed+vertical impulse, not 800ms
    // of held drag or reduced gravity. An early brake runs on the first actual
    // closing/armed step after the initial observation; only that tick counts.
    const brakeWindow=nowMs < brakeBeforeMs;
    let airbrakeKicked=false;
    if(i>0 && brakeWindow && brakeKicks===0){
      const kicked=airBrakeKickStep({vx,vy,atmosphereDensity:snap.atmosphereDensity,
        decelFraction:PHYSICS.airBrakeDecel,
        liftBudgetFraction:TUNING.airBrakeLiftBudgetFraction,
        upwardRatio:TUNING.airBrakeKickUpRatio,
        maxUpPxS:TUNING.airBrakeKickUpCapPxS,
        liftMul:fx.airbrakeLiftMul});
      vx=kicked.vx; vy=kicked.vy;
      if(kicked.spentSpeedPxS>0){brakeKicks++;brakeSpentSpeedPxS+=kicked.spentSpeedPxS;airbrakeKicked=true;}
    }
    const tank=canopyFuelStep(fuel,!brakeWindow && nowMs>=canopyStartMs,true,DT*1000,PHYSICS.parachuteDurationMs*fx.canopyFuelMul);
    fuel=tank.fuelMs;
    const wind=aerodynamicStep({vx,vy,relativeAirX:snap.relativeAirX,
      atmosphereDensity:snap.atmosphereDensity,proximity01:snap.proximity01,
      parachute:tank.deployed,stepMs:DT*1000});
    vx+=wind.dvx;
    vy+=PHYSICS.gravityPxS2*(tank.deployed?PHYSICS.parachuteGravityMul:1)*DT+wind.dvy;
    x+=vx*DT; y+=vy*DT; wall.advance(DT*1000,x);
    const state=wall.state(x,vx,1);
    minGap=Math.min(minGap,state.gapPx);
    maxGap=Math.max(maxGap,state.gapPx);
    maxSpeed=Math.max(maxSpeed,vx);
    airMs=(i+1)*DT*1000;
    const award=tracker.update({active:state.active,gapPx:state.gapPx,playerX:x,
      nowMs:airMs,grounded:false,crashed:state.gapPx<=0,
      canopyDeployed:tank.deployed,airbrakeKicked,
      relativeAirX:state.relativeAirX,atmosphereDensity:1,
      wallSpeedPxS:state.wallSpeedPxS,sledVelocityXPxS:state.sledVelocityXPxS});
    if(award) awards.push(award);
    if(state.gapPx<=0 || (i>5 && y>=0)) break;
  }
  return {wallSpeed,closing,rank:Object.values(ranks)[0]||0,brakeBeforeMs,
    brakeKicks,brakeSpentSpeedPxS:fmt(brakeSpentSpeedPxS),flightMs:fmt(airMs),minGap:fmt(minGap),maxGap:fmt(maxGap),finalGap:fmt(x-wall.wallX),
    finalVX:fmt(vx),maxSpeed:fmt(maxSpeed),fuelRemaining:fmt(fuel),
    scored:awards.length,points:awards.reduce((a,b)=>a+b.points,0)};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const cases=[];
for(const wallSpeed of [300,600,900])
 for(const rank of [0,10,30])
  for(const brakeBeforeMs of [0,160]) {
   const ranks=rank===0?{}:Object.fromEntries(['hop','speed','canopy','airbrake','bsodGrace'].map(k=>[k,rank]));
   cases.push(scenario({wallSpeed,closing:30,gap:230,ranks,brakeBeforeMs}));
  }
console.log(JSON.stringify({
  warning:'Reduced-order OPTIMISTIC envelope, not a real-game success rate. Includes shipped pure physics, ignores terrain and extra drag.',
  baseline:{gravity:PHYSICS.gravityPxS2,hopPxS:360,canopyMs:PHYSICS.parachuteDurationMs,
    scorer:BsodBluffTracker.name},cases},null,2));
}
