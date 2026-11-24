#!/usr/bin/env node
/**
 * EXPERIMENTAL / NON-PRODUCTION (issue #119 Phase 1). Savestate equivalence in the REAL built game.
 *
 *   npm run build && npx vite preview --port 8414 --strictPort &
 *   GAME_URL=http://localhost:8414/ node tools/savestate-experiment/browser-experiment.mjs [--json out.json] [--quick]
 *
 * Every case uses two isolated browser contexts (fresh storage, fresh Phaser game, fresh Matter world):
 *   A  plays ticks 1..K uninterrupted, then a diagnostic snapshot is taken (JSON round-trip through Node).
 *   B  is a FRESH RunScene with the same seed/config held at tick 0; the snapshot is restored at a LEVEL, then
 *      A and B are stepped in lockstep K+1..N with the identical tick-indexed input tape.
 * Per tick both pages report diagnostic sub-system digests (non-authoritative; #152 owns real hashes); the
 * first divergent tick and the sub-systems that differ there are reported.
 *
 * Frames are stepped with game.step(t, 1000/120): exactly one sim tick per display frame, so a frame boundary is
 * a tick boundary and renderFrame still runs every tick (the #155 camera read stays in play).
 *
 * Fixtures:
 *   contact  seed SAVE119, scramble forced on (RNG stream exercised), push/hop/tilt/heli/tuck tape on terrain.
 *   hazard   seed SAVE119H@2047 (all biomes), sled placed at x=107000 before tick 1 (a Gear Gate cluster: timed
 *            moving hazards), Kodiaks forced on (two packs spawn), 99 shield charges so hits are absorbed, not fatal.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { decodePad } from '../../src/systems/ghost/GhostTape.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL_ = process.env.GAME_URL || 'http://localhost:8414/';
const EXE = process.env.CHROMIUM_PATH;
const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');
const STRICT = argv.includes('--strict-suffix');
const repeatFlag=argv.indexOf('--repeat-ticks');
const BOUNDARY=argv.includes('--repeat-boundaries');
const MOVING=argv.includes('--repeat-moving');
if(MOVING&&(!STRICT||BOUNDARY||repeatFlag!==-1))throw new Error('--repeat-moving requires --strict-suffix and no other repeat mode');
const REPEAT=repeatFlag===-1?(BOUNDARY?14:MOVING?6:0):Number(argv[repeatFlag+1]);
if(BOUNDARY&&(!STRICT||repeatFlag!==-1))throw new Error('--repeat-boundaries requires --strict-suffix and cannot combine with --repeat-ticks');
if(repeatFlag!==-1&&(!STRICT||!Number.isSafeInteger(REPEAT)||REPEAT<1||REPEAT>120))
  throw new Error('--repeat-ticks requires --strict-suffix and an integer from 1 to 120');
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
if (STRICT) {
  if(!jsonOut||process.env.ONLY||process.env.EXACT_ONLY)
    throw new Error('--strict-suffix requires a new --json file and no case filters');
  // Exclusive creation before any await; a competing run cannot claim this
  // receipt. Strict mode never reads a previous result, even after launch.
  try{writeFileSync(jsonOut,'[]',{flag:'wx'});}
  catch(e){if(e.code==='EEXIST')throw new Error('--strict-suffix requires a new --json file and no case filters');throw e;}
}
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
// For a single expensive browser case, use exact selection instead of matching every ablation.
const EXACT_ONLY = process.env.EXACT_ONLY ? process.env.EXACT_ONLY.split(',') : null;

const matterKitSrc = readFileSync(path.join(here, 'matter-snapshot-kit.js'), 'utf8').replace(/^export /gm, '')
  + '\nwindow.__ssMatterKit = createMatterSnapshotKit(Phaser.Physics.Matter.Matter);\n';
// Bundle the existing pure SHA-256 implementation with the diagnostic codec,
// rather than maintaining an independent browser checksum implementation.
const recorderKitSrc = (await build({entryPoints:[path.join(here,'recorder-snapshot-kit.js')],
  bundle:true,write:false,format:'iife',globalName:'__ssRecorderKit',platform:'browser'})).outputFiles[0].text;
const gameKitSrc = readFileSync(path.join(here, 'game-state-kit.js'), 'utf8');

// Tick-indexed tape (120 Hz ticks). Held ranges [from, to) and one-shot edges.
const TAPES = {
  moving: {held: [],edges: []},
  contact: {
    held: [
      { key: 'push', from: 0, to: 216 }, { key: 'heli', value: 1, from: 324, to: 348 }, { key: 'tilt', value: -1, from: 360, to: 444 },
      { key: 'push', from: 504, to: 624 }, { key: 'tilt', value: 1, from: 732, to: 780 }, { key: 'tuck', from: 840, to: 984 },
      { key: 'push', from: 1000, to: 1100 }, { key: 'tilt', value: -1, from: 1150, to: 1190 },
    ],
    edges: [{ key: 'hop', at: 312 }, { key: 'hop', at: 708 }, { key: 'hop', at: 1120 }],
  },
  hazard: {
    held: [{ key: 'push', from: 0, to: 300 }, { key: 'tuck', from: 400, to: 700 }, { key: 'push', from: 760, to: 900 }],
    edges: [{ key: 'hop', at: 250 }, { key: 'hop', at: 520 }, { key: 'hop', at: 830 }, { key: 'hop', at: 1010 }],
  },
};
const FIXTURES = {
  moving: {seed:'b3pyramid5@4',movingId:'rollingBoulder',shields:99,K:30,N:36},
  contact: { seed: 'SAVE119', scramble: true, startX: null, kodiaks: false, K: 600, N: QUICK ? 900 : 1100 },
  hazard: { seed: 'SAVE119H@2047', scramble: false, startX: 107000, kodiaks: true, shields: 99, K: 480, N: QUICK ? 760 : 1000 },
};

async function bootPage(browser, fx, tape) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(), null, { timeout: 30000 });
  await page.addScriptTag({ content: matterKitSrc });
  await page.addScriptTag({ content: recorderKitSrc });
  await page.addScriptTag({ content: gameKitSrc });
  await page.evaluate(strict => { window.__ssCanonical = strict; }, STRICT);
  await page.evaluate(async ({ fx, tape }) => {
    const g = window.__bbGame;
    const run = g.scene.getScene('RunScene');
    const realUpdate = run.update;
    let hold = true;
    run.update = function (t, d) { if (!hold) return realUpdate.call(this, t, d); };
    g.scene.getScene('TitleScene').startRun(fx.seed);
    await new Promise((res) => { const w = () => (run.sys.isActive() && run.sled ? res() : requestAnimationFrame(w)); w(); });
    g.loop.sleep();
    if (fx.scramble) run.scrambleMs = 1e9;
    if (fx.kodiaks) run.kodiaksOn = true;
    if (fx.shields) run.shieldCharges = fx.shields; // hazard hits are absorbed (and scored as hits), so the run survives
    if(fx.movingId){
      let spawn=null;
      for(let i=0;i<200&&!spawn;i++){
        const ch=run.terrain.getChunk(i);
        spawn=ch.hazards.find(s=>s.defId===fx.movingId);
      }
      if(!spawn)throw new Error('no generated rolling hazard');
      const x=spawn.x-250;
      run.streamTerrain(x);
      run.sled.setPose(x,run.terrain.heightAt(x)-15,run.slopeAt(x),320,0);
      if(run.snapCamera)run.snapCamera();
    }
    if (fx.startX != null) {
      run.streamTerrain(fx.startX);
      run.sled.setPose(fx.startX, run.terrain.heightAt(fx.startX) - 15, run.slopeAt(fx.startX), 420, 0);
    }
    run.inputRouter.poll = () => {
      const tick = run.simClock.tick + 1; // the tick this poll feeds (one tick per frame)
      const pad = { push: false, tilt: 0, heli: 0, tuck: false, hop: false, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false } };
      for (const h of tape.held) if (tick >= h.from && tick < h.to) pad[h.key] = h.value ?? true;
      for (const e of tape.edges) if (tick === e.at) { pad.pressed[e.key] = true; pad[e.key] = true; }
      return pad;
    };
    window.__ss = { g, run, t: 0, step(n) { for (let i = 0; i < n; i++) { this.t += 1000 / 120; g.step(this.t, 1000 / 120); } return run.simClock.tick; } };
    hold = false;
  }, { fx, tape });
  return { ctx, page, errors };
}

/** Leaf paths where two capture trees differ (first `max`). */
function leafDiff(a, b, path = '', out = [], max = 25) {
  if (out.length >= max) return out;
  if (a === b || (typeof a === 'number' && typeof b === 'number' && Object.is(a, b))) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === '__id' || k === '__alias') continue;
      leafDiff(a[k], b[k], `${path}.${k}`, out, max);
    }
    return out;
  }
  out.push(`${path}: A=${JSON.stringify(a)?.slice(0, 60)} B=${JSON.stringify(b)?.slice(0, 60)}`);
  return out;
}

