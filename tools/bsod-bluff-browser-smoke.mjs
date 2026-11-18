import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];
page.on('pageerror',err=>errors.push(String(err)));
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8213/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
  await page.evaluate(()=>{const t=window.__bbGame.scene.getScene('TitleScene');t.startRun('bsod-bluffing-integration-smoke')});
  await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive(),null,{timeout:20000});
  await page.waitForTimeout(250);
  const result=await page.evaluate(()=>{
    const g=window.__bbGame,r=g.scene.getScene('RunScene');
    const events=[];
    g.events.on('bb:nearMiss',e=>events.push({kind:'nearMiss',...e}));
    g.events.on('bb:bsodBluff',e=>events.push({kind:'bsodBluff',...e}));
    const beforeScore=r.score.getTotal();
    const beforeMisses=r.nearMissCount;
    const old={x:r.sled.x,msSinceContact:r.sled.msSinceContact,parachuteMs:r.sled.parachuteMs,
      airBrakeActive:r.sled.airBrakeActive,bsodState:r.bsodState,time:r.runTimeMs};
    try {
      r.sled.msSinceContact=999;
      r.sled.parachuteMs=380;
      r.sled.airBrakeActive=true;
      r.sled.x=1000;
      r.runTimeMs=1;
      r.bsodState={...old.bsodState,active:true,gapPx:1300,relativeAirX:540,atmosphereDensity:1};
      r.updateBsodBluff();
      r.sled.x=1050;
      r.runTimeMs=150;
      r.bsodState={...r.bsodState,gapPx:190};
      r.updateBsodBluff();
      r.sled.x=1400;
      r.runTimeMs=910;
      r.bsodState={...r.bsodState,gapPx:860};
      r.updateBsodBluff();
      r.updateBsodBluff(); // no repeated scoring at same gap
      return {
        scoreDelta:r.score.getTotal()-beforeScore,
        nearMissDelta:r.nearMissCount-beforeMisses,
        events,
        pomAnchor:r.sled.windPomAnchor,
        pomHidden:r.sled.hidden,
      };
    } finally {
      Object.assign(r.sled,{x:old.x,msSinceContact:old.msSinceContact,parachuteMs:old.parachuteMs,airBrakeActive:old.airBrakeActive});
      r.bsodState=old.bsodState;
      r.runTimeMs=old.time;
    }
  });
  assert.equal(result.scoreDelta,190);
  assert.equal(result.nearMissDelta,1);
  assert.deepEqual(result.events.map(x=>x.kind),['nearMiss','bsodBluff']);
  assert.equal(result.events[0].hazardType,'bsod');
  assert.equal(result.events[0].chain,1);
  assert.ok(Number.isFinite(result.pomAnchor?.x));
  assert.ok(Number.isFinite(result.pomAnchor?.y));
  assert.deepEqual(errors,[]);
  console.log('BLUFF_SCORING_BROWSER_PASS',result);
}finally{await browser.close()}
