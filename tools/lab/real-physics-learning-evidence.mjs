/** #454: developer-only learning experiment evidence gate.
 * NOT a trainable model ABI, no in-game AI, progression, or Verified rights.
 * Inputs must be genuine independent `tools/sim/run.mjs` RunScene reports.
 */
export const LEARNING_PILOT_ABI=1;
export const DEFAULT_HOP_LEAD_MS=380;
const validLead=x=>Number.isSafeInteger(x)&&x>=150&&x<=750&&x%10===0;
const validSeed=s=>typeof s==='string'&&s.length>=1&&s.length<=64&&
 /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(s);
const check=(value,message)=>{if(!value)throw new TypeError(message);};
const rounded=x=>Math.round(x*1000)/1000;
const meanRows=rows=>rounded(rows.reduce((sum,r)=>sum+r.distanceM,0)/rows.length);
const measuredRows=(rows,seeds,maxDistanceM)=>
 Array.isArray(rows)&&rows.length===seeds.length&&rows.every((r,i)=>
  r.seed===seeds[i]&&typeof r.distanceM==='number'&&
  Number.isFinite(r.distanceM)&&r.distanceM>=0&&r.distanceM<=maxDistanceM+10&&
  typeof r.endReason==='string'&&r.endReason.length>0&&r.endReason.length<=80);

export function validateLearningPlan({candidates,trainingSeeds,holdoutSeeds,maxDistanceM,maxSeconds}={}){
 check(Array.isArray(candidates)&&candidates.length>=2&&candidates.length<=8&&
  candidates.every(validLead)&&new Set(candidates).size===candidates.length&&
  candidates.includes(DEFAULT_HOP_LEAD_MS),'invalid or missing fixed baseline hop policies');
 check(Array.isArray(trainingSeeds)&&trainingSeeds.length>=2&&trainingSeeds.length<=12&&
  trainingSeeds.every(validSeed)&&new Set(trainingSeeds).size===trainingSeeds.length,
 'invalid or duplicate training seeds');
 check(Array.isArray(holdoutSeeds)&&holdoutSeeds.length>=2&&holdoutSeeds.length<=12&&
  holdoutSeeds.every(validSeed)&&new Set(holdoutSeeds).size===holdoutSeeds.length&&
  holdoutSeeds.every(s=>!trainingSeeds.includes(s)),
 'holdout seeds must be distinct from all training seeds');
 check(Number.isSafeInteger(maxDistanceM)&&maxDistanceM>=200&&maxDistanceM<=5000&&
  Number.isSafeInteger(maxSeconds)&&maxSeconds>=5&&maxSeconds<=120,
 'invalid bounded real-game evaluation horizon');
 return Object.freeze({candidates:Object.freeze([...candidates]),
  trainingSeeds:Object.freeze([...trainingSeeds]),holdoutSeeds:Object.freeze([...holdoutSeeds]),
  maxDistanceM,maxSeconds});
}

/** Verify output schema + exact seed/parameter/settings binding before fitness.
 * Never import game rewards/score/records: only physical distance + end cause.
 */
export function inspectRunSceneTrial(raw,{leadMs,seeds,maxDistanceM,maxSeconds}={}){
 check(validLead(leadMs)&&Array.isArray(seeds)&&seeds.length>0&&
  seeds.every(validSeed),'invalid trial descriptor');
 check(raw?.args?.policy==='hop'&&raw?.params?.hopLeadMs===leadMs&&
  raw.args.maxM===maxDistanceM&&raw.args.maxSec===maxSeconds&&
  raw.args.seeds===seeds.length&&Array.isArray(raw.results)&&
  raw.results.length===seeds.length,'trial source/settings mismatch');
 const bySeed=new Map();
 for(const r of raw.results){
  check(validSeed(r?.seed)&&seeds.includes(r.seed)&&!bySeed.has(r.seed),
   'missing, duplicated or foreign seed in real RunScene trial');
  check(typeof r.distM==='number'&&Number.isFinite(r.distM)&&
   r.distM>=0&&r.distM<=maxDistanceM+10&&
   typeof r.endReason==='string'&&r.endReason.length>0&&r.endReason.length<=80,
   'invalid physical outcome');
  bySeed.set(r.seed,Object.freeze({seed:r.seed,distanceM:rounded(r.distM),
   endReason:r.endReason}));
 }
 check(bySeed.size===seeds.length,'incomplete genuine RunScene trial');
 return Object.freeze({leadMs,rows:Object.freeze(seeds.map(seed=>bySeed.get(seed))),
  meanDistanceM:rounded(seeds.reduce((a,s)=>a+bySeed.get(s).distanceM,0)/seeds.length)});
}

