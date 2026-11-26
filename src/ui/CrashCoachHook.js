/**
 * #66: the whole GameOverScene footprint of the Crash Coach, installed from TakeoverHook (one hook file for both Game Over
 * tools). C opens the CrashCoachView over Game Over, which stays running underneath with its input off (exactly like the
 * takeover picker). Closing (Esc / BACK) cancels the search, stops the hidden RunScene and gives Game Over its input back:
 * nothing about the finished run is read for writing, so the screen is as it was.
 */
import { REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { NeonText } from './Neon.js';
import { MenuInput } from './MenuInput.js';
import { CrashCoachView } from './CrashCoachView.js';
import { createSceneHost } from './CrashCoachHost.js';
import { coachContext, practiceDescriptor, COACH_TIME_BUDGET_MS } from './CrashCoachModel.js';
import { launchTakeover } from './TakeoverLauncher.js';
import { CURRENT_RULESET_ID } from '../systems/replay/currentRulesetId.js';
import { explainCrash } from '../systems/coach/CrashCause.js';
import { runCoach } from '../systems/coach/CrashCoach.js';
import { createEngineSimulator } from '../systems/coach/EngineSimulator.js';
import { uiSfx } from './Sound.js';

/**
 * Test seam (never set by the game): `globalThis.__bbCoachTest = {wrapSimulate(simulate) -> simulate, budget, timeBudgetMs, onResult(result)}`.
 * The Chromium proof uses it to inject a flaky simulator and to read the full result; production code never touches it.
 */
const testSeam = () => (typeof globalThis !== 'undefined' && globalThis.__bbCoachTest) || null;

/** C is allowed exactly when T is: never during initials entry, in the shop, the ghost view or another coach/takeover screen. */
export function coachKeyAllowed(scene) {
  return !(scene.takeoverPicker || scene.coachView || scene.leaving || scene.entry || scene.shopOpen || scene.ghostView);
}

export function coachHintVisible(scene) {
  return coachKeyAllowed(scene) || !!scene.coachView;
}

/** @returns {{open:function, close:function}|null} */
export function installCrashCoachHook(scene, theme) {
  if (!scene.input || !scene.input.keyboard) return null;
  const hint = new NeonText(scene, theme, 6, GAME_HEIGHT - 14, 'C = CRASH COACH', { color: 'amber', vAnchor: 0.5, outline: 'none' });
  hint.setAlpha(0.7);
  const syncHint = () => { try { if (hint.scene) hint.setVisible(coachHintVisible(scene)); } catch (e) { /* cosmetic */ } };
  syncHint();
  scene.events.on('update', syncHint);

  let session = null;
  const closeAll = () => {
    if (session) { session.cancelled = true; try { session.host.dispose(); } catch (e) { /* the scene may already be gone */ } session = null; }
    try { scene.coachView?.destroy(); } catch (e) { /* a failed teardown must not wedge the screen */ }
    scene.coachView = null;
    try { scene.coachInput?.destroy(); } catch (e) { /* already torn down */ }
    scene.coachInput = null;
    try { scene.coachDim?.destroy(); } catch (e) { /* already torn down */ }
    scene.coachDim = null;
    if (scene.input_ && !scene.leaving) scene.input_.enabled = true;
  };

  const startSearch = (ctx, cause, view) => {
    const seam = testSeam();
    const s = { cancelled: false, host: null };
    s.host = createSceneHost(scene, { isCancelled: () => s.cancelled || !scene.sys || !scene.sys.isActive() });
    session = s;
    let simulate = createEngineSimulator({ host: s.host, isCancelled: () => s.cancelled });
    if (seam && typeof seam.wrapSimulate === 'function') simulate = seam.wrapSimulate(simulate);
    runCoach({
      tape: ctx.tape, crashTick: ctx.crashTick, lastCrash: ctx.lastCrash, simulate,
      budget: seam && seam.budget !== undefined ? seam.budget : undefined,
      timeBudgetMs: seam && seam.timeBudgetMs !== undefined ? seam.timeBudgetMs : COACH_TIME_BUDGET_MS,
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      onProgress: (p) => { if (!s.cancelled) view.setProgress(p); },
      shouldStop: () => s.cancelled,
    }).then((result) => {
      if (s.cancelled) return;
      if (seam && typeof seam.onResult === 'function') seam.onResult(result);
      view.setResult(result);
      s.host.dispose();
    }).catch((e) => {
      if (s.cancelled) return;
      console.warn('Crash Coach search failed', e);
      view.setFailed(e && e.message);
      s.host.dispose();
    });
  };

  const practice = (ctx) => {
    if (scene.leaving) return;
    if (scene.entry) { closeAll(); return; }
    const d = practiceDescriptor(ctx, CURRENT_RULESET_ID);
    if (!d.ok) { scene.registry.set(REG.TAKEOVER_NOTICE, { reason: d.reason, message: d.message, at: Date.now() }); return; }
    const host = session && session.host;
    if (session) session.cancelled = true;
    scene.leaving = true; // Game Over is being left: no second launch, and its input stays off
    uiSfx(scene, 'uiSelect', { pitch: 1.3 });
    const go = () => {
      if (!scene.sys?.isActive()) return;
      scene.coachView?.destroy(); scene.coachView = null;
      launchTakeover(scene, d.descriptor);
    };
    // the hidden simulation scene must be GONE before the takeover starts its own RunScene
    if (host) host.dispose().then(go, go); else go();
  };

  const open = () => {
    if (!coachKeyAllowed(scene)) return;
    const tape = scene.registry.get(REG.LAST_GHOST_TAPE);
    const lastCrash = scene.registry.get(REG.LAST_CRASH);
    const runId = scene.rec && scene.rec.id;
    if (typeof scene.skipReveal === 'function') scene.skipReveal();
    if (typeof scene._cancelShopAutoprompt === 'function') scene._cancelShopAutoprompt();
    if (scene.input_) scene.input_.enabled = false;
    scene.coachDim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7).setOrigin(0, 0).setDepth(400).setInteractive();
    const ctx = coachContext({ tape, lastCrash, runId, rulesetId: CURRENT_RULESET_ID });
    const crashTick = ctx.ok ? ctx.crashTick : (tape && Number.isFinite(tape.endTick) ? tape.endTick + 1 : undefined);
    const cause = explainCrash({ lastCrash: lastCrash && lastCrash.runId === runId ? lastCrash : null, crashTick, tape: ctx.ok ? tape : null });
    const view = new CrashCoachView(scene, theme, { ctx, cause, onClose: closeAll, onPractice: () => practice(ctx) });
    scene.coachView = view;
    scene.coachInput = new MenuInput(scene, (a) => scene.coachView && scene.coachView.handleAction(a), { graceMs: 120 });
    if (ctx.ok) startSearch(ctx, cause, view);
  };

  const onKey = () => open();
  scene.input.keyboard.on('keydown-C', onKey);
  scene.events.once('shutdown', () => {
    scene.input.keyboard?.off('keydown-C', onKey);
    scene.events.off('update', syncHint);
    closeAll();
    try { hint.destroy(); } catch (e) { /* already gone */ }
  });
  return { open, close: closeAll };
}