function compareDigests(a, b) {
  const diff = [];
  for (const k of Object.keys(a)) {
    if (k.startsWith('__')) continue;
    if (a[k] !== b[k]) diff.push(k);
  }
  for (const k of Object.keys(b)) if (!k.startsWith('__') && !(k in a)) diff.push(`${k}(only B)`);
  const sa = a.__sled, sb = b.__sled;
  const sledExact = sa.every((v, i) => Object.is(v, sb[i]));
  if (STRICT) {
    if (!sledExact) diff.push('direct.sled');
    if (a.__tick !== b.__tick) diff.push('direct.tick');
    if (!Object.is(a.__score,b.__score)) diff.push('direct.score');
    if (a.__crashed !== b.__crashed) diff.push('direct.crashed');
  }
  return { diff, sledExact, posErr: Math.hypot(sa[0] - sb[0], sa[1] - sb[1]), scoreErr: Math.abs(a.__score - b.__score) };
}

// Only the disposable, isolated candidate is reconstructed. The caller
// must not publish or step it unless restoration succeeds. Failed candidates
// are closed, including when the page evaluation itself throws.
async function restoreCandidate(candidate,json,level,skip) {
  try {
    const result=await candidate.page.evaluate(({json,level,skip})=>{
      try{return {ok:true,...window.__ssGameKit.restore(window.__ss.run,JSON.parse(json),level,{skip})};}
      catch(e){return {ok:false,error:String(e.message||e)};}
    },{json,level,skip});
    if(result.ok)return result;
    await candidate.ctx.close();
    return {...result,discarded:candidate.page.isClosed()};
  } catch(e) {
    await candidate.ctx.close();
    throw e;
  }
}

