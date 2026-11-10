/**
 * OWNER: UI engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 * "Pascal's Ledger". Launched ON TOP of the paused RunScene by RunScene (scene.pause(RUN) + scene.launch(PAUSE)).
 * Resume: `scene.stop()`, `scene.resume(SCENES.RUN)`, emit EVT.GAME_RESUME {runTimeMs} (runTimeMs from the PausePayload it
 * received in launch data `{runTimeMs}`). Quit to title: emit EVT.RUN_ABORT {runId}, stop RUN/UI/PAUSE, start TITLE.
 * Contains: resume, leaderboard (SaveStore.getLeaderboard), settings (palette, screen shake, volumes) changed ONLY through
 * updateSetting() from src/services.js.
 * STUB: Esc resumes.
 */
import Phaser from 'phaser';
import { SCENES, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';
import { EVT } from '../events.js';

export class PauseScene extends Phaser.Scene {
  constructor() {
    super(SCENES.PAUSE);
  }

  /** @param {{runTimeMs:number}} data */
  init(data) {
    this.runTimeMs = (data && data.runTimeMs) || 0;
  }

  create() {
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, "PASCAL'S LEDGER\n(Esc to resume)", {
        fontFamily: 'monospace', fontSize: '14px', color: '#ff2bd6', align: 'center',
      })
      .setOrigin(0.5);
    this.input.keyboard.once('keydown-ESC', () => {
      this.scene.stop();
      this.scene.resume(SCENES.RUN);
      this.game.events.emit(EVT.GAME_RESUME, { runTimeMs: this.runTimeMs });
    });
  }
}
