/**
 * OWNER: UI engineer.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 * Started by RunScene (`scene.start(SCENES.GAME_OVER)`) after RUN_END. Reads the RunRecord from registry REG.LAST_RECORD
 * (RunScene already called saveStore.saveRun). Shows score, ledger hash (record.ledgerHash), share-seed (record.seed),
 * and if `await saveStore.qualifiesForTop10(score)` an initials entry (3+ chars) -> saveStore.setInitials(id, initials)
 * + updateSetting('lastInitials'). INSTANT RETRY: Space/Enter/tap restarts immediately with the SAME seed
 * (`scene.start(SCENES.RUN)`), even while the leaderboard query is pending; Esc/button -> Title.
 * STUB: Space retries.
 */
import Phaser from 'phaser';
import { SCENES, REG, GAME_WIDTH, GAME_HEIGHT } from '../constants.js';

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super(SCENES.GAME_OVER);
  }

  create() {
    const rec = this.registry.get(REG.LAST_RECORD);
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `GAME OVER\nscore ${rec ? rec.score : 0}\n(Space to retry)`, {
        fontFamily: 'monospace', fontSize: '14px', color: '#ffb000', align: 'center',
      })
      .setOrigin(0.5);
    this.input.keyboard.once('keydown-SPACE', () => this.scene.start(SCENES.RUN));
  }
}
