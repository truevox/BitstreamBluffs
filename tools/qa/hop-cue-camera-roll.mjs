/** #155: synthetic camera roll and hop-cue fallback baseline in the compiled Phaser renderer. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:8455/' } } });
assert.match(values.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'Use an HTTP loopback preview root with an explicit port');
const endpoint = new URL(values.url);
const entry = '/assets/main-CnvlsBaW.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceCommit = 'bb9fafd71f4a700b3c544bae3fa028996ee31669';
const expectedBuild = 'c733706b6fe810c335ac3966b009a16ed34bc84409db4a739b3543d0b985f41c';
const browser = await chromium.launch({headless:true, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'], executablePath:process.env.CHROMIUM_EXECUTABLE});
try {
  async function oneRun() {
    let closing = false, buildChecked = false, indexChecked = false;
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
          if (url.pathname === '/' && request.isNavigationRequest()) {
            assert.equal(response.status(), 200, 'Normal app entry was not served');
            assert.equal(sha(await response.body()), 'c1d9d45f390809882320830957a9dc8ecd11f18a541241428273245a159ec75b',
              'Wrong compiled index SHA-256');
            indexChecked = true;
          }
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
      try {
        await page.goto(endpoint.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } catch (error) {
        if (errors.length) throw new Error(errors[0]);
        throw error;
      }
      const bootEntry = await page.locator('script[type=module][src]').getAttribute('src', { timeout: 5000 });
      assert.deepEqual(errors, [], 'Preview or browser error');
      assert.ok(indexChecked && buildChecked && bootEntry === entry, 'Use the pinned compiled preview, not Vite dev or a different build');
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
        const fixture={hid:'pulp-roll-qa:0',w:40,h:24,cy:Math.round(sled.y+86),def:{id:'packetSpike',placement:'ground'}};
        const original={hazards:run.hazards,tracker:run.teleTracker,marks:run._teleMarks,play:run.playSfx,updateCamera:run.updateCamera,view:run._view,tri:gt.gfx.fillTriangle,edge:gt._edge,column:gt._column,visible:gt.gfx.visible};
        const renderer=game.renderer, gl=renderer.gl;
        let currentRight, roll=0, offset=185, activeSfx=[], time, branch, worldPoints, forceEdge=false;
        function makeCamera(right) {
          currentRight=right; cam.setZoom(1); cam.setRotation(roll*Math.PI/180);
          cam.setScroll(right-W,fixture.cy-offset);
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
          // Test-only A/B: force the same mark through the existing badge
          // without changing the camera, planner, state or shipped renderer.
          gt._column=function(g,t,mark,k,...rest){
            if (forceEdge) return this._edge(g,t,mark,k,run._view,run.terrain?.activeList,0);
            branch='_column';
            return original.column.call(this,g,t,mark,k,...rest);
          };
          function arm(name, right, angle, vertical, badge=false) {
            roll=angle; offset=vertical; forceEdge=badge;
            const hazard={...fixture, cx:Math.round(sled.x+vx*.53)};
            activeSfx=[]; time=warnAt; worldPoints=null; branch=null;
            run.hazards=original.hazards;
            run._teleMarks=[];
            makeCamera(right);
            run.renderFrame(0);
            fail(run._view.right===right,'planned view not truly rendered');
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
            makeCamera(right);
            run.renderFrame(0);
            fail(run._view.right===right && worldPoints?.length===6,'actual scene failed to draw one real triangle');
            const on=sample(true), off=sample(false), repeat=sample(true);
            fail(compare(on,repeat,[0,0,W,H]).changed===0,'repeat rendering was not stable');
            fail(compare(on,new Uint8Array(on.length),[0,0,W,H]).changed>W*H/2,'blank WebGL frame');
            const screen=[];
            for(let i=0;i<worldPoints.length;i+=2) {
              const p=cam.matrix.transformPoint(worldPoints[i]-cam.scrollX,worldPoints[i+1]-cam.scrollY);
              screen.push([p.x,p.y]);
            }
            const box=[Math.min(...screen.map(p=>p[0])),Math.min(...screen.map(p=>p[1])),Math.max(...screen.map(p=>p[0])),Math.max(...screen.map(p=>p[1]))];
            const rider=cam.matrix.transformPoint(sled.x-cam.scrollX,sled.y-cam.scrollY);
            return {name,roll,offset,badge,branch,rider:[rider.x,rider.y],
              mark:{state:mark.state,onScreen:mark.onScreen,arrivalMs:mark.arrivalMs},warnAtMs:hazard.teleAtMs,
              trackerWarn:run.teleTracker.firstWarnMs(hazard),trackerArrival:run.teleTracker.lastArrivalMs(hazard),sfx:activeSfx,
              triangleBounds:box,...compare(on,off,box)};
          }
          const right=nowCx+12;
          const arms=[arm('high level',right,0,185),arm('high rolled',right,6,185),
                      arm('low level',right,0,344),arm('low rolled',right,-6,344),
                      arm('high rolled badge control',right,6,185,true),
                      arm('low rolled badge control',right,-6,344,true)];
          const fullyIn=([x0,y0,x1,y1])=>x0>=1 && y0>=1 && x1<=W-1 && y1<=H-1;
          for (const i of [0,2]) fail(arms[i].branch==='_column' && fullyIn(arms[i].triangleBounds) && arms[i].cueChanged>5,
            'level positive control missing: '+JSON.stringify(arms[i]));
          for (const i of [1,3]) fail(arms[i].branch==='_column' && arms[i].triangleBounds[2]>W &&
            arms[i].triangleBounds[0]<W && arms[i].cueChanged>0, 'rolled clipping not observed: '+JSON.stringify(arms[i]));
          for (const i of [4,5]) fail(arms[i].branch==='_edge' && fullyIn(arms[i].triangleBounds) && arms[i].cueChanged>5,
            'rolled badge positive control missing: '+JSON.stringify(arms[i]));
          for(const a of arms) {
            fail(a.rider.every(Number.isFinite) && a.rider[0]>=0 && a.rider[0]<W && a.rider[1]>=0 && a.rider[1]<H,'fixture rider left the viewport');
            fail(JSON.stringify(a.sfx)===JSON.stringify([[800,'groundWarn',false],[1000,'hopCue',null]]) &&
                 a.warnAtMs===800&&a.trackerWarn===800&&a.trackerArrival===arms[0].trackerArrival,'warn/go semantic traces differ');
          }
          fail(signature()===state,'authoritative samples changed during draw-only cases');
          return {renderer:'Phaser WebGL readPixels, composited framebuffer',dimensions:[W,H],seed:run.seed,simTick:run.simClock.tick,runTimeMs:run.runTimeMs,pose:{x:sled.x,y:sled.y,vx:sled.vx,vy:sled.vy},visualRule:'synthetic +/-6 degree rolls, zoom1',arms};
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
  const output={kind:'local-synthetic-ground-cue-roll-proof',sameFreshContexts:2,browser:browser.version(),sourceCommit,entry,entrySha256:expectedBuild,resultSha256:sha(JSON.stringify(a)),...a};
  console.log(JSON.stringify(output,null,2));
} finally {await browser.close();}