async function fixtureStatsOf(P) {
  return P.page.evaluate(() => {
        const run = window.__ss.run; let hz = 0, moving = 0, hit = 0;
        for (const l of run.hazards.values()) for (const h of l) { hz++; if (h.motion) moving++; if (h.hit) hit++; }
        const e = run.matter.world.engine;
        return { tick: run.simClock.tick, sledX: run.sled.x, hazards: hz, movingHazards: moving, hazardsHit: hit, kodiaksOut: run.kodiaks.length, kodiakNext: run.kodiakNext,
          pairs: e.pairs.list.length, activePairs: e.pairs.list.filter((p) => p.isActive && !p.isSensor).length, worldBodies: e.world.bodies.length, pool: run.mesh._bodyPool?.length ?? 0,
          chunks: run.mesh.chunks.size, score: run.score.getTotal(), crashed: run.crashed, nextId: Phaser.Physics.Matter.Matter.Common._nextId };
      });
}

async function runCase(browser, fxName, level, skip = []) {
  const fx = FIXTURES[fxName];
  const tape = TAPES[fxName];
  const A = await bootPage(browser, fx, tape);
  const B = await bootPage(browser, fx, tape);
  try {
    let fixtureStats = null;
    let snapBytes = 0, restoreLog = [], classes = null, audit = [], prefixControls = null, matterControls = null, stagedControl = null;
    if (level !== 'control') {
      await A.page.evaluate((K) => window.__ss.step(K), fx.K);
      fixtureStats = await fixtureStatsOf(A);
      const json = await A.page.evaluate(() => JSON.stringify(window.__ssGameKit.capture(window.__ss.run, { withConfig: true, withRecorder: window.__ssCanonical })));
      snapBytes = json.length;
      const parsed = JSON.parse(json);
      classes = parsed.classes; audit = parsed.audit;
      if (STRICT) {
        // Construct and independently seal the structural negative controls
        // in Node, so even an insecure HTTP game origin works.
        const corruptions={
          missing:s=>delete s.recorder,
          cursor:s=>{const d=JSON.parse(s.recorder.data);d.recorder._lastTick++;s.recorder.data=JSON.stringify(d);},
          prefix:s=>{const d=JSON.parse(s.recorder.data);d.recorder.inputs.shift();s.recorder.data=JSON.stringify(d);},
          interior:s=>{const d=JSON.parse(s.recorder.data),rows=d.recorder.inputs;
            if(rows.length<3)throw new Error('fixture lacks interior input row');
            rows[2][0]+=rows[1][0];rows.splice(1,1);s.recorder.data=JSON.stringify(d);},
          fingerprint:s=>{const d=JSON.parse(s.recorder.data);d.recorder.fingerprints.pop();s.recorder.data=JSON.stringify(d);},
        };
        const expectedErrors={
          missing:'missing or invalid section',cursor:'input cursor mismatch',
          prefix:'input cursor mismatch',interior:'integrity mismatch',fingerprint:'trace/checkpoint coverage',
        };
        const cases=Object.entries(corruptions).map(([name,mutate])=>{
          const bad=JSON.parse(json);mutate(bad);
          if(name!=='missing'&&name!=='interior')
            bad.recorder.integrity='sha256:'+createHash('sha256').update(bad.recorder.data,'utf8').digest('hex');
          return {name,bad,expectedError:'recorder prefix: '+expectedErrors[name]};
        });
        prefixControls = await B.page.evaluate(cases => {
          const run=window.__ss.run, kit=window.__ssGameKit;
          const before=JSON.stringify(kit.digests(run));
          const beforeRecorder=JSON.stringify(window.__ssRecorderKit.captureRecorderPrefix(run));
          const results=[];
          for(const {name,bad,expectedError} of cases){
            let error=null;
            try{kit.restore(run,bad,'full');}catch(e){error=String(e.message);}
            const unchanged=before===JSON.stringify(kit.digests(run)) &&
              beforeRecorder===JSON.stringify(window.__ssRecorderKit.captureRecorderPrefix(run));
            results.push({name,error,unchanged});
            if(error!==expectedError||!unchanged)throw new Error('negative control failed: '+name+': '+error);
          }
          return results;
        },cases);
        matterControls = await B.page.evaluate(json=>{
          const run=window.__ss.run,kit=window.__ssGameKit;
          const before=JSON.stringify(kit.digests(run));
          const beforeRecorder=JSON.stringify(window.__ssRecorderKit.captureRecorderPrefix(run));
          const corruptions={
            missingBody:s=>delete s.matter.bodies.sled,
            duplicateId:s=>s.matter.ids.sled[1]=s.matter.ids.sled[0],
            badGeometry:s=>s.matter.bodies.sled.parts[0].verts[0]=[null,0],
            extraOrder:s=>s.matter.worldOrder.push('sled'),
            coercedOrder:s=>s.matter.worldOrder[0]=[s.matter.worldOrder[0]],
            badPair:s=>s.matter.pairs[0].a='missing#0',
            reversePair:s=>{const p=s.matter.pairs[0];[p.a,p.b]=[p.b,p.a];[p.ca,p.cb]=[p.cb,p.ca];},
            sparseVelocity:s=>delete s.matter.bodies.sled.v.velocity[0],
            orphan:s=>s.matter.orphanPairs.push({labels:['a','b']}),
            statics:s=>s.matter.statics={},
            staticType:s=>s.matter.statics.Common._baseDelta=false,
            thirdContact:s=>{
              const p=s.matter.pairs.find(p=>p.contactCount>0);
              p.contacts[0][0]=[Object.keys(s.matter.bodies).map(k=>k+'#0').find(k=>k!==p.a&&k!==p.b),0];
            },
            thirdSupport:s=>{
              const p=s.matter.pairs.find(p=>p.col.supportCount>0);
              p.col.supports[0]=[Object.keys(s.matter.bodies).map(k=>k+'#0').find(k=>k!==p.a&&k!==p.b),0];
            },
            contactSlot:s=>{s.matter.pairs[0].contactCount=1;s.matter.pairs[0].contacts.pop();},
            contactActivity:s=>s.matter.pairs.find(p=>p.isActive&&p.contactCount>0).contactCount=0,
            contactSupport:s=>{const p=s.matter.pairs.find(p=>p.isActive&&p.contactCount>0);
              const [key,index]=p.contacts[0][0],split=key.lastIndexOf('#');
              const count=s.matter.bodies[key.slice(0,split)].parts[Number(key.slice(split+1))].verts.length;
              p.contacts[0][0]=[key,(index+1)%count];},
            inactiveContactSupport:s=>{
              const p=s.matter.pairs.find(p=>p.isActive&&p.contactCount>0);
              p.isActive=false;p.contactCount=0;
              window.__ssMatterKit.preflight(s.matter);
              p.contacts[0][0]=null;
            },
            unusedContactSupport:s=>{
              // If this boundary has only two-support pairs, construct a
              // valid one-support diagnostic shape first. Pair.update still
              // assigns both slots; only the subsequent mismatch is invalid.
              const p=s.matter.pairs.find(p=>p.isActive&&p.contactCount===1)||
                s.matter.pairs.find(p=>p.isActive&&p.contactCount===2);
              if(!p)throw new Error('fixture lacks active contact pair');
              p.contactCount=1;p.col.supportCount=1;
              window.__ssMatterKit.preflight(s.matter);
              p.contacts[1][0]=p.col.supports[1]===null?[...p.col.supports[0]]:null;
            },
          };
          const expected={
            missingBody:'body inventory',duplicateId:'duplicate/invalid part ID',
            badGeometry:'part geometry sled',extraOrder:'world/detector order',coercedOrder:'world/detector order',
            badPair:'pair/contact reference',reversePair:'pair/contact reference',sparseVelocity:'body state sled',orphan:'incomplete or orphaned state',
            statics:'module statics',staticType:'module statics',thirdContact:'pair/contact reference',
            thirdSupport:'collision support reference',contactSlot:'pair/contact reference',contactActivity:'pair activity/contact count',contactSupport:'contact/support mismatch',unusedContactSupport:'contact/support mismatch',inactiveContactSupport:'contact/support mismatch',
          };
          return Object.entries(corruptions).map(([name,mutate])=>{
            const bad=JSON.parse(json);mutate(bad);
            let error=null;
            try{kit.restore(run,bad,'full');}catch(e){error=String(e.message);}
            const unchanged=before===JSON.stringify(kit.digests(run))&&
              beforeRecorder===JSON.stringify(window.__ssRecorderKit.captureRecorderPrefix(run));
            if(error!=='Matter preflight: '+expected[name]||!unchanged)
              throw new Error('Matter negative control failed: '+name+': '+error);
            return {name,error,unchanged};
          });
        },json);
        // A finite extra axis passes shape preflight but fails after chunk
        // reconstruction. Exercise that late failure in a THIRD context;
        // B remains held at tick zero, A remains the uninterrupted source.
        const measured=P=>P.page.evaluate(()=>JSON.stringify({
          state:window.__ssGameKit.digests(window.__ss.run),
          recorder:window.__ssRecorderKit.captureRecorderPrefix(window.__ss.run)
        }));
        const before=await Promise.all([A,B].map(measured));
        const bad=JSON.parse(json);
        bad.matter.bodies.sled.parts[0].axes.push([1,0]);
        const C=await bootPage(browser,fx,tape);
        let rejection;
        try{rejection=await restoreCandidate(C,JSON.stringify(bad),'full',[]);}
        finally{await C.ctx.close();}
        const after=await Promise.all([A,B].map(measured));
        stagedControl={error:rejection.error,discarded:rejection.discarded===true,
          sourceUnchanged:before[0]===after[0],destinationUnchanged:before[1]===after[1]};
        if(rejection.ok||stagedControl.error!=='Matter preflight: rebuilt geometry count sled'||
            !stagedControl.discarded||!stagedControl.sourceUnchanged||!stagedControl.destinationUnchanged)
          throw new Error('staged late failure control failed: '+JSON.stringify(stagedControl));
      }
      const r = await restoreCandidate(B,json,level,skip);
      if (!r.ok) return { fixture: fxName, level, skip: skip.join('+') || '-', restoreError: r.error, snapBytes, audit };
      restoreLog = r.log || [];
      if (STRICT) {
        const [atK, restoredK] = await Promise.all([A,B].map(P => P.page.evaluate(() => window.__ssGameKit.digests(window.__ss.run))));
        const atCapture = compareDigests(atK,restoredK);
        const prefix = await Promise.all([A,B].map(P=>P.page.evaluate(()=>window.__ssRecorderKit.captureRecorderPrefix(window.__ss.run))));
        if (JSON.stringify(prefix[0])!==JSON.stringify(prefix[1]))
          return {fixture:fxName,level,skip:'-',restoreError:'recorder prefix mismatch at capture',snapBytes,audit,prefixControls};
        if (atK.__tick !== fx.K || restoredK.__tick !== fx.K || atCapture.diff.length)
          return {fixture:fxName,level,skip:'-',restoreError:'capture-tick mismatch: '+atCapture.diff.join(','),atCapture,snapBytes,audit};
      }
    } else {
      // control: two uninterrupted runs, both played to K, then compared K+1..N (digest determinism baseline)
      await Promise.all([A, B].map((P) => P.page.evaluate((K) => window.__ss.step(K), fx.K)));
    }
    const K = fx.K;
    const firstBy = {};
    let firstLeaves = null;
    let first = null, firstDiff = null, firstSled = null, maxPos = 0, crashA = null, crashB = null, endPos = 0, ticks = 0;
    const BATCH = 60;
    outer: for (let t0 = K + 1; t0 <= fx.N; t0 += BATCH) {
      const n = Math.min(BATCH, fx.N - t0 + 1);
      const [ba, bb] = await Promise.all([A, B].map((P) => P.page.evaluate((n) => window.__ssGameKit.runBatch(window.__ss, n), n)));
      for (let i = 0; i < n; i++) {
        const da = ba[i], db = bb[i], t = t0 + i;
        if (!da || !db) break outer;
        if (STRICT && (da.__tick !== t || db.__tick !== t)) throw new Error('noncontiguous tick '+t+': '+da.__tick+'/'+db.__tick);
        ticks++;
        const c = compareDigests(da, db);
        for (const k of c.diff) if (!(k in firstBy)) firstBy[k] = t;
        if (c.diff.length && first === null) {
          first = t; firstDiff = c.diff;
          const cap = (tt) => JSON.stringify(window.__ss.ring.get(tt));
          const [ca, cb] = (await Promise.all([A.page.evaluate(cap, t), B.page.evaluate(cap, t)])).map((j) => JSON.parse(j));
          firstLeaves = [];
          for (const k of c.diff) {
            if(k.startsWith('canonical.')||k.startsWith('direct.')||k==='telegraph'){
              const field=k.startsWith('direct.')?'__'+k.slice(7):k;
              firstLeaves.push(k+': '+JSON.stringify(da[field])+' != '+JSON.stringify(db[field]));continue;}
            if (k === 'matter.worldOrder' || k === 'matter.detectorOrder') { const f = k.slice(7); const i = ca.matter[f].findIndex((x, j) => x !== cb.matter[f][j]); firstLeaves.push(`${k}[${i}]: A=${ca.matter[f][i]} B=${cb.matter[f][i]} (len ${ca.matter[f].length}/${cb.matter[f].length})`); }
            else if (k.startsWith('matter.')) leafDiff(ca.matter[k.slice(7)], cb.matter[k.slice(7)], k, firstLeaves, firstLeaves.length + 6);
            else if (k === 'pool') leafDiff(ca.pool, cb.pool, 'pool', firstLeaves, firstLeaves.length + 6);
            else if (k.startsWith('camera')) leafDiff(ca.camera, cb.camera, 'camera', firstLeaves, firstLeaves.length + 6);
            else leafDiff(ca.game[k], cb.game[k], k, firstLeaves, firstLeaves.length + (c.diff.length === 1 ? 20 : 4));
          }
        }
        if (!c.sledExact && firstSled === null) firstSled = t;
        maxPos = Math.max(maxPos, c.posErr); endPos = c.posErr;
        if (da.__crashed && crashA === null) crashA = t;
        if (db.__crashed && crashB === null) crashB = t;
        if (crashA !== null && crashB !== null && t > Math.max(crashA, crashB) + 30) break outer;
      }
    }
    let recorderParity = null;
    if (STRICT) {
      const receipts=await Promise.all([A,B].map(P=>P.page.evaluate(()=>{
        const r=window.__ss.run, rec=r.ghostRecorder;
        const prefix=window.__ssRecorderKit.captureRecorderPrefix(r);
        const tape=rec.finish({runId:r.runId,distanceM:r.sled.x,score:r.score.getTotal(),endedAt:1});
        return {prefix,tape};
      })));
      recorderParity={prefix:JSON.stringify(receipts[0].prefix)===JSON.stringify(receipts[1].prefix),
        finishedTape:JSON.stringify(receipts[0].tape)===JSON.stringify(receipts[1].tape),
        endTick:receipts[0].tape.endTick,inputRows:receipts[0].tape.inputs.length,
        checkpoints:receipts[0].tape.checkpoints.length};
    }
    const errors = [...A.errors, ...B.errors];
    return {
      fixture: fxName, level, skip: skip.join('+') || '-', K, N: fx.N, ticksCompared: ticks, snapBytes, fixtureStats,
      firstDivergentTick: first, ticksAfterRestore: first === null ? null : first - K, subsystemsAtFirst: firstDiff,
      firstSledDivergentTick: firstSled, firstLeaves, firstDivergenceBySubsystem: firstBy, maxSledPosErrPx: +maxPos.toFixed(4), endSledPosErrPx: +endPos.toFixed(4),
      crashTickA: crashA, crashTickB: crashB, restoreLog: restoreLog.slice(0, 12), restoreLogCount: restoreLog.length,
      prefixControls, matterControls, stagedControl, recorderParity, audit, classes: classes && Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length])), unclassified: classes?.unclassified, pageErrors: errors,
    };
  } finally {
    await A.ctx.close(); await B.ctx.close();
  }
}

