#!/usr/bin/env node
/**
 * Release acceptance: exact deployed HTML+JS against a local built tree,
 * then actual PUBLIC Chromium gameplay/music checks in isolated contexts.
 *
 * Prerequisites: an already built Vite dist and local Playwright installed.
 * No build, deployment, account mutation, or GitHub changes are performed.
 * Usage:
 *   node tools/qa/live-acceptance.mjs
 *   node tools/qa/live-acceptance.mjs --dist /path/to/full-worktree/dist
 *   node tools/qa/live-acceptance.mjs --url https://simulate.sledhead.ing/
 *
 * Intentionally fail-fast and NO automatic retries: an intermittent browser
 * failure is data for debugging, not something to conceal as green.
 */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
function option(name,fallback){
 const n=args.indexOf(name);
 if(n<0)return fallback;
 if(!args[n+1]||args[n+1].startsWith('--'))throw Error(`Missing value for ${name}`);
 return args[n+1];
}
const target=option('--url','https://simulate.sledhead.ing/');
const built=path.resolve(option('--dist',path.join(root,'dist')));
if(!/^https:\/\//.test(target))throw Error('Public smoke must use HTTPS');
const stages=[
 ['DEPLOYMENT_BYTES','tools/qa/verify-live-deploy.mjs',['--url',target,'--dist',built]],
 ['DAILY_CLASSIC_DRAFT','tools/daily-draft-browser-smoke.mjs',[]],
 ['REAL_OGG_MUSIC_LAB','tools/music/smoke-lab-waveform-mixer-game.mjs',[]],
 ['REAL_GAMEOVER_COUNTIN_RETRY','tools/fatal-death-countin-real-retry-audio-browser-smoke.mjs',[]],
 ['FIVE_UNINTERRUPTED_GYM_BLUFFS','tools/bsod-gym-real-five-flight-browser-smoke.mjs',[]],
];
for(const [label,rel,extra] of stages){
 console.log(`\n[PUBLIC QA] ${label} — start`);
 const result=spawnSync(process.execPath,[path.join(root,rel),...extra],{
  cwd:root,env:{...process.env,GAME_URL:target},encoding:'utf8',timeout:120000,
  maxBuffer:12*1024*1024,
 });
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error||result.status!==0){
  console.error(`[PUBLIC QA] ${label} — FAIL`,result.error?.message||`exit ${result.status}, signal ${result.signal}`);
  process.exitCode=1;
  break;
 }
 console.log(`[PUBLIC QA] ${label} — PASS`);
}
if(!process.exitCode)console.log('\nPUBLIC_RELEASE_ACCEPTANCE_ALL_FIVE_GATES_PASS');
