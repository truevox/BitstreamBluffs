/** #453: conservative, explicitly observed worker ADMISSION policy for Lab.
 * This is independent of Phaser, browser globals, money, sim RNG and clocks.
 * Caller owns entitlement validation and actual active-worker accounting.
 * No worker, reward, entitlement, capability or temperature is synthesized.
 */
export const LAB_RESOURCE_GOVERNOR_ABI=1;
export const LAB_MAX_WORKERS=32;

const validInt=n=>Number.isSafeInteger(n)&&n>=0&&n<=LAB_MAX_WORKERS;
const validActive=n=>Number.isSafeInteger(n)&&n>=0;
const positiveFinite=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const validBattery=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
const PRESSURES=new Set(['unknown','nominal','moderate','serious','critical']);

/**
 * The caller MUST supply its authorization cap and its truthful active count.
 * The budget is an admission ceiling, NOT currently running threads and NOT
 * a paid-slot entitlement. In-flight work is not preemptively terminated.
 * Unknown visibility blocks admission; unknown CPU/memory each cap at one.
 */
export function evaluateLabWorkerBudget({
 authorizedSlots,requestedSlots,activeWorkers,rideActive,schoolPreset=false,
 visibility='unknown',hardwareConcurrency,deviceMemoryGiB,
 batteryLevel,batteryCharging,pressure='unknown',
}={}){
 if(!validInt(authorizedSlots)||!validInt(requestedSlots)||!validActive(activeWorkers)||
  typeof rideActive!=='boolean'||typeof schoolPreset!=='boolean'||
  !['visible','hidden','unknown'].includes(visibility)||!PRESSURES.has(pressure)||
  (batteryCharging!==undefined&&typeof batteryCharging!=='boolean'))
  throw new TypeError('Invalid Lab resource governor contract');

 const hasCpu=positiveFinite(hardwareConcurrency)&&hardwareConcurrency<=1024;
 const hasMem=positiveFinite(deviceMemoryGiB)&&deviceMemoryGiB<=2048;
 const hasBattery=validBattery(batteryLevel)&&typeof batteryCharging==='boolean';
 // Browser deviceMemory is coarse (or absent): treat as a *hint*, not free RAM.
 const cpuCap=hasCpu?Math.max(1,Math.min(LAB_MAX_WORKERS,Math.floor(hardwareConcurrency)-1)):1;
 const memoryCap=!hasMem?1:deviceMemoryGiB<=2?1:deviceMemoryGiB<=4?2:
  deviceMemoryGiB<=8?3:deviceMemoryGiB<=16?6:12;
 let limit=Math.min(authorizedSlots,requestedSlots,cpuCap,memoryCap);
 const reasons=[];
 if(limit<requestedSlots)reasons.push('capacity-or-entitlement');
 if(schoolPreset){
  if(limit>1)reasons.push('school-preset');
  limit=Math.min(limit,1);
 }
 if(pressure==='moderate'){
  if(limit>1)reasons.push('resource-pressure');
  limit=Math.min(limit,1);
 }
 if(hasBattery&&!batteryCharging&&batteryLevel<=0.35){
  if(batteryLevel<=0.20){
   reasons.push('battery-low');limit=0;
  }else{
   if(limit>1)reasons.push('battery-saver');
   limit=Math.min(limit,1);
  }
 }
 // Prioritize the actual user interaction over background training.
 if(rideActive){reasons.push('ride-priority');limit=0;}
 if(visibility!=='visible'){reasons.push(visibility==='hidden'?'tab-hidden':'visibility-unknown');limit=0;}
 if(pressure==='serious'||pressure==='critical'){
  reasons.push('resource-pressure-stop');limit=0;
 }
 const startsAvailable=Math.max(0,limit-activeWorkers);
 return Object.freeze({
  abi:LAB_RESOURCE_GOVERNOR_ABI,
  authorizedSlots,requestedSlots,admissionLimit:limit,
  activeWorkers,startsAvailable,draining:activeWorkers>limit,
  admission:startsAvailable>0?'allow':'hold',
  reasons:Object.freeze(reasons),
  observations:Object.freeze({
   cpu:hasCpu?'reported':'unknown',memory:hasMem?'reported':'unknown',
   battery:hasBattery?'reported':'unknown',visibility,
   pressure:pressure==='unknown'?'not-reported':'reported',
  }),
 });
}

/** Read ONLY genuine browser-exposed hints; absence/error remains unknown.
 * Accept explicit refs for DOM-free tests and non-browser callers. Temperature
 * cannot be inferred from CPU count, battery, frame rate or deviceMemory.
 */
export async function readBrowserLabSignals({navigatorRef,documentRef}={}){
 const n=navigatorRef,d=documentRef;
 let visibility='unknown';
 try{
  if(d?.visibilityState==='visible'||d?.visibilityState==='hidden')visibility=d.visibilityState;
  else if(d?.hidden===true)visibility='hidden';
  else if(d?.hidden===false)visibility='visible';
 }catch{ /* unknown */ }
 let hardwareConcurrency,deviceMemoryGiB,batteryLevel,batteryCharging;
 try{hardwareConcurrency=n?.hardwareConcurrency;}catch{/* unsupported */}
 try{deviceMemoryGiB=n?.deviceMemory;}catch{/* unsupported */}
 let batterySource='unsupported';
 try{
  if(typeof n?.getBattery==='function'){
   const b=await n.getBattery();
   if(validBattery(b?.level)&&typeof b?.charging==='boolean'){
    batteryLevel=b.level;batteryCharging=b.charging;batterySource='reported';
   }else batterySource='unavailable';
  }
 }catch{batterySource='unavailable';}
 return Object.freeze({visibility,hardwareConcurrency,deviceMemoryGiB,
  batteryLevel,batteryCharging,batterySource,pressure:'unknown'});
}
