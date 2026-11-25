/** P0 #59: prove hidden Phaser RNG does not fire in trail and Game Over shake. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const origin=process.env.GAME_URL;
if(!origin)throw Error('GAME_URL required');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 await page.goto(origin,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive(),null,{timeout:30000});
 await page.evaluate(()=>window.__bbGame.scene.getScene('TitleScene').startRun('seeded-cosmetics-59'));
 await page.waitForFunction(()=>window.__bbGame?.scene?.getScene('RunScene')?.sys?.isActive()&&window.__bbGame.scene.getScene('RunScene').trail,null,{timeout:30000});
 const proof=await page.evaluate(async()=>{
  const game=window.__bbGame,run=game.scene.getScene('RunScene');
  const {seedCosmeticRandom}=await import('/src/systems/CosmeticRandom.js');
  seedCosmeticRandom(777);
  const original=Math.random;
  let calls=0,trappedPhaser=false,trailVisible=false,shakeMoved=false,shakeRestored=false;
  Math.random=()=>{calls++;throw Error('UNSEEDED_RANDOM_USED');};
  try {
   // Negative control: the exact global API used by hidden Phaser helpers.
   try {Math.random();}catch{trappedPhaser=true;}
   const body=run.sled;
   run.trail.update(body.x,body.y,800);
   trailVisible=run.trail.emitter.alive?.length>0;
   if(!trailVisible)throw Error('Trail did not emit actual particle');
   const over=game.scene.getScene('GameOverScene');
   const cam=over.cameras.main,priorBackdrop=over.backdrop,priorBoard=over.board,priorSlam=over._slam;
   const base={x:cam.scrollX,y:cam.scrollY};
   try {
    over.backdrop={update(){}};over.board=null;over._slam=true;
    over._seededShake={remaining:220,x:base.x,y:base.y};
    over.update(0,16);
    shakeMoved=cam.scrollX!==base.x||cam.scrollY!==base.y;
    over.update(16,230);
    shakeRestored=cam.scrollX===base.x&&cam.scrollY===base.y&&over._seededShake===null;
   }finally{over.backdrop=priorBackdrop;over.board=priorBoard;over._slam=priorSlam;cam.setScroll(base.x,base.y);}
  }finally{Math.random=original;}
  return {trappedPhaser,trailVisible,shakeMoved,shakeRestored,calls};
 });
 assert.equal(proof.trappedPhaser,true,'The negative control must catch Phaser unseeded randomness');
 assert.equal(proof.trailVisible,true);
 assert.equal(proof.shakeMoved,true);
 assert.equal(proof.shakeRestored,true);
 assert.equal(proof.calls,1,'only the deliberately trapped negative-control call may reach Math.random');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({format:'bb-59-seeded-cosmetics-browser',source:origin,proof,pageErrors:errors},null,2));
}finally{await browser.close();}
