/**
 * OWNER: progression engineer. Thin glue: owns the active mission list, rolls it on RUN_END, and
 * publishes UI state. NO Phaser imports, no rendering, no storage of its own.
 *
 * Why this is called BY ProgressionService rather than subscribing to RUN_END itself: crediting is
 * idempotent against the profile's `credited` ring, and that decision belongs to ProgressionService.
 * If missions listened to RUN_END independently, "did this run already pay?" would come down to
 * listener order — a replayed event could pay missions once and XP zero times, or the reverse. One
 * listener, one decision, no second ring.
 */
import { EVT } from '../events.js';
import { REG } from '../constants.js';
import {
  rollSet, activeTemplates, missionState, xpForTemplate, shardsForTemplate, satisfies,
} from './Missions.js';

export class MissionsService {
  /**
   * @param {Phaser.Game} game
   * @param {{templates:Array, store:*, now?:function():number}} o
   */
  constructor(game, o) {
    this.game = game;
    this.templates = Array.isArray(o && o.templates) ? o.templates : [];
    this.store = o && o.store;
    this.now = (o && o.now) || (() => Date.now());
    this.alive = true;
    this.lastRoll = null;
    this._bound = [];
    this._subscribed = false;
    this._completedThisRun = new Set();
    this.resetLive();
  }

  /** @returns {Object} the live profile. */
  get profile() {
    return this.store ? this.store.profile : null;
  }

  /**
   * Boot: make sure the profile has a full set of missions, then publish. Deterministic — the draw
   * depends only on the profile's counter and unlocks, so this is safe to run on every boot.
   * @returns {Promise<MissionsService>}
   */
  async init() {
    this.alive = true;
    this.ensureSlots();
    this.publish();
    this._subscribe();
    this.game.events.once('destroy', () => this.destroy());
    return this;
  }

  /**
   * Track live counters and toast a mission the moment it is met, rather than waiting for RUN_END.
   * The spec asks for exactly this: "evaluated from the final RunRecord plus live events ... so a
   * mid-run completion can toast immediately". Only the counters a mission can actually use are
   * tracked, and none of it is persisted — the final roll at RUN_END is still the source of truth
   * for payout, which is what keeps the live path from ever double-paying.
   */
  _subscribe() {
    const ev = this.game.events;
    if (!ev || this._subscribed) return;
    this._subscribed = true;
    const on = (name, fn) => { ev.on(name, fn); this._bound.push([name, fn]); };

    this.resetLive();
    on(EVT.RUN_START, () => { this.resetLive(); this._completedThisRun.clear(); });
    on(EVT.DISTANCE_CHANGED, (p) => { this.live.distanceM = (p && p.meters) || 0; this._checkLive(); });
    on(EVT.SCORE_CHANGED, (p) => { this.live.score = (p && p.total) || 0; this._checkLive(); });
    on(EVT.SHARD_COLLECTED, () => { this.live.shards += 1; this._checkLive(); });
    on(EVT.NEAR_MISS, () => { this.live.nearMisses += 1; this._checkLive(); });
    on(EVT.COMBO_CHANGED, (p) => { this.live.bestCombo = Math.max(this.live.bestCombo, (p && p.multiplier) || 1); this._checkLive(); });
    on(EVT.LANDING, (p) => {
      const ms = (p && (p.airMs || p.airtimeMs)) || 0;
      if (ms > this.live.maxAirtimeMs) this.live.maxAirtimeMs = ms;
      this._checkLive();
    });
    on(EVT.TRICK, (p) => {
      const t = p && (p.type || p.trick);
      if (typeof t === 'string') this.live.tricks[t] = (this.live.tricks[t] || 0) + 1;
      this._checkLive();
    });
  }

  /** Zero the live counters for a fresh run. */
  resetLive() {
    this.live = { distanceM: 0, score: 0, shards: 0, nearMisses: 0, bestCombo: 1, maxAirtimeMs: 0, tricks: {} };
    if (!this._completedThisRun) this._completedThisRun = new Set();
  }

