#!/usr/bin/env node
/**
 * Developer-only isolated savestate diagnostic gate, not player Heavy Mode.
 * Build the exact checkout into a private temporary directory, serve only on
 * numeric loopback, run both strict fixtures, preserve the JSON receipt.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const repeatArg=args[0]==='--repeat-ticks'&&args.length===2&&/^[1-9][0-9]*$/.test(args[1])&&Number(args[1])<=120;
const boundaryArg=args.length===1&&args[0]==='--repeat-boundaries';
const movingArg=args.length===1&&args[0]==='--repeat-moving';
const naturalArg=['--natural-run','--natural-probe','--natural-terminal'].includes(args[0])&&(args.length===1||(args.length===3&&args[1]==='--natural-limit'&&/^[1-9][0-9]*$/.test(args[2])&&Number(args[2])>(args[0]==='--natural-terminal'?960:0)&&Number(args[2])<=12000));
if (!(args.length===0||(args.length===1&&args[0]==='--full')||repeatArg||boundaryArg||movingArg||naturalArg)) {
  console.error('Usage: npm run gate:heavy -- [--full | --repeat-ticks 1..120 | --repeat-boundaries | --repeat-moving | --natural-run [--natural-limit N] | --natural-probe [--natural-limit N] | --natural-terminal [--natural-limit N]]');
  console.error('Natural limits: 1..12000; terminal window: 961..12000');
  process.exit(2);
}
const full = args[0] === '--full';
const env = { ...process.env };
// Refuse external targets, filters and stale/cached output for this gate.
for (const key of ['GAME_URL','ONLY','EXACT_ONLY']) delete env[key];
const reportDir = mkdtempSync(path.join(tmpdir(),'bsb-heavy-receipt-'));
const output = path.join(reportDir,'receipt.json');
const work = mkdtempSync(path.join(tmpdir(),'bsb-heavy-build-'));
let server;
try {
  const checked = spawnSync(process.execPath,['tools/ruleset/build-ruleset.mjs','--check-identity'],
    {cwd:root,env,stdio:'inherit'});
  if (checked.error || checked.status !== 0) throw new Error('build identity check failed');
  await build({root,base:'/',build:{outDir:work,emptyOutDir:true}});
  server=await preview({root,base:'/',build:{outDir:work},
    preview:{host:'127.0.0.1',port:0,strictPort:true,open:false}});
  const address=server.httpServer.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1')
    throw new Error('preview failed to bind numeric loopback');
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[
    'tools/savestate-experiment/browser-experiment.mjs','--strict-suffix',
    ...(!full?['--quick']:[]),...(repeatArg||boundaryArg||movingArg||naturalArg?args:[]),'--json',output
  ],{cwd:root,env:{...env,GAME_URL:'http://127.0.0.1:'+address.port+'/'},
    stdio:'inherit'});
    const timer=setTimeout(()=>child.kill('SIGTERM'),naturalArg?Math.max(300000,(Number(args[2])||4800)*12000):repeatArg?Math.max(300000,Number(args[1])*30000):boundaryArg?480000:300000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
  });
  if (result.code !== 0) throw new Error('strict diagnostic gate exited '+(result.signal||result.code));
  console.log((args[0]==='--natural-probe'?'HEAVY_REFERENCE_ONLY_PASS':args[0]==='--natural-terminal'?'HEAVY_TERMINAL_WINDOW_PASS':'HEAVY_DIAGNOSTIC_PASS')+' receipt='+output);
} catch(e) {
  console.error('HEAVY_DIAGNOSTIC_FAIL:',e.message,'receipt='+output);
  process.exitCode=1;
} finally {
  try {
    if(server)await new Promise((resolve,reject)=>server.httpServer.close(err=>err?reject(err):resolve()));
  } finally {
    rmSync(work,{recursive:true,force:true});
  }
}
