#!/usr/bin/env node
/** #454: actual RunScene hop-policy parameter learning pilot, NOT player AI.
 * Training candidate selection uses only the training seeds; the chosen frozen
 * parameter is evaluated ONCE on disjoint held-out seeds. No scripted wins.
 * Run `node tools/lab/first-real-learning-pilot.mjs --out /tmp/lab-pilot.json`
 * Requires local Chromium and original tools/sim/run.mjs. Developer QA only.
 */
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SIM_REVISION} from '../../src/systems/replay/ruleset.js';
import {LEARNING_PILOT_ABI,DEFAULT_HOP_LEAD_MS,validateLearningPlan,
 inspectRunSceneTrial,selectTrainingChampion,evaluateHeldout} from './real-physics-learning-evidence.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
function options(argv){
 const values=Object.create(null);
 const accepted=new Set(['candidates','training','holdout','maxM','maxSec','workers','out']);
 for(let i=0;i<argv.length;i+=2){
  const opt=argv[i]?.replace(/^--/,'');
  if(!argv[i]?.startsWith('--')||!accepted.has(opt)||!argv[i+1]||values[opt]!==undefined)
   throw new TypeError('Unrecognized, repeated or missing pilot argument: '+argv[i]);
  values[opt]=argv[i+1];
 }
 const number=x=>x===undefined?undefined:Number(x);
 const plan=validateLearningPlan({
  candidates:(values.candidates??'280,380,480').split(',').map(Number),
  trainingSeeds:(values.training??'pilot-train-01,pilot-train-02').split(','),
  holdoutSeeds:(values.holdout??'pilot-held-01,pilot-held-02').split(','),
  maxDistanceM:number(values.maxM)??900,maxSeconds:number(values.maxSec)??35,
 });
 const workers=number(values.workers)??2;
 if(!Number.isInteger(workers)||workers<1||workers>4)
  throw new TypeError('pilot workers must be 1..4');
 return {plan,workers,out:values.out};
}
function runSubprocess(args,{timeoutMs=240000}={}){
 return new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,args,{cwd:root,env:{...process.env},
   stdio:['ignore','pipe','pipe']});
  let out='',err='',ended=false;
  const watchdog=setTimeout(()=>{if(!ended){p.kill('SIGKILL');}},timeoutMs);
  p.stdout.on('data',b=>{out=(out+b.toString()).slice(-16000);});
  p.stderr.on('data',b=>{err=(err+b.toString()).slice(-16000);});
  p.on('error',e=>{ended=true;clearTimeout(watchdog);reject(e);});
  p.on('close',(code,signal)=>{
   ended=true;clearTimeout(watchdog);
   if(code!==0)reject(Error('Real RunScene sim failed: '+JSON.stringify({code,signal,stderr:err.slice(-3500),stdout:out.slice(-1500)})));
   else resolve({out,err});
  });
 });
}
async function main(){
 const {plan,workers,out}=options(process.argv.slice(2));
 const temp=await mkdtemp(join(tmpdir(),'bsb-first-lab-learning-'));
 const started=Date.now();
 let simulatedEpisodes=0;
 try{
  const trial=async(leadMs,seeds,role)=>{
   const path=join(temp,role+'-'+leadMs+'.json');
   console.error('REAL_RUNSCENE',role,'hopLeadMs='+leadMs,'seeds='+seeds.join(','));
   await runSubprocess(['tools/sim/run.mjs','--seeds',seeds.join(','),
    '--policy','hop','--hopLeadMs',String(leadMs),
    '--maxM',String(plan.maxDistanceM),'--maxSec',String(plan.maxSeconds),
    '--workers',String(workers),'--quiet','--out',path],
    {timeoutMs:Math.max(240000,plan.maxSeconds*10000)});
   const raw=JSON.parse(await readFile(path,'utf8'));
   const t=inspectRunSceneTrial(raw,{leadMs,seeds,maxDistanceM:plan.maxDistanceM,
    maxSeconds:plan.maxSeconds});
   simulatedEpisodes+=seeds.length;
   console.error('MEASURED',role,'lead='+leadMs,'meanM='+t.meanDistanceM);
   return t;
  };
  const training=[];
  for(const leadMs of plan.candidates)training.push(await trial(leadMs,plan.trainingSeeds,'training'));
  const selection=selectTrainingChampion({plan,trainingTrials:training});
  // ONLY NOW may the runner measure holdout, with winner already frozen.
  const baseline=await trial(DEFAULT_HOP_LEAD_MS,plan.holdoutSeeds,'holdout-baseline');
  const champion=selection.winnerLeadMs===DEFAULT_HOP_LEAD_MS?baseline:
   await trial(selection.winnerLeadMs,plan.holdoutSeeds,'holdout-champion');
  const evaluation=evaluateHeldout({plan,selection,baselineTrial:baseline,championTrial:champion});
  const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const dirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim().length>0;
  const report={kind:'DEVELOPER-ONLY-real-RunScene-hop-policy-search',abi:LEARNING_PILOT_ABI,
   simRevision:SIM_REVISION,gitHead:commit,sourceClean:!dirty,
   simulation:'Real Phaser/Matter tools/sim/run.mjs; NOT worker parity-certified training SimWorld',
   plan,selection,evaluation,training,heldout:[baseline,...(champion===baseline?[]:[champion])],
   observedWallMs:Date.now()-started,simulatedEpisodes,
   safety:{frozenWinnerBeforeHoldout:true,trainingSeedsSeparate:true,
    rewardsGranted:false,verified:false,publicTraining:false,
    noClaimOfChromebookPerformance:true,noClaimOfTwoMinuteLearning:true,
    noStatisticalSignificanceClaim:true}};
  if(out)await writeFile(resolve(out),JSON.stringify(report,null,2)+'\n','utf8');
  console.log('REAL_RUNSCENE_FIRST_LEARNING_PILOT',JSON.stringify({
   source:commit,sourceClean:!dirty,simRevision:SIM_REVISION,
   selection,evaluation,simulatedEpisodes,observedWallMs:report.observedWallMs,
   reportFile:out||null}));
 }finally{await rm(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error('LAB_PILOT_FAILED',e.message);process.exitCode=1;});
