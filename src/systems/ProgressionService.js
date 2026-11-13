/**
 * OWNER: progression engineer. Thin service glue: owns one ProfileStore, listens to RUN_END, and
 * exposes the awards of the last run for GameOverScene to read. NO Phaser imports, no rendering.
 *
 * RunScene is not edited (spec §5 W1): the service subscribes to the global RUN_END event, computes
 * awards SYNCHRONOUSLY on the record it is handed, persists, and stores the awards object in the
 * registry under REG.LAST_AWARDS (additive key) for the UI to display.
 */
import { EVT } from '../events.js';
import { REG } from '../constants.js';
import { ProfileStore } from './ProfileStore.js';
import { levelForXp, xpToNext, rewardsForLevel, loadLevelTable } from './Progression.js';

/**
 * Create the progression service, load the profile (and backfill it once from stored runs if this
 * device already has history), and start listening for RUN_END.
 *
 * @param {Phaser.Game} game
 * @param {{levels:*, saveStore?:*, now?:function():number}} o  `levels` is the parsed levels.json.
 * @returns {Promise<ProgressionService>}
 */
export async function createProgressionService(game, o) {
  const service = new ProgressionService(game, o);
  await service.init();
  return service;
}

export class ProgressionService {
  /**
   * @param {Phaser.Game} game
   * @param {{levels:*, saveStore?:*, now?:function():number, store?:ProfileStore, missions?:*}} o
   */
  constructor(game, o) {
    this.game = game;
    this.levels = loadLevelTable(o.levels);
    // W2 missions attach here (set by createServices) so RUN_END has exactly one listener that
    // decides whether a run counts at all.
    this.missions = o.missions || null;
    this.store = o.store || new ProfileStore({ levels: this.levels });
    this.now = o.now || (() => Date.now());
    this.alive = true;
    this._onRunEnd = (payload) => this.onRunEnd(payload);
  }

  /** Load the profile, backfill once if the device already has runs, then subscribe. */
  async init() {
    this.alive = true;
    this.store.load();
    const saveStore = this.game.registry.get(REG.SAVE_STORE);
    if (saveStore && this.store.profile.lifetime.runs === 0) {
      try {
        // Backfill the complete local history; truncating here permanently loses lifetime stats on
        // devices with more runs than the UI's usual recent-history window.
        const runs = await saveStore.getRecentRuns(Number.MAX_SAFE_INTEGER);
        if (Array.isArray(runs) && runs.length) this.store.backfill(runs);
      } catch (e) { /* backfill is a nicety; never block boot on it */ }
    }
    this.game.events.on(EVT.RUN_END, this._onRunEnd);
    this.game.events.once('destroy', () => this.destroy());
    this.publish();
    return this;
  }

  /** @returns {Object} the live profile. */
  get profile() {
    return this.store.profile;
  }

  /**
   * RUN_END handler. Computes awards synchronously and publishes them for Game Over.
   * @param {{record:Object}} payload
   */
  onRunEnd(payload) {
    if (!this.alive) return;
    const record = payload && payload.record ? payload.record : null;
    const awards = record ? this.store.credit(record) : null;
    // Missions ride on the crediting decision, not on RUN_END itself: `credit()` returns null for a
    // run whose hash is already in the ring, so a replayed event pays missions nothing. Missions then
    // fold their own XP/shards into the same profile before the awards view is built, so Game Over
    // shows one consistent total.
    let missionRoll = null;
    if (awards && record && this.missions) {
      try {
        missionRoll = this.missions.onRunCredited(record);
      } catch (e) {
        // Missions must never break the boot or the run's XP: log-free degrade, carry on.
        missionRoll = null;
      }
    }
    const view = this._awardsView(awards, record, missionRoll);
    this.lastAwards = view;
    this.game.registry.set(REG.LAST_AWARDS, view);
    this.publish(view);
  }

  /** @returns {{xp:{total:number,parts:Array},levelBefore:number,levelAfter:number,leveledTo:number,rewards:Object|null,title:string|null,credited:boolean,progress:{level:number,xp:number,levelXp:number,nextXp:number,xpToNext:number}}} */
  _awardsView(awards, record, missionRoll) {
    const p = this.store.profile;
    const table = this.levels;
    const level = levelForXp(p.xp, table);
    const levelXp = table.levels[level - 1] ? table.levels[level - 1].xpMin : 0;
    const nextXp = level < table.cap ? table.levels[level].xpMin : levelXp;
    const rw = rewardsForLevel(level, table);
    return {
      xp: awards ? awards.xp : { total: 0, parts: [] },
      levelBefore: awards ? awards.levelBefore : level,
      levelAfter: awards ? awards.levelAfter : level,
      leveledTo: awards ? awards.leveledTo : 0,
      rewards: awards ? awards.rewards : null,
      // Every level crossed by THIS run, not just the last one: a big run can jump L1 -> L3 and the
      // L2 reward (e.g. trail-cyan) is still earned. Forwarded so Game Over can list all of them;
      // without this the rewards loop there reads undefined and silently drops prizes.
      rewardsEarned: awards && Array.isArray(awards.rewardsEarned) ? awards.rewardsEarned : [],
      title: awards ? awards.title : rw.title,
      credited: Boolean(awards),
      // Resonance bar: XP progress inside the current level.
      progress: {
        level,
        xp: p.xp,
        levelXp,
        nextXp,
        xpToNext: xpToNext(p.xp, table),
        ratio: nextXp > levelXp ? Math.min(1, Math.max(0, (p.xp - levelXp) / (nextXp - levelXp))) : 1,
      },
      record: record ? { id: record.id, seed: record.seed } : null,
      earnedCosmetics: awards && awards.rewards && awards.rewards.cosmetic ? [awards.rewards.cosmetic] : [],
      pendingBiomes: awards && awards.rewards && awards.rewards.biome ? [awards.rewards.biome] : [],
      // W2: what the mission set paid this run, for the Game Over list and the completion toast.
      missions: missionRoll ? {
        completed: missionRoll.completed || [],
        setCleared: Boolean(missionRoll.setCleared),
        xp: missionRoll.xp || 0,
        shards: missionRoll.shards || 0,
      } : null,
    };
  }

  /** Push the current profile + last awards into the registry so scenes can read them at any time. */
  publish(view) {
    const p = this.store.profile;
    this.game.registry.set(REG.PROFILE, p);
    if (view) this.game.registry.set(REG.LAST_AWARDS, view);
  }

  /** @returns {Object|null} awards object of the most recent run (for GameOverScene). */
  get awardsForDisplay() {
    return this.lastAwards || this.game.registry.get(REG.LAST_AWARDS) || null;
  }

  /** Detach the RUN_END listener (scene/game shutdown). */
  destroy() {
    this.alive = false;
    try { this.game.events.off(EVT.RUN_END, this._onRunEnd); } catch (e) { /* already gone */ }
  }
}
