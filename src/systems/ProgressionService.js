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
import { newlyAffordable, shopState } from './ShopPrompt.js';

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
    // W4.1: snapshot the spendable state BEFORE the run is credited, so the shop autoprompt can tell
    // whether THIS run newly made something affordable. Taken from the live profile rather than derived
    // from the credit afterwards, because both `credit()` and `applyMissions()` move the bank.
    const before = shopState(this.store.profile);
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
    // W4.1: decide the shop autoprompt here, where both the before- and after-credit state are known, and
    // publish it as a plain boolean. Game Over only renders it; it does not re-derive economy rules.
    // Not published for a replayed run (awards === null): that run paid nothing, so it changed nothing.
    const showShop = Boolean(awards) && this._shopAutoprompt(before);
    view.shopAutoprompt = showShop;
    this.lastAwards = view;
    this.game.registry.set(REG.LAST_AWARDS, view);
    this.publish(view);
  }

  /**
   * Did this run newly make a shop item affordable?
   *
   * Kept behind a guard because a broken economy must never stop a run from being credited: if anything
   * here throws, the answer is "no popup" and the run stands.
   * @param {{bank:number, level:number, owned:Array<string>}} before
   * @returns {boolean}
   */
  _shopAutoprompt(before) {
    try {
      const after = shopState(this.store.profile);
      return newlyAffordable(before, after);
    } catch (e) {
      return false;
    }
  }

  /** @returns {{xp:{total:number,parts:Array},levelBefore:number,levelAfter:number,leveledTo:number,rewards:Object|null,title:string|null,credited:boolean,progress:{level:number,xp:number,levelXp:number,nextXp:number,xpToNext:number}}} */
  _awardsView(awards, record, missionRoll) {
    const p = this.store.profile;
    const table = this.levels;
    const level = levelForXp(p.xp, table);
    const levelXp = table.levels[level - 1] ? table.levels[level - 1].xpMin : 0;
    const nextXp = level < table.cap ? table.levels[level].xpMin : levelXp;
    const rw = rewardsForLevel(level, table);
    // LVL-1: the level-up is measured from before the run to the profile AFTER missions folded their XP in,
    // not taken from credit() alone. A threshold crossed by mission XP used to raise the level silently: no
    // level-up line, no reward line, even though applyMissions granted the reward. Same shape as creditRun.
    const levelBefore = awards ? awards.levelBefore : level;
    const leveledTo = awards && level > levelBefore ? level : 0;
    const rewards = leveledTo ? rewardsForLevel(leveledTo, table) : null;
    // Every level crossed by THIS run, not just the last one: a big run can jump L1 -> L3 and the L2 reward
    // (e.g. trail-cyan) is still earned. Game Over lists all of them.
    const rewardsEarned = leveledTo
      ? table.levels.filter((e) => e.level > levelBefore && e.level <= leveledTo).map((e) => rewardsForLevel(e.level, table))
      : [];
    return {
      xp: awards ? awards.xp : { total: 0, parts: [] },
      levelBefore,
      levelAfter: level,
      leveledTo,
      rewards,
      rewardsEarned,
      title: rewards ? rewards.title : (awards ? null : rw.title),
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
      earnedCosmetics: rewards && rewards.cosmetic ? [rewards.cosmetic] : [],
      pendingBiomes: rewards && rewards.biome ? [rewards.biome] : [],
      // W5: achievements unlocked BY THIS RUN, so Game Over can announce them. Forwarded from the credit
      // result rather than re-read from the profile, which would include unlocks from earlier sessions and
      // re-announce them on every run.
      achievements: awards && Array.isArray(awards.achievements) ? awards.achievements : [],
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
