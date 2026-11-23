/** Injected ONLY by tools/bsod-qa/serve.mjs, never by the game's index.html. */
import { parseBsodQaQuery, BSOD_QA_PRESETS } from './presets.mjs';
import { EVT } from '../../src/events.js';
import { REG } from '../../src/constants.js';

const qa = parseBsodQaQuery(location.search);
if (qa) {
  const game = window.__bbGame;
  if (!game) throw new Error('QA launcher must load after game boot');
  // The Title's normal entry controls remain playable, but the scenario seed,
  // mask and unranked flag are enforced for BOTH candidates, including retries.
  const installTitleOverride = () => {
    const title = game.scene.getScene('TitleScene');
    if (!title) { requestAnimationFrame(installTitleOverride); return; }
    const originalStart = title.startRun;
    title.startRun = function () { return originalStart.call(this, qa.seed, 0, { official: false }); };
  };
  installTitleOverride();

  game.events.on(EVT.RUN_START, () => {
    const scene = game.scene.getScene('RunScene');
    if (!scene?.bsod || !scene?.bsodState) throw new Error('QA expected authoritative pursuer');
    const edge = scene.bsod.wallX + scene.bsodState.gapPx;
    const gap = scene.bsodState.gapPx + qa.gapOffsetPx;
    if (gap <= 0) throw new Error('QA scenario overlaps rider');
    scene.bsod.wallX = edge - gap;
    scene.bsod.wallSpeedPxS = qa.initialSpeedPxS;
    scene.bsod.accelerationPxS2 *= qa.accelFactor;
    scene.bsodState = scene.bsod.state(edge, scene.sled.vx, 1);
    // Local QA is completely unranked: suppress run, ghost and progression
    // persistence. Keep the in-memory record for the Game Over screen.
    if (scene.saveStore) scene.saveStore = { ...scene.saveStore, saveRun: () => Promise.resolve() };
    scene._saveGhostTape = () => {};
    game.registry.set(REG.LAST_AWARDS, null); // Do not display awards left over from an earlier run.
    // The progression service awards XP on RUN_END; no QA run may award it.
    game.events.removeAllListeners(EVT.RUN_END);
    window.__bsodQaEvidence = { preset: qa.name, seed: qa.seed, initialGapPx: gap,
      initialSpeedPxS: scene.bsod.wallSpeedPxS, effectiveAccelerationPxS2: scene.bsod.accelerationPxS2,
      noSave: true };
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
