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
      // An actual one-shot physical brake kick (verified separately by the
      // compiled Sled regression), NOT just an airBrakeActive held button.
      r.updateBsodBluff(true);
      r.sled.x=1400;
      r.runTimeMs=910;
      r.bsodState={...r.bsodState,gapPx:860};
      r.updateBsodBluff();
      r.updateBsodBluff(); // no repeated scoring at same gap
      const rewardedScoreDelta=r.score.getTotal()-beforeScore;
      const rewardedMissDelta=r.nearMissCount-beforeMisses;
      const rewardedEvents=events.slice();
      const pomAnchor=r.sled.windPomAnchor,pomHidden=r.sled.hidden;

      // Second encounter in an isolated fresh tracker: button is held, but the
      // one-shot latch has ALREADY been spent, so no physical kick occurred.
      // This must still award the base 150 points but NOT the 40-point bonus.
      r.bsodBluffs=new r.bsodBluffs.constructor();
      events.length=0;
      const heldScoreBefore=r.score.getTotal(),heldMissesBefore=r.nearMissCount;
      r.sled.x=1000;
      r.sled.airBrakeActive=true;
      r.runTimeMs=1;
      r.bsodState={...r.bsodState,gapPx:1300};
      r.updateBsodBluff(false);
      r.sled.x=1050;
      r.runTimeMs=150;
      r.bsodState={...r.bsodState,gapPx:190};
      r.updateBsodBluff(false);
      r.sled.x=1400;
      r.runTimeMs=910;
      r.bsodState={...r.bsodState,gapPx:860};
      r.updateBsodBluff(false);
      return {
        scoreDelta:rewardedScoreDelta,
        nearMissDelta:rewardedMissDelta,
        events:rewardedEvents,
        heldOnlyScoreDelta:r.score.getTotal()-heldScoreBefore,
        heldOnlyNearMissDelta:r.nearMissCount-heldMissesBefore,
        heldOnlyEvents:events.slice(),
        pomAnchor,
        pomHidden,
      };
    } finally {
      Object.assign(r.sled,{x:old.x,msSinceContact:old.msSinceContact,parachuteMs:old.parachuteMs,airBrakeActive:old.airBrakeActive});
      r.bsodState=old.bsodState;
      r.runTimeMs=old.time;
    }
  });
  assert.equal(result.scoreDelta,190);
  assert.equal(result.nearMissDelta,1);
  assert.equal(result.heldOnlyScoreDelta,150,'spent AirBrake held button must not buy extra points');
  assert.equal(result.heldOnlyNearMissDelta,1);
  assert.deepEqual(result.heldOnlyEvents.map(x=>x.kind),['nearMiss','bsodBluff']);
  assert.equal(result.heldOnlyEvents[0].points,150);
  assert.deepEqual(result.events.map(x=>x.kind),['nearMiss','bsodBluff']);
  assert.equal(result.events[0].hazardType,'bsod');
  assert.equal(result.events[0].chain,1);
  assert.ok(Number.isFinite(result.pomAnchor?.x));
  assert.ok(Number.isFinite(result.pomAnchor?.y));
  assert.deepEqual(errors,[]);
  console.log('BLUFF_SCORING_BROWSER_PASS',result);
}finally{await browser.close()}
