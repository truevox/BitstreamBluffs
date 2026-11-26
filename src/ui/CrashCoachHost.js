/**
 * #66: how the Crash Coach gets a hidden RunScene from Game Over. The coach never replaces Game Over: it LAUNCHES RunScene
 * beside it with a `{coachSim}` descriptor in the scene data (RunScene runs it hidden, silent and unranked), waits for its
 * create() to finish, simulates, and stops it again. A scene is used through its public `scene` / `events` members only.
 */
import { SCENES } from '../constants.js';
import { CoachCancelled } from '../systems/coach/EngineSimulator.js';

const MAX_WAIT_FRAMES = 240;
const FRAME_FALLBACK_MS = 250;

/** @param {Phaser.Scene} scene the host scene (GameOverScene) @param {{isCancelled?:()=>boolean}} [o] */
export function createSceneHost(scene, { isCancelled = () => false } = {}) {
  /** Shared with every descriptor: a handoff that reaches RunScene.create() after cancel() is refused there. */
  const live = { cancelled: false };
  let seq = 0;
  let disposal = null;
  const stopped = () => live.cancelled || isCancelled();
  const run = () => { try { return scene.scene.get(SCENES.RUN); } catch (e) { return null; } };

  /** One display frame of the host scene (a timer backs it up, so a host that stopped updating cannot hang the search). */
  const frame = () => new Promise((resolve) => {
    let done = false;
    let t = null;
    const fin = () => { if (!done) { done = true; clearTimeout(t); scene.events?.off?.('update', fin); resolve(); } };
    t = setTimeout(fin, FRAME_FALLBACK_MS);
    try { scene.events.once('update', fin); } catch (e) { fin(); }
  });

  const stopRun = () => { try { scene.scene.stop(SCENES.RUN); } catch (e) { /* not running */ } };

  return {
    live,
    frame,
    async acquire(tape) {
      if (stopped()) throw new CoachCancelled();
      const token = ++seq;
      stopRun(); // a fresh scene per simulation: Phaser resets the Matter world and every plugin on restart, like a retry does
      scene.scene.launch(SCENES.RUN, { coachSim: { kind: 'bb-coach-sim', tape, token, live } });
      for (let i = 0; i < MAX_WAIT_FRAMES; i++) {
        await frame();
        if (stopped()) throw new CoachCancelled();
        const r = run();
        if (r && r.coachSim && r.coachSim.live === live && r.coachSim.token === token && r.coachSim.created) return r;
      }
      throw new Error('the hidden simulation scene did not start');
    },
    release(r) {
      if (!live.cancelled && (!r || (r.coachSim?.live === live && r.coachSim.token === seq))) stopRun();
    },
    /** End the session: later handoffs are refused, the hidden scene stops, and the promise resolves once it is gone. */
    dispose() {
      if (disposal) return disposal;
      live.cancelled = true;
      stopRun();
      disposal = (async () => {
        for (let i = 0; i < 6; i++) {
          await frame();
          const r = run();
          if (!r || !r.sys || !r.sys.isActive || !r.sys.isActive() || r.coachSim?.live !== live) break;
        }
      })();
      return disposal;
    },
  };
}
