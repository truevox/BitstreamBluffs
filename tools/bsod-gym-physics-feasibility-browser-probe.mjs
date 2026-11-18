// Exploratory real-Matter playability probe, not an autoplay/achievement gate.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const url=process.env.GAME_URL||'http://127.0.0.1:8231/';
const scenario=process.env.SCENARIO||'default';
const frames=Math.max(1,Math.min(3600,Number(process.env.FRAMES||900)));
const strategies={
  default:{advanced:false,rank:0},
  canopy:{advanced:false,rank:20},
  max:{advanced:false,rank:80},
  tall:{advanced:true,rank:0},
  tallmax:{advanced:true,rank:80},
  'trial12-fast':{advanced:true,ranks:{canopy:12,airbrake:12},
    setup:{gapPx:220,wallSpeedPxS:450,launchHeightPx:700,launchSpeedPxS:450,launchRisePxS:-700}},
  'trial12-sprint':{advanced:true,ranks:{canopy:12,airbrake:12},
    setup:{gapPx:460,wallSpeedPxS:850,launchHeightPx:700,launchSpeedPxS:700,launchRisePxS:-700}},
  'trial12-tall':{advanced:true,ranks:{canopy:12,airbrake:12},
    setup:{gapPx:680,wallSpeedPxS:450,launchHeightPx:1100,launchSpeedPxS:450,launchRisePxS:-900}},
  'trial12-wild':{advanced:true,ranks:{canopy:12,airbrake:12},
    setup:{gapPx:220,wallSpeedPxS:850,launchHeightPx:1100,launchSpeedPxS:700,launchRisePxS:-900}},
};
const rankMatch=/^rank-(\d+)$/.exec(scenario);
if(rankMatch&&Number(rankMatch[1])<=200)strategies[scenario]={advanced:false,rank:Number(rankMatch[1])};
const kitMatch=/^(canopy|aero)-(\d+)$/.exec(scenario);
if(kitMatch&&Number(kitMatch[2])<=200){
  const rank=Number(kitMatch[2]);
  strategies[scenario]={advanced:false,ranks:{canopy:rank,
    ...(kitMatch[1]==='aero'?{airbrake:rank}:{})}};
}
if(!strategies[scenario])throw Error('Unknown scenario '+scenario);
const browser=await chromium.launch({headless:true,args:[
  '--no-sandbox','--use-gl=angle','--use-angle=swiftshader',
  '--enable-webgl','--ignore-gpu-blocklist',
]});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  const setup=strategies[scenario];
  await page.evaluate(({scenario,setup})=>{
    const g=window.__bbGame,store=g.registry.get('progression').store;
    const ranks=setup.ranks||(setup.rank?{canopy:setup.rank,bsodGrace:setup.rank,hop:setup.rank,airbrake:setup.rank}:{});
    const gym={discovered:true,owned:true,advanced:setup.advanced};
    if(setup.advanced)gym.setup=setup.setup||{
      gapPx:460,wallSpeedPxS:450,launchHeightPx:1100,
      launchSpeedPxS:450,launchRisePxS:-900,
    };
    g.registry.set('profile',store.save({...store.profile,bank:500,
      upgradesEnabled:!!setup.rank||!!setup.ranks,
      upgrades:{...store.profile.upgrades,...ranks},
      bsodGym:gym,
    }));
    // Use ONE seed across loadouts: otherwise rank comparisons are confounded by terrain.
    g.scene.getScene('TitleScene').startRun('gym-physical-probe-aero-25',0,{gym:true});
  },{scenario,setup});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:30000});
  const result=await page.evaluate(({scenario,frames})=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene'),s=r.sled;
    g.loop.stop();const dt=1000/60;
    const pad={parachute:false,airBrake:false,brake:false,hop:false,
      tuck:false,tilt:0,heli:0,pressed:{hop:false,pause:false,reset:false}};
    r.inputRouter={poll:()=>pad,setEnabled(){}};
    const scores=[],trace=[];g.events.on('bb:bsodBluff',v=>scores.push({
      t:Math.round(r.runTimeMs),gap:Math.round(r.bsodState.gapPx),
      chain:v.chain,x:Math.round(s.x),y:Math.round(s.y),
      fuel:Math.round(s.parachuteFuelMs),vx:Math.round(s.vx),
      grounded:s.grounded,refilledMs:Math.round(v.canopyRecoveredMs||0),
    }));
    const start={...r.gymSetup,fuel:s.canopyFuelFullMs,accel:r.bsod.accelerationPxS2,
      gym:r.bsodGym,upgrades:r.upgradeRun.ranks,enabled:r.upgradeRun.enabled};
    const bankBefore=g.registry.get('profile').bank;
    const lifetimeBefore=JSON.stringify(g.registry.get('profile').lifetime);
    const recordBefore=g.registry.get('lastRecord');
    let phase='brake',maxChain=0,landingAt=null,near=Infinity;
    for(let i=0;i<frames;i++){
      const gap=r.bsodState?.gapPx??Infinity;
      if(r.gymReadyMs===0){
        if(phase==='brake'&&gap<=240)phase='sail';
        if(phase==='sail'&&gap>=460)phase='brake';
        pad.airBrake=phase==='brake';
        pad.parachute=phase==='sail'&&s.parachuteFuelMs>0;
      }else{pad.airBrake=false;pad.parachute=false;}
      g.headlessStep(1000+i*dt,dt);
      near=Math.min(near,r.bsodState?.gapPx??Infinity);
      maxChain=Math.max(maxChain,r.bsodBluffs.chain);
      if(s.grounded&&landingAt===null&&r.gymReadyMs===0)landingAt=Math.round(r.runTimeMs);
      if(i%20===0)trace.push({t:Math.round(r.runTimeMs),g:Math.round(r.bsodState?.gapPx??0),
        x:Math.round(s.x),y:Math.round(s.y),vx:Math.round(s.vx),
        vy:Math.round(s.vy),fuel:Math.round(s.parachuteFuelMs),
        chain:r.bsodBluffs.chain,retry:r.gymRetries||0,phase});
      if(r.gymRetries>=2||maxChain>=5)break;
    }
    return {scenario,start,scores,maxChain,landingAt,catches:r.gymRetries||0,
      unlocked:g.registry.get('profile').bsodGym.advanced===true,
      bankUnchanged:g.registry.get('profile').bank===bankBefore,
      lifetimeUnchanged:JSON.stringify(g.registry.get('profile').lifetime)===lifetimeBefore,
      recordUnchanged:g.registry.get('lastRecord')===recordBefore,
      nearGap:Math.round(near),durationMs:Math.round(r.runTimeMs),trace};
  },{scenario,frames});
  if(process.env.ASSERT_FIVE==='1'){
    assert.equal(result.scenario,'aero-25');
    assert.deepEqual(result.scores.map(s=>s.chain),[1,2,3,4,5]);
    assert.ok(result.scores.every(s=>s.grounded===false&&s.refilledMs>0));
    assert.equal(result.start.gym,true);
    assert.equal(result.start.gapPx,460);
    assert.equal(result.start.wallSpeedPxS,240);
    assert.deepEqual(result.start.upgrades,{canopy:25,airbrake:25});
    assert.equal(result.start.enabled,true);
    assert.equal(result.maxChain,5);
    assert.equal(result.landingAt,null);
    assert.equal(result.catches,0);
    assert.equal(result.unlocked,true);
    assert.equal(result.bankUnchanged,true);
    assert.equal(result.lifetimeUnchanged,true);
    assert.equal(result.recordUnchanged,true);
    assert.deepEqual(errors,[]);
    console.log('REAL_MATTER_FIVE_UNINTERRUPTED_GYM_BLUFFS_PASS',result.scores);
  }else{
    console.log(JSON.stringify({errors,result},null,2));
    if(errors.length)process.exitCode=1;
  }
}finally{await browser.close();}
