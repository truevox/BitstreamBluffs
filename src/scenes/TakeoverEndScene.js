/**
 * #72: where a Replay Takeover ends (crash, BSOD catch or quit). Hosts TakeoverEndView. Never GameOverScene: a takeover has
 * no RunRecord, no leaderboard entry and no credits. Scene data: `{descriptor, cause, endTick, liveFromTick}`.
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { Theme } from '../ui/Theme.js';
import { MenuInput } from '../ui/MenuInput.js';
import { TakeoverEndView } from '../ui/TakeoverEndView.js';
import { launchTakeover } from '../ui/TakeoverLauncher.js';
import { retryDescriptor } from '../systems/replay/Takeover.js';
import { CURRENT_RULESET_ID } from '../systems/replay/currentRulesetId.js';
import { uiSfx } from '../ui/Sound.js';
import { PostcardEndView } from '../ui/PostcardEndView.js';
import { POSTCARD_SOURCE } from '../systems/replay/Takeover.js';
import { replyFromTakeoverTape, encodeReply } from '../systems/replay/Postcard.js';
import { copyText } from '../systems/replay/PostcardShare.js';

export class TakeoverEndScene extends Phaser.Scene {
  constructor() {
    super(SCENES.TAKEOVER_END);
  }

  /** @param {{descriptor:object, cause?:string}} data */
  init(data) {
    this.descriptor = (data && data.descriptor) || null;
    this.cause = (data && data.cause) || 'crash';
    this.outcome = (data && data.outcome) || null; // #67: how a postcard attempt ended
  }

  create() {
    this.leaving = false;
    this.cameras.main.setBackgroundColor('#05060f');
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 1).setOrigin(0, 0);
    this.theme = new Theme(this);
    // The player was mashing keys when the run ended: ignore input for a beat so a stray press cannot retry or leave.
    this.input_ = new MenuInput(this, (a) => this.view && this.view.handleAction(a), { graceMs: 600 });
    const post = !!(this.descriptor && this.descriptor.source === POSTCARD_SOURCE);
    this.view = post
      ? new PostcardEndView(this, this.theme, {
        tick: this.descriptor.tick, outcome: this.outcome, replyAvailable: !!this.outcome && this.outcome.result !== 'quit',
        onRetry: () => this.retry(), onClose: () => this.back(), onReply: () => this.copyReply(),
      })
      : new TakeoverEndView(this, this.theme, {
        tick: this.descriptor ? this.descriptor.tick : 0, cause: this.cause,
        onRetry: () => this.retry(), onClose: () => this.back(),
      });
  }

  /** #67: the reply code of the attempt that just ended, to the local clipboard. Never sent anywhere. */
  async copyReply() {
    try {
      const r = replyFromTakeoverTape({ tape: this.registry.get(REG.LAST_TAKEOVER_TAPE), descriptor: this.descriptor, outcome: this.outcome });
      if (!r.ok) return { ok: false, message: r.message };
      return await copyText(await encodeReply(r.reply), typeof navigator !== 'undefined' ? navigator : undefined);
    } catch (e) { return { ok: false, message: 'could not build the reply' }; }
  }

  /** Every retry is an independent attempt: rebuild the descriptor from the parent tape and RE-VALIDATE it. */
  retry() {
    if (this.leaving) return;
    this.leaving = true;
    const r = retryDescriptor(this.descriptor, { rulesetId: CURRENT_RULESET_ID });
    if (!r.ok) {
      this.registry.set(REG.TAKEOVER_NOTICE, { reason: r.reason, message: r.message, at: Date.now() });
      this.scene.start(SCENES.TITLE);
      return;
    }
    uiSfx(this, 'uiSelect', { pitch: 1.3 });
    launchTakeover(this, r.descriptor);
  }

  back() {
    if (this.leaving) return;
    this.leaving = true;
    this.scene.start(SCENES.TITLE);
  }
}
