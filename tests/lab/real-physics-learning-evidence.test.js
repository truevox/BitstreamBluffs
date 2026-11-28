import {validateLearningPlan,inspectRunSceneTrial,selectTrainingChampion,evaluateHeldout,
 DEFAULT_HOP_LEAD_MS,LEARNING_PILOT_ABI} from '../../tools/lab/real-physics-learning-evidence.mjs';
const plan=()=>validateLearningPlan({candidates:[280,380,480],trainingSeeds:['train-A','train-B'],
 holdoutSeeds:['held-C','held-D'],maxDistanceM:900,maxSeconds:35});
const raw=(seedDist,leadMs,seeds,max=900,seconds=35)=>({args:{policy:'hop',seeds:seeds.length,maxM:max,maxSec:seconds},
 params:{hopLeadMs:leadMs},results:seeds.map((seed,i)=>({seed,distM:seedDist[i],endReason:'crash:hazard',score:999999}))});
const tr=(p,lead,ds,seeds=p.trainingSeeds)=>inspectRunSceneTrial(raw(ds,lead,seeds),
 {leadMs:lead,seeds,maxDistanceM:p.maxDistanceM,maxSeconds:p.maxSeconds});
test('bounded plan cannot leak training seeds into holdout or omit true baseline',()=>{
 expect(LEARNING_PILOT_ABI).toBe(1);expect(DEFAULT_HOP_LEAD_MS).toBe(380);
 expect(()=>validateLearningPlan({...plan(),holdoutSeeds:['train-A','held-D']})).toThrow();
 expect(()=>validateLearningPlan({...plan(),candidates:[280,480]})).toThrow();
 expect(()=>validateLearningPlan({...plan(),trainingSeeds:['train-A','train-A']})).toThrow();
 expect(()=>validateLearningPlan({...plan(),trainingSeeds:['train-A','a,b']})).toThrow();
 expect(()=>validateLearningPlan({...plan(),maxSeconds:1000})).toThrow();
});
test('trial fingerprint binds real source policy, episode horizon, seed identity, and score',()=>{
 const p=plan(),r=tr(p,380,[170.555,817.123]);
 expect(r.meanDistanceM).toBe(493.839);expect(r.rows[0].distanceM).toBe(170.555);
 expect(r.rows[0]).not.toHaveProperty('score');
 for(const patch of [
  {args:{policy:'handsOff',seeds:2,maxM:900,maxSec:35}},
  {args:{policy:'hop',seeds:2,maxM:900,maxSec:25}},
  {params:{hopLeadMs:280}},
  {results:[{seed:'train-A',distM:10,endReason:'crash'},{seed:'train-A',distM:20,endReason:'crash'}]},
  {results:[{seed:'train-A',distM:-1,endReason:'crash'},{seed:'train-B',distM:20,endReason:'crash'}]},
 ]){
  const t={...raw([10,20],380,p.trainingSeeds),...patch};
  expect(()=>inspectRunSceneTrial(t,{leadMs:380,seeds:p.trainingSeeds,
   maxDistanceM:900,maxSeconds:35})).toThrow();
 }
});
test('deterministic champion selection never sees heldout, baseline wins tie',()=>{
 const p=plan();const a=tr(p,280,[500,500]),b=tr(p,380,[500,500]),c=tr(p,480,[510,510]);
 const selected=selectTrainingChampion({plan:p,trainingTrials:[a,c,b]});
 expect(selected).toMatchObject({winnerLeadMs:480,baselineLeadMs:380,
  selectedUsing:'training-seeds-only'});
 const tie=selectTrainingChampion({plan:p,trainingTrials:[a,b,tr(p,480,[500,500])]});
 expect(tie.winnerLeadMs).toBe(380);
});
test('heldout regression is honestly reported and never credited as learned player progress',()=>{
 const p=plan(),selection=selectTrainingChampion({plan:p,trainingTrials:[
  tr(p,280,[200,300]),tr(p,380,[300,300]),tr(p,480,[700,750])]});
 const baseline=tr(p,380,[600,700],p.holdoutSeeds),champ=tr(p,480,[200,250],p.holdoutSeeds);
 const r=evaluateHeldout({plan:p,selection,baselineTrial:baseline,championTrial:champ});
 expect(r.verdict).toBe('observed-heldout-regression');expect(r.meanChangeM).toBe(-425);
 expect(r.verified).toBe(false);expect(r.progressionCredit).toBe(false);
 expect(r.modelAdmission).toBe(false);
 expect(r.perSeed).toHaveLength(2);
});
test('real measured heldout gain is explicitly exploratory, not fake validation',()=>{
 const p=plan(),sel=selectTrainingChampion({plan:p,trainingTrials:[
  tr(p,280,[400,400]),tr(p,380,[300,300]),tr(p,480,[200,200])]});
 const baseline=tr(p,380,[300,400],p.holdoutSeeds),champ=tr(p,280,[350,500],p.holdoutSeeds);
 expect(evaluateHeldout({plan:p,selection:sel,baselineTrial:baseline,
  championTrial:champ})).toMatchObject({verdict:'exploratory-heldout-gain',
  meanChangeM:75,verified:false,progressionCredit:false});
});
test('max-distance ceiling cannot be reported as learning and unsplit results are refused',()=>{
 const p=plan(),sel=selectTrainingChampion({plan:p,trainingTrials:[
  tr(p,280,[900,900]),tr(p,380,[500,500]),tr(p,480,[300,400])]});
 const baseline=tr(p,380,[900,900],p.holdoutSeeds),champ=tr(p,280,[900,900],p.holdoutSeeds);
 expect(evaluateHeldout({plan:p,selection:sel,baselineTrial:baseline,
  championTrial:champ}).verdict).toBe('ceiling-limited');
 expect(()=>evaluateHeldout({plan:p,selection:sel,baselineTrial:baseline,
  championTrial:tr(p,280,[100,200])})).toThrow();
});


