/**
 * #72: the whole GameOverScene footprint of Replay Takeover. GameOverScene calls installTakeoverHook(this, theme) once;
 * this file adds the T key, the footer hint, the picker (own input, GameOver's input disabled while it is open) and the
 * launch. If the last run left no tape (Gym, or a recorder failure) nothing is installed.
 */
import { REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { NeonText } from './Neon.js';
import { MenuInput } from './MenuInput.js';
import { TakeoverPicker } from './TakeoverPicker.js';
import { buildTakeoverDescriptor, takeoverEligible } from '../systems/replay/Takeover.js';
import { CURRENT_RULESET_ID } from '../systems/replay/currentRulesetId.js';
import { launchTakeover } from './TakeoverLauncher.js';
import { uiSfx } from './Sound.js';
import { showTakeoverNotice } from './TakeoverNotice.js';
import { installCrashCoachHook } from './CrashCoachHook.js';

/**
 * T opens the picker only when Game Over is idle: never while the initials entry (or any text entry) is active, where T is a
 * letter, and never while the shop, ghost view or picker is open or the scene is leaving.
 */
export function takeoverKeyAllowed(scene) {
  return !(scene.takeoverPicker || scene.coachView || scene.leaving || scene.entry || scene.shopOpen || scene.ghostView);
}

/** The "T = TAKEOVER" footer hint shows only while the key would work (not during initials entry). */
export function takeoverHintVisible(scene) {
  return takeoverKeyAllowed(scene) || !!scene.takeoverPicker;
}

/**
 * What the picker's launch does. If GameOver's asynchronous board load created the initials entry AFTER the picker opened,
 * launching would leave a qualifying ranked run's initials prompt unseen: go back to the entry instead. The eligibility is
 * re-checked against THIS tape right before the descriptor (a fresh, frozen copy) is built.
 * @returns {{action:'back-to-entry'}|{action:'refused', result:{reason:string, message:string}}|{action:'launch', descriptor:object}}
 */
export function decideTakeoverLaunch(scene, tape, tick) {
  if (scene.entry) return { action: 'back-to-entry' };
  const ok = takeoverEligible(tape, tick, { rulesetId: CURRENT_RULESET_ID });
  if (!ok.ok) return { action: 'refused', result: ok };
  return { action: 'launch', descriptor: buildTakeoverDescriptor({ tape, tick, source: 'last-run' }) };
}

export function installTakeoverHook(scene, theme) {
  const lastTape = () => {
    const t = scene.registry.get(REG.LAST_GHOST_TAPE);
    return t && scene.rec && t.runId === scene.rec.id ? t : null;
  };
  if (!lastTape() || !scene.input || !scene.input.keyboard) return null;
  const hint = new NeonText(scene, theme, 6, GAME_HEIGHT - 5, 'T = TAKEOVER', { color: 'amber', vAnchor: 0.5, outline: 'none' });
  hint.setAlpha(0.7);
  const syncHint = () => { try { if (hint.scene) hint.setVisible(takeoverHintVisible(scene)); } catch (e) { /* cosmetic */ } };
  syncHint();
  scene.events.on('update', syncHint);
  const close = () => {
    try { scene.takeoverPicker?.destroy(); } catch (e) { /* a failed teardown must not wedge the screen */ }
    scene.takeoverPicker = null;
    try { scene.takeoverInput?.destroy(); } catch (e) { /* already torn down */ }
    scene.takeoverInput = null;
    try { scene.takeoverDim?.destroy(); } catch (e) { /* already torn down */ }
    scene.takeoverDim = null;
    if (scene.input_) scene.input_.enabled = true;
  };
  const open = () => {
    const tape = lastTape();
    if (!tape || !takeoverKeyAllowed(scene)) return;
    if (typeof scene.skipReveal === 'function') scene.skipReveal();
    if (typeof scene._cancelShopAutoprompt === 'function') scene._cancelShopAutoprompt();
    if (scene.input_) scene.input_.enabled = false; // GameOver must not also act on the picker's Enter / Space / arrows
    scene.takeoverDim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6).setOrigin(0, 0).setDepth(400).setInteractive();
    scene.takeoverPicker = new TakeoverPicker(scene, theme, {
      tape, rulesetId: CURRENT_RULESET_ID, onClose: close,
      onLaunch: (tick) => {
        const d = decideTakeoverLaunch(scene, tape, tick);
        if (d.action === 'back-to-entry') { close(); return; } // the initials prompt appeared while the picker was open
        if (d.action === 'refused') {
          scene.registry.set(REG.TAKEOVER_NOTICE, { reason: d.result.reason, message: d.result.message, at: Date.now() });
          showTakeoverNotice(scene, theme);
          return;
        }
        scene.leaving = true;
        uiSfx(scene, 'uiSelect', { pitch: 1.3 });
        launchTakeover(scene, d.descriptor);
      },
    });
    scene.takeoverInput = new MenuInput(scene, (a) => scene.takeoverPicker && scene.takeoverPicker.handleAction(a), { graceMs: 120 });
  };
  const onKey = () => open();
  scene.input.keyboard.on('keydown-T', onKey);
  installCrashCoachHook(scene, theme); // #66: C = Crash Coach, the other Game Over tool, lives in its own file
  scene.events.once('shutdown', () => {
    scene.input.keyboard?.off('keydown-T', onKey);
    scene.events.off('update', syncHint);
    close();
    try { hint.destroy(); } catch (e) { /* already gone */ }
  });
  return { open, close };
}
