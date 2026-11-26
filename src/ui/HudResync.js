/**
 * #72: rebuild the UIScene HUD from RunScene.hudSnapshot() after a takeover seek (the seek ran with events muted, so the
 * event-driven HUD heard nothing). It reuses UIScene's own painters, minus the popups. Cosmetic omissions: the glitch visual
 * in progress at tick N and transient banners (biome / milestone / hints) are not reconstructed.
 */
import { GAME_HEIGHT } from '../constants.js';

/** @param {Phaser.Scene} ui the UIScene @param {ReturnType<import('../scenes/RunScene.js').RunScene['prototype']['hudSnapshot']>} s */
export function applyHudResync(ui, s) {
  if (!ui || !s) return;
  for (const id of [...ui.powerups.keys()]) ui._removePowerup(id);
  for (const key of [...ui.effects.keys()]) ui._removeEffect(key);
  ui.zones = [];
  ui.onScore({ total: s.score });
  ui.multiplier = 1; // onCombo pops only on growth; this is a resync, not a gain
  ui.onCombo({ multiplier: s.multiplier, tricks: s.tricks, pendingPoints: s.pendingPoints });
  ui.onDistance({ meters: s.meters });
  ui.onSpeed({ speedPxS: s.speedPxS, flow: s.flow, flowFrac: s.flowFrac });
  for (const p of s.power) {
    const t = ui._t(0, GAME_HEIGHT - 26, '', { color: 'text', outline: 'dark' });
    ui.powerups.set(p.id, { total: p.remainingMs > 0 ? p.totalMs : 0, remaining: p.remainingMs, charges: p.charges || 0, text: t });
  }
  ui._paintPowerups();
  ui._layoutPowerups();
  for (const e of s.effects) {
    ui.onHazard({ effect: e.effect, durationMs: e.remainingMs });
    const entry = ui.effects.get(e.effect);
    if (entry) { entry.remaining = e.remainingMs; ui._updateEffect(e.effect, entry); }
  }
  for (const modId of s.zones) ui.zones.push({ modId });
  ui._refreshZone();
}