test('real simulation can overshoot a distance ceiling by one fixed tick without falsifying the result',()=>{
 const p=plan();
 expect(tr(p,280,[900.4,172.2]).rows[0].distanceM).toBe(900.4);
 expect(()=>tr(p,280,[1000,172.2])).toThrow();
});


test('fractional held-out differences are honestly inconclusive, never a learning win',()=>{
 const p=plan(),sel=selectTrainingChampion({plan:p,trainingTrials:[
  tr(p,280,[900,175]),tr(p,380,[817,170]),tr(p,480,[800,160])]});
 const baseline=tr(p,380,[878.8,900],p.holdoutSeeds);
 const champion=tr(p,280,[879.9,900],p.holdoutSeeds);
 const r=evaluateHeldout({plan:p,selection:sel,baselineTrial:baseline,championTrial:champion});
 expect(r).toMatchObject({verdict:'inconclusive-small-gain',meanChangeM:0.55,
  verified:false,progressionCredit:false});
 expect(r.minVisibleGainM).toBeGreaterThan(0.55);
});
test('forged candidate means cannot alter champion selection or heldout verdict',()=>{
 const p=plan(),baseline=tr(p,380,[300,300]),alt=tr(p,280,[400,400]),third=tr(p,480,[200,200]);
 expect(()=>selectTrainingChampion({plan:p,trainingTrials:[baseline,{...alt,meanDistanceM:900},third]})).toThrow();
 const sel=selectTrainingChampion({plan:p,trainingTrials:[baseline,alt,third]});
 const held=tr(p,380,[300,400],p.holdoutSeeds),win=tr(p,280,[400,500],p.holdoutSeeds);
 expect(()=>evaluateHeldout({plan:p,selection:sel,baselineTrial:held,
  championTrial:{...win,meanDistanceM:900}})).toThrow();
});
