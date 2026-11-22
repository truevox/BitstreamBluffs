/** #155: synthetic cue visibility baseline in the compiled Phaser renderer. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:8455/' } } });
assert.match(values.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'Use an HTTP loopback preview root with an explicit port');
const endpoint = new URL(values.url);
const entry = '/assets/index-CCcOfMwf.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceCommit = '47615f9ac21251a3192b1d159ae18ff56e7632f7';
const expectedBuild = '39ab0e5c7022a59e6114af3b7d60bffbbd2c0206722401fd5b2f1dd9f895d36e';
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE});
try {
  async function oneRun() {
    let closing = false, buildChecked = false;
    const errors = [];
    const context = await browser.newContext({viewport:{width:960,height:540},serviceWorkers:'block'});
    try {
      await context.route('**/*', async (route) => {
        try {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== endpoint.origin || !['GET', 'HEAD'].includes(request.method())) return await route.abort();
          const response = await route.fetch({ maxRedirects: 0 });
          if (closing) return;
          if (response.status() >= 300 && response.status() < 400) return await route.abort();
          if (url.pathname === entry && request.resourceType() === 'script') {
            assert.equal(response.status(), 200, 'Compiled preview entry was not served');
            assert.equal(sha(await response.body()), expectedBuild, 'Wrong compiled preview entry SHA-256');
            buildChecked = true;
          }
          await route.fulfill({ response });
        } catch (error) {
          if (closing && /disposed|has been closed|cancelled|canceled/i.test(String(error))) return;
          errors.push(String(error));
          if (!closing) await route.abort().catch(() => {});
        }
      });
      await context.routeWebSocket('**/*', (socket) => socket.close());
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.clock.setFixedTime(new Date('2026-01-05T12:00:00Z'));
      await page.goto(endpoint.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const bootEntry = await page.locator('script[type=module][src]').getAttribute('src', { timeout: 5000 });
      assert.deepEqual(errors, [], 'Preview or browser error');
      assert.ok(buildChecked && bootEntry === entry, 'Use the pinned compiled preview, not Vite dev or a different build');
      await page.waitForFunction(() => window.__bbGame?.scene?.isActive('TitleScene'), undefined, { timeout: 20000 });
      const result = await page.evaluate(() => {
        const fail=(condition,message)=>{if(!condition)throw Error(message);};
        const game=window.__bbGame, title=game.scene.getScene('TitleScene');
        game.loop.sleep();
        title.startRun('sim-11');
        game.scene.stop('TitleScene');
        game.scene.start('RunScene');
        game.step(0,0);
        const run=game.scene.getScene('RunScene'), sled=run.sled, cam=run.cameras.main, gt=run.groundTelegraph;
        const W=game.canvas.width, H=game.canvas.height;
        fail(W===480 && H===270 && Boolean(game.renderer.gl),'wrong real Phaser renderer');
        fail(run.sys.isActive() && run.seed==='sim-11' && run.biomeMask===0 && run.dailyRuleId==='featherweight' && !run.dailyOfficial && !run.tapePlayer,'wrong stock run');
        const dt=1000/120;
        let t=0;
        for(let i=1;i<=150 && !(sled.x>100 && sled.vx>250 && sled.grounded);i++)game.step(t=i*dt,dt);
        fail(run.simClock.tick===120 && sled.x>100 && sled.vx>250 && sled.grounded && !run.crashed,`could not find pinned rendered state x=${sled.x} vx=${sled.vx}`);
        const signature=()=>JSON.stringify({tick:run.simClock.tick,runTime:run.runTimeMs,x:sled.x,y:sled.y,vx:sled.vx,vy:sled.vy,score:run.score.getSnapshot(),crashed:run.crashed});
        // The live run is now frozen. Synthetic samples cross from a 530 ms to a 330 ms ETA.
        const state = signature(), goAt = 1000, warnAt = 800;
        const vx = Math.max(60, sled.vx), nowCx = Math.round(sled.x + vx * 0.33);
        const fixture={w:40,h:24,cy:Math.round(sled.y+86),def:{id:'packetSpike',placement:'ground'}};
        const original={hazards:run.hazards,tracker:run.teleTracker,marks:run._teleMarks,play:run.playSfx,updateCamera:run.updateCamera,view:run._view,tri:gt.gfx.fillTriangle,edge:gt._edge,column:gt._column,visible:gt.gfx.visible};
        const renderer=game.renderer, gl=renderer.gl;
        let currentRight, activeSfx=[], time, branch, worldPoints;
        function makeCamera(right) {
          currentRight=right; cam.setZoom(1); cam.setRotation(0);
          cam.setScroll(right-W,fixture.cy-176);
        }
        function sample(visible) {
          // Render only: do not call game.step after the stock state is captured.
          gt.gfx.setVisible(visible);
          renderer.preRender();
          game.scene.render(renderer);
          renderer.postRender();
          const rgba=new Uint8Array(W*H*4);
          gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
          fail(gl.getError()===gl.NO_ERROR,'real WebGL pixel read failed');
          return rgba;
        }
        const compare=(a,b,box)=>{
          let changed=0, cueChanged=0, minX=W,maxX=-1,minY=H,maxY=-1;
          for (let i=0;i<a.length;i+=4) if (a[i]!==b[i] || a[i+1]!==b[i+1] || a[i+2]!==b[i+2]) {
            const pixel=i/4, x=pixel%W,y=H-1-Math.floor(pixel/W);
            changed++; minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y);maxY=Math.max(maxY,y);
            if(x>=Math.floor(box[0])-1 && x<=Math.ceil(box[2])+1 && y>=Math.floor(box[1])-1 && y<=Math.ceil(box[3])+1)cueChanged++;
          }
          return {changed,cueChanged,changedBounds:changed?[minX,minY,maxX,maxY]:null};
        };
        try {
          run.playSfx=(name,opts)=>activeSfx.push([time,name,opts?.brace??null]);
          run.updateCamera=()=>makeCamera(currentRight);
          gt.gfx.fillTriangle=function(...p){worldPoints=p;return original.tri.apply(this,p);};
          gt._edge=function(...a){branch='_edge';return original.edge.apply(this,a);};
          gt._column=function(...a){branch='_column';return original.column.apply(this,a);};
          function arm(name, planRight, renderRight) {
            const hazard={...fixture, cx:Math.round(sled.x+vx*.53)};
            activeSfx=[]; time=warnAt; worldPoints=null; branch=null;
            run.hazards=original.hazards;
            run._teleMarks=[];
            makeCamera(planRight);
            run.renderFrame(0);
            fail(run._view.right===planRight,'planned view not truly rendered');
            run.teleTracker=new original.tracker.constructor();
            // Inject only into the cue planner; the synthetic hazard never enters physics or rendering.
            run.hazards=new Map([[0,[hazard]]]);
            run.updateGroundTelegraph(time);
            const warnState=run._teleMarks[0]?.state;
            hazard.cx=nowCx;
            time=goAt;
            run.updateGroundTelegraph(time);
            const mark=run._teleMarks[0];
            fail(run._teleMarks.length===1 && warnState==='warn' && mark?.state==='go','synthetic hazard did not go through warn → go');
            run.hazards=original.hazards;
            makeCamera(renderRight);
            run.renderFrame(0);
            fail(run._view.right===renderRight && worldPoints?.length===6,'actual scene failed to draw one real triangle');
            const on=sample(true), off=sample(false), repeat=sample(true);
            fail(compare(on,repeat,[0,0,W,H]).changed===0,'repeat rendering was not stable');
            fail(compare(on,new Uint8Array(on.length),[0,0,W,H]).changed>W*H/2,'blank WebGL frame');
            const screen=[];
            for(let i=0;i<worldPoints.length;i+=2) {
              const p=cam.matrix.transformPoint(worldPoints[i]-cam.scrollX,worldPoints[i+1]-cam.scrollY);
              screen.push([p.x,p.y]);
            }
            const box=[Math.min(...screen.map(p=>p[0])),Math.min(...screen.map(p=>p[1])),Math.max(...screen.map(p=>p[0])),Math.max(...screen.map(p=>p[1]))];
            return {name,planRight,renderRight,branch,hazardSled:{x:sled.x-renderRight+W,left:hazard.cx-fixture.w/2-renderRight+W,center:hazard.cx-renderRight+W},
              mark:{state:mark.state,onScreen:mark.onScreen,arrivalMs:mark.arrivalMs},warnAtMs:hazard.teleAtMs,
              trackerWarn:run.teleTracker.firstWarnMs(hazard),trackerArrival:run.teleTracker.lastArrivalMs(hazard),sfx:activeSfx,
              triangleBounds:box,...compare(on,off,box)};
          }
          const arms=[arm('current-right partial box',nowCx-18,nowCx-18),arm('counterfactual edge, same viewport',nowCx-40,nowCx-18),
                      arm('previous right, camera retreats',nowCx+24,nowCx-40),arm('off-screen edge control',nowCx-40,nowCx-40)];
          fail(arms[0].renderRight === arms[1].renderRight && arms[2].renderRight === arms[3].renderRight,
            'counterfactual controls must match their capture view');
          fail(arms[0].hazardSled.left < W && arms[0].hazardSled.center > W && arms[2].hazardSled.left >= W,
            'fixtures must expose partial overlap and full off-screen retreat respectively');
          fail(arms[0].branch==='_column'&&arms[0].triangleBounds[0]>W&&arms[0].changed===0,'partial hazard did not clip entire real cue');
          fail(arms[2].branch==='_column'&&arms[2].triangleBounds[0]>W&&arms[2].changed===0,'stale camera did not clip entire real cue');
          for(const i of [1,3])fail(arms[i].branch==='_edge'&&arms[i].triangleBounds[2]<W&&arms[i].cueChanged>25,'control did not visibly draw edge cue');
          for(const a of arms) {
            fail(a.hazardSled.x>=34 && a.hazardSled.x<=W-34,'synthetic camera moved rider too near the viewport edge: '+a.hazardSled.x);
            fail(JSON.stringify(a.sfx)===JSON.stringify([[800,'groundWarn',false],[1000,'hopCue',null]]) &&
                 a.warnAtMs===800&&a.trackerWarn===800&&a.trackerArrival===arms[0].trackerArrival,'warn/go semantic traces differ');
          }
          fail(signature()===state,'authoritative samples changed during draw-only cases');
          return {renderer:'Phaser WebGL readPixels, composited framebuffer',dimensions:[W,H],seed:run.seed,simTick:run.simClock.tick,runTimeMs:run.runTimeMs,pose:{x:sled.x,y:sled.y,vx:sled.vx,vy:sled.vy},visualRule:'no rotation, zoom1',arms};
        } finally {
          run.hazards=original.hazards; run.teleTracker=original.tracker; run._teleMarks=original.marks; run.playSfx=original.play;
          run.updateCamera=original.updateCamera; run._view=original.view; gt.gfx.fillTriangle=original.tri; gt._edge=original.edge; gt._column=original.column; gt.gfx.setVisible(original.visible);
        }
      });
      assert.deepEqual(errors, [], 'Preview or browser error');
      return result;
    } finally {
      closing = true;
      await context.close();
    }
  }
  const a=await oneRun(),b=await oneRun();
  assert.deepEqual(a,b,'fresh browser contexts must yield identical evidence');
  const output={kind:'local-synthetic-ground-cue-render-proof',sameFreshContexts:2,browser:browser.version(),sourceCommit,entry,entrySha256:expectedBuild,resultSha256:sha(JSON.stringify(a)),...a};
  console.log(JSON.stringify(output,null,2));
} finally {await browser.close();}