// At each boundary, recapture the previously restored candidate, transfer it
// into a completely fresh context, compare it with the uninterrupted source,
// then advance BOTH exactly one tick. This is intentionally expensive and
// bounded: the count refers to contiguous restore cycles, not sampled ticks.
async function runRepeatedCase(browser,fxName) {
  const boundary=BOUNDARY?({contact:{K:707,edge:708,checkpoint:720},hazard:{K:479,edge:481,checkpoint:480}})[fxName]:null;
  const fx={...FIXTURES[fxName],...(boundary?{K:boundary.K}:{})};
  // Earlier hazard window preserves live hit state; add one explicit
  // synthetic input edge immediately after the recorder checkpoint.
  const baseTape=TAPES[fxName];
  const tape=boundary&&fxName==='hazard'?{...baseTape,edges:[...baseTape.edges,{key:'hop',at:boundary.edge}]}:baseTape;
  const source=await bootPage(browser,fx,tape);
  let current=source, candidate=null;
  const cycles=[];
  let fixtureStats=null;
  const movingState=P=>P.page.evaluate(()=>{
    const run=window.__ss.run;
    const h=[...run.hazards.values()].flat().find(h=>h.def.id==='rollingBoulder'&&h.rolling&&!h.destroyed);
    return h?{id:h.hid,offset:h.roll.offsetPx,activeAt:h.roll.activeAtMs,x:h.body.position.x,y:h.body.position.y}:null;
  });
  const measure=P=>P.page.evaluate(()=>{
    const r=window.__ss.run;
    return {digests:window.__ssGameKit.digests(r),
      prefix:window.__ssRecorderKit.captureRecorderPrefix(r)};
  });
  const same=(a,b,tick)=>{
    const c=compareDigests(a.digests,b.digests);
    if(a.digests.__tick!==tick||b.digests.__tick!==tick)c.diff.push('direct.expectedTick');
    if(JSON.stringify(a.prefix)!==JSON.stringify(b.prefix))c.diff.push('recorder.prefix');
    return c.diff;
  };
  try {
    await source.page.evaluate(k=>window.__ss.step(k),fx.K);
    fixtureStats=await fixtureStatsOf(source);
    if(fixtureStats.tick!==fx.K||fixtureStats.crashed||
      (fxName==='contact' ? !(fixtureStats.activePairs>0) : fxName==='moving'?!(fixtureStats.movingHazards>0):!(fixtureStats.hazardsHit>0)))
      return {fixture:fxName,level:'repeat',K:fx.K,N:fx.K+REPEAT,cycles,fixtureStats,
        firstDivergentTick:fx.K,phase:'fixture coverage',diff:['required contact/hazard evidence absent']};
    for(let k=fx.K;k<fx.K+REPEAT;k++){
      const [a,b]=current===source?await measure(source).then(a=>[a,a]):await Promise.all([source,current].map(measure));
      const before=same(a,b,k);
      if(before.length)return {fixture:fxName,level:'repeat',K:fx.K,N:fx.K+REPEAT,cycles,firstDivergentTick:k,phase:'before capture',diff:before};
      const movingBefore=MOVING?await movingState(source):null;
      if(MOVING&&(!movingBefore?.id||!Number.isFinite(movingBefore.offset)||movingBefore.offset===0))
        return {fixture:fxName,level:'repeat',K:fx.K,N:fx.K+REPEAT,cycles,fixtureStats,firstDivergentTick:k,phase:'moving coverage',diff:['no live activated moving hazard']};
      const bytes=await current.page.evaluate(()=>JSON.stringify(window.__ssGameKit.capture(window.__ss.run,{withConfig:true,withRecorder:true})));
      candidate=await bootPage(browser,fx,tape);
      const r=await restoreCandidate(candidate,bytes,'full',[]);
      if(!r.ok)return {fixture:fxName,level:'repeat',K:fx.K,N:fx.K+REPEAT,cycles,firstDivergentTick:k,phase:'restore',restoreError:r.error,discarded:r.discarded};
      const atRestore=same(a,await measure(candidate),k);
      if(MOVING&&JSON.stringify(movingBefore)!==JSON.stringify(await movingState(candidate)))atRestore.push('direct.movingHazard');
      if(atRestore.length)return {fixture:fxName,level:'repeat',K:fx.K,N:fx.K+REPEAT,cycles,firstDivergentTick:k,phase:'after restore',diff:atRestore};
      await Promise.all([source,candidate].map(P=>P.page.evaluate(()=>window.__ss.step(1))));
      const [nextA,nextB]=await Promise.all([source,candidate].map(measure));
      const after=same(nextA,nextB,k+1);
      const movingAfter=MOVING?await movingState(source):null;
      if(MOVING&&(!movingAfter||movingAfter.id!==movingBefore.id||movingAfter.offset===movingBefore.offset||
        movingAfter.x===movingBefore.x||JSON.stringify(movingAfter)!==JSON.stringify(await movingState(candidate))))after.push('direct.movingHazard');
      if(after.length)return {fixture:fxName,level:'repeat',K:fx.K,N:fx.K+REPEAT,cycles,firstDivergentTick:k+1,phase:'next tick',diff:after};
      if(source.errors.length||candidate.errors.length||current.errors.length)
        throw new Error('page errors during repeat: '+JSON.stringify([...source.errors,...candidate.errors,...current.errors]));
      const beforeRec=JSON.parse(a.prefix.data).recorder,afterRec=JSON.parse(nextA.prefix.data).recorder;
      const appended=afterRec.inputs.length===beforeRec.inputs.length+1?afterRec.inputs.at(-1):null;
      const recordedHopEdge=!!appended&&afterRec._lastTick===k+1&&decodePad(appended[1],appended[2]).pressed.hop===true;
      cycles.push({captureTick:k,nextTick:k+1,bytes:Buffer.byteLength(bytes),
        canonical:nextA.digests['canonical.combined'],recaptured:current!==source,
        ...(MOVING?{movingBefore,movingAfter}:{}),
        newInputRows:afterRec.inputs.length-beforeRec.inputs.length,recordedHopEdge,
        newCheckpoints:afterRec.checkpoints.length-beforeRec.checkpoints.length,
        newFingerprints:afterRec.fingerprints.length-beforeRec.fingerprints.length});
      if(current!==source)await current.ctx.close();
      current=candidate;candidate=null;
    }
    // Matching invalid histories are not a pass. Use the exact restore
    // admission validator on the final prefix in a fresh destination.
    const final=await measure(current);
    candidate=await bootPage(browser,fx,tape);
    const finalValidation=await candidate.page.evaluate(({prefix,tick})=>{
      try{window.__ssRecorderKit.prepareRecorderPrefix(window.__ss.run,prefix,tick);return {ok:true};}
      catch(e){return {ok:false,error:String(e.message||e)};}
    },{prefix:final.prefix,tick:fx.K+REPEAT});
    if(candidate.errors.length)throw new Error('page errors during final validation: '+JSON.stringify(candidate.errors));
    await candidate.ctx.close();candidate=null;
    if(!finalValidation.ok)return {fixture:fxName,level:'repeat',K:fx.K,N:fx.K+REPEAT,cycles,fixtureStats,
      firstDivergentTick:fx.K+REPEAT,phase:'final recorder validation',restoreError:finalValidation.error};
    const boundaryWitness=boundary?{
      edge:boundary.edge,checkpoint:boundary.checkpoint,
      inputRecorded:cycles.some(c=>c.nextTick===boundary.edge&&c.newInputRows===1&&c.recordedHopEdge),
      checkpointRecorded:cycles.some(c=>c.nextTick===boundary.checkpoint&&c.newCheckpoints===1&&c.newFingerprints===1),
      recapturedAfterCheckpoint:cycles.some(c=>c.captureTick===boundary.checkpoint&&c.recaptured)
    }:null;
    const missingWitness=boundary?Object.entries(boundaryWitness).filter(([_k,v])=>v===false).map(([k])=>k):[];
    if(missingWitness.length)return {fixture:fxName,level:'repeat',K:fx.K,N:fx.K+REPEAT,cycles,fixtureStats,boundaryWitness,
      firstDivergentTick:null,phase:'boundary coverage',diff:missingWitness.map(k=>k+' (hop '+boundary.edge+', checkpoint '+boundary.checkpoint+')'),
      coverageError:true,finalValidation,pageErrors:[...source.errors,...current.errors]};
    return {fixture:fxName,level:'repeat',K:fx.K,N:fx.K+REPEAT,cycles,fixtureStats,boundaryWitness,finalValidation,firstDivergentTick:null,
      pageErrors:[...source.errors,...current.errors]};
  } finally {
    if(candidate)await candidate.ctx.close();
    if(current!==source)await current.ctx.close();
    await source.ctx.close();
  }
}

