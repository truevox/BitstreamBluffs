/**
 * OWNER: gameplay engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * The run. Lifecycle (see ARCHITECTURE.md sections 5-6 for the full contract):
 *  create(): read REG.SEED / REG.CONTENT / REG.INPUT / REG.SAVE_STORE; build Rng-seeded TerrainGenerator, ScoreManager,
 *    TrickTracker, GlitchDirector, PhysicsTuner, DailyPatch rule; scene.launch(SCENES.UI); GlitchPipeline.install(this);
 *    emit EVT.RUN_START.
 *  update(time, delta): poll input -> stepWorld() sub-steps -> TrickTracker.update -> ScoreManager -> emit events
 *    -> TerrainGenerator.update(x) (add/remove chunks) -> GlitchDirector.update -> camera.
 *  crash: ScoreManager.onCrash, emit CRASH, build RunRecord, saveStore.saveRun, set REG.LAST_RECORD, emit RUN_END,
 *    after <= TIMING.crashToGameOverMs scene.start(SCENES.GAME_OVER).
 *  pause: on input `pressed.pause`: emit GAME_PAUSE, scene.pause(), scene.launch(SCENES.PAUSE, {runTimeMs}).
 *  shutdown: remove every game.events listener it added, stop UI scene.
 * STUB: shows a placeholder. Press X to simulate a crash, Esc to pause.
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { EVT } from '../events.js';
import { SaveStore } from '../systems/SaveStore.js';
import { GlitchPipeline } from '../shaders/GlitchPipeline.js';

export class RunScene extends Phaser.Scene {
  constructor() {
    super(SCENES.RUN);
  }

  create() {
    const seed = this.registry.get(REG.SEED);
    this.startedAt = Date.now();
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `RUN PLACEHOLDER\nseed: ${seed}\n[X] crash  [Esc] pause`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#9dff3a', align: 'center',
      })
      .setOrigin(0.5);
    GlitchPipeline.install(this);
    this.scene.launch(SCENES.UI);
    this.game.events.emit(EVT.RUN_START, { runId: `${this.startedAt}-${seed}`, seed, dailyRuleId: 'tuckBoost', startedAt: this.startedAt });

    this.input.keyboard.once('keydown-X', () => {
      const record = {
        version: 1, id: `${this.startedAt}-${seed}`, seed, dailyRuleId: 'tuckBoost', startedAt: this.startedAt,
        endedAt: Date.now(), durationMs: Date.now() - this.startedAt, score: 0, distanceM: 0, trickPoints: 0,
        tricks: {}, bestCombo: 1, maxAirtimeMs: 0, cause: 'crash', ledgerHash: '',
      };
      record.ledgerHash = SaveStore.computeLedgerHash(record);
      this.registry.set(REG.LAST_RECORD, record);
      this.game.events.emit(EVT.RUN_END, { record });
      this.scene.stop(SCENES.UI);
      this.scene.start(SCENES.GAME_OVER);
    });
    this.input.keyboard.once('keydown-ESC', () => {
      this.game.events.emit(EVT.GAME_PAUSE, { runTimeMs: 0 });
      this.scene.pause();
      this.scene.launch(SCENES.PAUSE, { runTimeMs: 0 });
    });
  }
}
