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

export function installTakeoverHook(scene, theme) {
  const lastTape = () => {
    const t = scene.registry.get(REG.LAST_GHOST_TAPE);
    return t && scene.rec && t.runId === scene.rec.id ? t : null;
  };
  if (!lastTape() || !scene.input || !scene.input.keyboard) return null;
  const hint = new NeonText(scene, theme, 6, GAME_HEIGHT - 5, 'T = TAKEOVER', { color: 'amber', vAnchor: 0.5, outline: 'none' });
  hint.setAlpha(0.7);
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
    if (!tape || scene.takeoverPicker || scene.leaving || scene.entry || scene.shopOpen || scene.ghostView) return;
    if (typeof scene.skipReveal === 'function') scene.skipReveal();
    if (typeof scene._cancelShopAutoprompt === 'function') scene._cancelShopAutoprompt();
    if (scene.input_) scene.input_.enabled = false; // GameOver must not also act on the picker's Enter / Space / arrows
    scene.takeoverDim = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6).setOrigin(0, 0).setDepth(400).setInteractive();
    scene.takeoverPicker = new TakeoverPicker(scene, theme, {
      tape, rulesetId: CURRENT_RULESET_ID, onClose: close,
      onLaunch: (tick) => {
        // re-check right before launching: the descriptor is a fresh, frozen copy of THIS tape
        const ok = takeoverEligible(tape, tick, { rulesetId: CURRENT_RULESET_ID });
        if (!ok.ok) return;
        scene.leaving = true;
        uiSfx(scene, 'uiSelect', { pitch: 1.3 });
        launchTakeover(scene, buildTakeoverDescriptor({ tape, tick, source: 'last-run' }));
      },
    });
    scene.takeoverInput = new MenuInput(scene, (a) => scene.takeoverPicker && scene.takeoverPicker.handleAction(a), { graceMs: 120 });
  };
  const onKey = () => open();
  scene.input.keyboard.on('keydown-T', onKey);
  scene.events.once('shutdown', () => {
    scene.input.keyboard?.off('keydown-T', onKey);
    close();
    try { hint.destroy(); } catch (e) { /* already gone */ }
  });
  return { open, close };
}
