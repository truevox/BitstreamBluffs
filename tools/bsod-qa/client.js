/** Injected ONLY by tools/bsod-qa/serve.mjs, never by the game's index.html. */
import { parseBsodQaQuery, BSOD_QA_PRESETS } from './presets.mjs';
import { EVT } from '../../src/events.js';
import { REG } from '../../src/constants.js';
// Make module evaluation order explicit: the injected QA module can otherwise
// execute before the separate <script type=module src=/src/main.js> completes.
import { game } from '../../src/main.js';


const qa = parseBsodQaQuery(location.search);
if (qa) {
  // Imported from the identical ESM URL as the page: one Phaser instance,
  // regardless of script fetch/evaluation order.
  // The Title's normal entry controls remain playable, but the scenario seed,
  // mask and unranked flag are enforced for BOTH candidates, including retries.
  const installTitleOverride = () => {
    const title = game.scene.getScene('TitleScene');
    if (!title) { requestAnimationFrame(installTitleOverride); return; }
    const originalStart = title.startRun;
    title.startRun = function () { return originalStart.call(this, qa.seed, 0, { official: false }); };
  };
  installTitleOverride();

  let progressionListenerDetached = false;
  game.events.on(EVT.RUN_START, () => {
    const scene = game.scene.getScene('RunScene');
    if (!scene?.bsod || !scene?.bsodState) throw new Error('QA expected authoritative pursuer');
    const edge = scene.bsod.wallX + scene.bsodState.gapPx;
    const gap = scene.bsodState.gapPx + qa.gapOffsetPx;
    if (gap <= 0) throw new Error('QA scenario overlaps rider');
    scene.bsod.wallX = edge - gap;
    scene.bsod.wallSpeedPxS = qa.initialSpeedPxS;
    scene.bsod.accelerationPxS2 *= qa.accelFactor;
    // The production curve is now authoritative; original comparison variants
    // explicitly disable only the final easing, without changing game defaults.
    scene.bsod.config.softFinishMaxReduction = qa.softFinish ? 0.18 : 0;
    scene.bsodState = scene.bsod.state(edge, scene.sled.vx, 1);
    // Local QA is completely unranked: suppress run, ghost and progression
    // persistence. Keep the in-memory record for the Game Over screen.
    if (scene.saveStore) scene.saveStore = { ...scene.saveStore, saveRun: () => Promise.resolve() };
    scene._saveGhostTape = () => {};
    game.registry.set(REG.LAST_AWARDS, null); // Do not display awards left over from an earlier run.
    // QA runs must not award XP/shards/missions. Remove ONLY the progression
    // service's own crediting callback; RUN_END is also how InputRouter,
    // AudioSynth and UIScene reset real input/audio/HUD state after a crash.
    // This QA page runs in its own browser document; normal game listeners
    // are untouched, and an ordinary run in another page still credits XP.
    const progression = game.registry.get(REG.PROGRESSION);
    if (!progression || typeof progression._onRunEnd !== 'function') {
      throw new Error('QA cannot safely isolate progression crediting');
    }
    if (!progressionListenerDetached) {
      if (!game.events.listeners(EVT.RUN_END).includes(progression._onRunEnd)) {
        throw new Error('QA progression crediting listener not found');
      }
      game.events.off(EVT.RUN_END, progression._onRunEnd);
      progressionListenerDetached = true;
    }
    progression.lastAwards = null;
    window.__bsodQaEvidence = { preset: qa.name, seed: qa.seed, initialGapPx: gap,
      initialSpeedPxS: scene.bsod.wallSpeedPxS, effectiveAccelerationPxS2: scene.bsod.accelerationPxS2,
      softFinish: !!qa.softFinish, noSave: true };
  });

  const aside = document.createElement('aside');
  aside.id = 'bsod-qa-toolbar';
  aside.setAttribute('aria-label', 'Local-only BSOD A/B playtest');
  Object.assign(aside.style, {
    position: 'fixed', top: '8px', left: '8px', zIndex: '9999', background: '#07111ff0',
    border: '2px solid #54e0e0', borderRadius: '8px', padding: '8px 12px',
    color: '#efffff', font: '13px/1.6 monospace', maxWidth: '330px',
  });
  const heading = document.createElement('div');
  heading.textContent = `LOCAL QA ONLY — ${qa.label} — seed ${qa.seed}`;
  aside.append(heading);
  for (const [name, preset] of Object.entries(BSOD_QA_PRESETS)) {
    const link = document.createElement('a');
    const url = new URL(location.href); url.searchParams.set('bsodQa', name); url.searchParams.set('qaSeed', qa.seed);
    link.href = url.href; link.textContent = preset.label;
    link.style.cssText = `display:inline-block;margin:3px 10px 0 0;color:${name === qa.name ? '#fff' : '#5fe6fd'};font-weight:${name === qa.name ? 'bold' : 'normal'};`;
    aside.append(link);
  }
  const status = document.createElement('div');
  status.textContent = 'Choose START RUN · no scores or XP saved';
  aside.append(status); document.body.append(aside);
  let tick = 0;
  game.events.on('step', () => {
    if (++tick % 30) return;
    const sc = game.scene.getScene('RunScene');
    const state = sc?.bsodState;
    status.textContent = sc?.scene?.isActive() && state?.active
      ? `Gap ${Math.round(state.gapPx)}px · Wall ${Math.round(state.wallSpeedPxS)}px/s · ${Math.round(sc.runTimeMs / 1000)}s`
      : 'Choose START RUN · no scores or XP saved';
  });
}