  /**
   * Publish a mid-run toast for any mission whose target the live counters just met. Nothing is
   * paid here — `onRunCredited` at RUN_END remains the only place that pays, so the live path cannot
   * double-award even if a metric oscillates.
   */
  _checkLive() {
    if (!this.alive || !this.store) return;
    const p = this.profile;
    if (!p) return;
    const ctx = { live: this.live, record: this.live, profile: p };
    for (const t of activeTemplates(p, this.templates)) {
      if (!t || this._completedThisRun.has(t.id)) continue;
      let met = false;
      try { met = satisfies(t, ctx); } catch (e) { met = false; }
      if (!met) continue;
      this._completedThisRun.add(t.id);
      this.game.events.emit(EVT.MISSION_COMPLETED, {
        id: t.id, title: t.title, xp: xpForTemplate(t), shards: shardsForTemplate(t),
      });
    }
  }

  /** Fill any empty mission slots and persist. Safe to call repeatedly. */
  ensureSlots() {
    const p = this.profile;
    if (!p || !this.store) return null;
    const active = activeTemplates(p, this.templates);
    if (active.length >= 3) return null;
    // Reuse the roll path with a synthetic empty record: no mission completes, it only refills.
    const out = rollSet(p, [], { ledgerHash: '', distanceM: 0 }, this.templates, {
      ruleId: p.missions && p.missions.ruleId ? p.missions.ruleId : null,
    });
    this.store.applyMissions(out);
    return out;
  }

  /**
   * Apply a finished run to the mission set. Called by ProgressionService only after the run was
   * genuinely credited, so idempotency is already guaranteed upstream.
   *
   * @param {Object} record the finished RunRecord
   * @returns {Object|null} roll result, or null if nothing could be applied
   */
  onRunCredited(record) {
    if (!this.alive) return null;
    const p = this.profile;
    if (!p || !this.store) return null;
    const active = activeTemplates(p, this.templates);
    const out = rollSet(p, active, record || {}, this.templates, {
      ruleId: p.missions && p.missions.ruleId ? p.missions.ruleId : null,
    });
    this.store.applyMissions(out);
    this.lastRoll = out;
    this.publish(out);
    return out;
  }

  /**
   * Live progress for one mission during a run, for a mid-run toast. Cheap and pure.
   * @param {Object} template
   * @param {{record?:*, live?:*}} ctx
   */
  stateFor(template, ctx) {
    const p = this.profile;
    return missionState(template, { ...ctx, profile: p });
  }

  /**
   * Publish the mission view for the UI: the three actives with their progress, ready to draw.
   * Scenes read this from the registry instead of recomputing geometry.
   * @param {Object} [roll] result of the last roll, if any
   */
  publish(roll) {
    const p = this.profile;
    if (!p) return;
    const actives = activeTemplates(p, this.templates);
    const progress = (p.missions && p.missions.progress) || {};
    const rows = actives.map((t) => {
      const banked = progress[t.id] || 0;
      const st = missionState(t, {
        record: banked ? { shards: banked, distanceM: banked, score: banked, nearMisses: banked, maxAirtimeMs: banked, bestCombo: banked, tricks: {} } : {},
        profile: p,
      });
      return {
        id: t.id,
        title: t.title,
        type: t.type,
        tier: t.tier,
        biome: t.biome || null,
        fraction: st.fraction,
        text: st.text,
        done: st.done,
        xp: xpForTemplate(t),
        shards: shardsForTemplate(t),
      };
    });
    const view = {
      active: rows,
      // Completed this run: what the toast and Game Over should list.
      completed: roll && Array.isArray(roll.completed) ? roll.completed : [],
      setCleared: Boolean(roll && roll.setCleared),
      xp: roll ? roll.xp : 0,
      shards: roll ? roll.shards : 0,
    };
    this.game.registry.set(REG.MISSIONS, view);
  }

  /** Detach. Safe to call twice. */
  destroy() {
    this.alive = false;
    const ev = this.game && this.game.events;
    if (ev) for (const [name, fn] of this._bound) ev.off(name, fn);
    this._bound.length = 0;
    this._subscribed = false;
  }
}

/**
 * Build and initialise the missions service.
 * @param {Phaser.Game} game
 * @param {{templates:Array, store:*, now?:function():number}} o
 * @returns {Promise<MissionsService>}
 */
export async function createMissionsService(game, o) {
  const svc = new MissionsService(game, o);
  await svc.init();
  return svc;
}