const browser = await chromium.launch({ headless: true, executablePath: EXE, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
// Resumable: every finished case is written to the results file as it completes; a rerun with the same file skips
// cases already present (harness errors are retried).
const caseKey = (r) => `${r.fixture}:${r.level}${r.skip && r.skip !== '-' ? `-${r.skip}` : ''}`;
let results = [];
if (!STRICT && jsonOut && existsSync(jsonOut)) {
  try { results = JSON.parse(readFileSync(jsonOut, 'utf8')).filter((r) => !r.harnessError); } catch { results = []; }
}
const done = new Set(results.map(caseKey));
const plan = [];
for (const fx of MOVING?['moving']:['contact', 'hazard']) {
  if (STRICT) { plan.push([fx,REPEAT?'repeat':'full']); continue; }
  plan.push([fx, 'control'], [fx, 'ghost'], [fx, 'game'], [fx, 'kinematic'], [fx, 'contacts'], [fx, 'full']);
  for (const s of ['camera', 'ids', 'runRandom', 'impulses', 'staleSupport', 'timing', 'positionImpulse', 'rawGeometry']) plan.push([fx, 'full', [s]]);
  if (fx === 'hazard') for (const s of ['kodiaks', 'bsod', 'hazardHit', 'pool', 'telegraph']) plan.push([fx, 'full', [s]]);
}
try {
  for (const [fx, level, skip] of plan) {
    const key = `${fx}:${level}${skip ? `-${skip.join('+')}` : ''}`;
    if (ONLY && !ONLY.some((o) => key.startsWith(o))) continue;
    if (EXACT_ONLY && !EXACT_ONLY.includes(key)) continue;
    if (done.has(key)) { console.log(`${key.padEnd(30)} (cached in ${jsonOut})`); continue; }
    const t0 = Date.now();
    let r;
    try { r = REPEAT?await runRepeatedCase(browser,fx):await runCase(browser, fx, level, skip || []); } catch (e) { r = { fixture: fx, level, skip: (skip || []).join('+') || '-', harnessError: String(e.message || e).slice(0, 300) }; }
    r.wallMs = Date.now() - t0;
    results.push(r);
    if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
    console.log(`${key.padEnd(30)} firstDiv=${String(r.firstDivergentTick).padEnd(5)} (+${r.ticksAfterRestore ?? '-'}) sledDiv=${String(r.firstSledDivergentTick).padEnd(5)} maxPos=${r.maxSledPosErrPx ?? '-'} end=${r.endSledPosErrPx ?? '-'} crash=${r.crashTickA}/${r.crashTickB} ticks=${r.ticksCompared ?? '-'} at=${JSON.stringify(r.subsystemsAtFirst || (r.phase?{phase:r.phase,diff:r.diff,restoreError:r.restoreError}:null) || r.restoreError || r.harnessError || null)}`);
  }
} finally { await browser.close(); }
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));