export function selectTrainingChampion({plan,trainingTrials}={}){
 check(plan&&Array.isArray(trainingTrials)&&trainingTrials.length===plan.candidates.length,
  'complete genuine train candidates required');
 const trials=new Map();
 for(const trial of trainingTrials){
  check(plan.candidates.includes(trial?.leadMs)&&!trials.has(trial.leadMs)&&
   measuredRows(trial.rows,plan.trainingSeeds,plan.maxDistanceM)&&
   trial.meanDistanceM===meanRows(trial.rows),'incomplete training evidence');
  trials.set(trial.leadMs,trial);
 }
 check(trials.size===plan.candidates.length,'missing candidate');
 // Deterministic tie-breaking: baseline wins ties, else nearest to baseline,
 // then lowest hop lead. No peeking at held-out results while choosing.
 const ordered=[...trials.values()].sort((a,b)=>
  b.meanDistanceM-a.meanDistanceM||
  Math.abs(a.leadMs-DEFAULT_HOP_LEAD_MS)-Math.abs(b.leadMs-DEFAULT_HOP_LEAD_MS)||
  a.leadMs-b.leadMs);
 const champion=ordered[0];
 return Object.freeze({baselineLeadMs:DEFAULT_HOP_LEAD_MS,
  winnerLeadMs:champion.leadMs,
  trainingMeanM:champion.meanDistanceM,
  baselineTrainingMeanM:trials.get(DEFAULT_HOP_LEAD_MS).meanDistanceM,
  selectedUsing:'training-seeds-only',
  candidateMeans:Object.freeze(plan.candidates.map(leadMs=>Object.freeze({
   leadMs,meanDistanceM:trials.get(leadMs).meanDistanceM})))});
}

export function evaluateHeldout({plan,selection,baselineTrial,championTrial}={}){
 check(plan&&selection?.selectedUsing==='training-seeds-only'&&
  selection.baselineLeadMs===DEFAULT_HOP_LEAD_MS&&
  plan.candidates.includes(selection.winnerLeadMs),'champion was not selected on training data');
 check(baselineTrial?.leadMs===DEFAULT_HOP_LEAD_MS&&
  championTrial?.leadMs===selection.winnerLeadMs,'wrong heldout policies');
 for(const t of [baselineTrial,championTrial]){
  check(measuredRows(t?.rows,plan.holdoutSeeds,plan.maxDistanceM)&&
   t.meanDistanceM===meanRows(t.rows),
  'heldout seed evidence mismatched');
 }
 const meanChangeM=rounded(championTrial.meanDistanceM-baselineTrial.meanDistanceM);
 const perSeed=Object.freeze(plan.holdoutSeeds.map((seed,i)=>Object.freeze({seed,
  baselineDistanceM:baselineTrial.rows[i].distanceM,
  championDistanceM:championTrial.rows[i].distanceM,
  changeM:rounded(championTrial.rows[i].distanceM-baselineTrial.rows[i].distanceM)})));
 const cappedBoth=baselineTrial.rows.every(r=>r.distanceM>=plan.maxDistanceM-0.05)&&
  championTrial.rows.every(r=>r.distanceM>=plan.maxDistanceM-0.05);
 // Engineering-only visibility threshold, NOT significance or owner approval:
 // a fractional-metre gain on two seeds must NEVER render as success.
 const minVisibleGainM=rounded(Math.max(5,baselineTrial.meanDistanceM*0.01));
 const verdict=selection.winnerLeadMs===DEFAULT_HOP_LEAD_MS?'baseline-retained':
  cappedBoth?'ceiling-limited':meanChangeM>=minVisibleGainM?
   'exploratory-heldout-gain':meanChangeM>0?'inconclusive-small-gain':
  meanChangeM<0?'observed-heldout-regression':'no-heldout-gain';
 return Object.freeze({verdict,meanChangeM,
  minVisibleGainM,baselineMeanM:baselineTrial.meanDistanceM,
  championMeanM:championTrial.meanDistanceM,perSeed,
  confidence:'exploratory-only; no statistical or low-end-device claim',
  progressionCredit:false,verified:false,modelAdmission:false});
}
