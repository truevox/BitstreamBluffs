/**
 * #72: after a refused or aborted Replay Takeover the TitleScene says why. `REG.TAKEOVER_NOTICE` is one-shot: read and
 * cleared here, so it is shown exactly once. A refusal is never silent and never turns into an ordinary run.
 */
import { REG, GAME_WIDTH } from '../constants.js';
import { NeonText } from './Neon.js';
import { ellipsize } from './PixelFont.js';

/** Read AND clear the one-shot notice. @returns {{reason:string, message:string}|null} */
export function takeTakeoverNotice(registry) {
  try {
    const n = registry.get(REG.TAKEOVER_NOTICE) || null;
    registry.remove(REG.TAKEOVER_NOTICE);
    return n;
  } catch (e) { return null; }
}

/** @returns {{reason:string, message:string}|null} the notice shown */
export function showTakeoverNotice(scene, theme) {
  const n = takeTakeoverNotice(scene.registry);
  if (!n) return null;
  const line1 = new NeonText(scene, theme, GAME_WIDTH / 2, 6, 'TAKEOVER CANCELLED: UNRANKED PRACTICE NOT STARTED', { color: 'amber', anchor: 'center', outline: 'dark' }).setDepth(900);
  const line2 = new NeonText(scene, theme, GAME_WIDTH / 2, 17, ellipsize(String(n.message || n.reason || '').toUpperCase(), GAME_WIDTH - 24), { color: 'text', anchor: 'center', outline: 'dark' }).setDepth(900);
  try {
    scene.time.delayedCall(7000, () => { for (const t of [line1, line2]) if (t.scene) t.destroy(); });
  } catch (e) { /* tests without a clock keep the text */ }
  return n;
}