if (REPEAT) {
  const failed=results.length!==(MOVING?1:2)||results.some(r=>r.harnessError||r.restoreError||
    r.firstDivergentTick!==null||r.coverageError||!r.finalValidation?.ok||r.pageErrors?.length!==0||r.cycles?.length!==REPEAT||
    r.fixtureStats?.tick!==r.K||r.fixtureStats.crashed||
    (r.fixture==='contact'?!(r.fixtureStats.activePairs>0):r.fixture==='moving'?!(r.fixtureStats.movingHazards>0):!(r.fixtureStats.hazardsHit>0))||
    (MOVING&&!r.cycles.every(c=>c.movingBefore?.id&&c.movingAfter?.id===c.movingBefore.id&&c.movingBefore.offset!==c.movingAfter.offset&&c.movingBefore.x!==c.movingAfter.x))||
    (BOUNDARY&&(!r.boundaryWitness?.inputRecorded||!r.boundaryWitness.checkpointRecorded||!r.boundaryWitness.recapturedAfterCheckpoint))||
    !r.cycles.every((c,i)=>c.captureTick===r.K+i&&c.nextTick===r.K+i+1&&c.recaptured===(i>0)&&c.canonical));
  console.log(failed?'FAIL_REPEATED_RESTORE':'PASS_REPEATED_RESTORE');
  if(failed)process.exitCode=1;
} else if (STRICT) {
  const failed = results.length !== 2 || results.some(r =>
    r.restoreError || r.harnessError || r.ticksCompared !== r.N-r.K ||
    r.firstDivergentTick !== null || r.firstSledDivergentTick !== null ||
    r.prefixControls?.length !== 5 || !r.prefixControls.every(c=>c.unchanged&&c.error?.startsWith('recorder prefix:')) ||
    r.matterControls?.length !== 18 || !r.matterControls.every(c=>c.unchanged&&c.error?.startsWith('Matter preflight:')) ||
    !r.stagedControl?.discarded || !r.stagedControl.sourceUnchanged || !r.stagedControl.destinationUnchanged ||
    !r.recorderParity?.prefix || !r.recorderParity.finishedTape || r.recorderParity.endTick !== r.N ||
    r.pageErrors?.length !== 0 || r.audit?.length !== 0 || r.unclassified?.length !== 0 ||
    (r.fixture === 'contact' ? !(r.fixtureStats?.activePairs > 0) : !(r.fixtureStats?.hazardsHit > 0)));
  console.log(failed ? 'FAIL_STRICT_DIAGNOSTIC_SUFFIX' : 'PASS_STRICT_DIAGNOSTIC_SUFFIX');
  if (failed) process.exitCode=1;
}
