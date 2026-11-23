/** Independent DOM bootstrap: no Phaser, imports, or WebGL required. */
(function () {
  const id = 'bsod-qa-boot-status';
  const el = document.createElement('div');
  el.id = id;
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    position: 'fixed', right: '8px', top: '8px', zIndex: '2147483647',
    padding: '8px 12px', maxWidth: '380px', border: '1px solid #f5c04a',
    borderRadius: '6px', background: '#151321', color: '#fff',
    font: '12px/1.5 monospace', whiteSpace: 'pre-wrap', pointerEvents: 'none',
  });
  el.textContent = 'QA diagnostics: HTML received; waiting for game boot…';
  document.body.append(el);
  let finished = false;
  function status() {
    const game = window.__bbGame;
    const canvas = document.querySelector('#game-container canvas');
    const active = game?.scene?.scenes?.filter(s => s.scene.isActive()).map(s => s.scene.key).join(', ') || 'none';
    const gl = canvas ? !!(game?.renderer?.gl) : false;
    const qa = !!document.getElementById('bsod-qa-toolbar');
    const sw = navigator.serviceWorker?.controller ? 'YES (may cache app)' : 'no';
    const lines = [
      'BSOD QA LOCAL DIAGNOSTICS',
      `Phaser boot: ${game?.isBooted ? 'YES' : game ? 'starting' : 'not loaded'}`,
      `Active scene: ${active}`,
      `Canvas: ${canvas ? `${canvas.width}x${canvas.height}` : 'missing'}; WebGL: ${gl ? 'YES' : 'not ready'}`,
      `QA toolbar: ${qa ? 'YES' : 'missing'}; service worker: ${sw}`,
    ];
    el.textContent = lines.join('\n');
    if (game?.isBooted && active.includes('TitleScene') && qa && canvas && gl) {
      if (!finished) { finished = true; el.style.borderColor = '#4fd6a6'; }
      el.textContent += '\nBoot OK. If canvas is black, check local GPU/extensions.';
    }
  }
  let ticks = 0;
  const poll = setInterval(() => { status(); if (++ticks >= 120) clearInterval(poll); }, 500);
  window.addEventListener('error', e => { el.style.borderColor = '#ff596a'; el.textContent += `\nJS error: ${e.message}`; });
  window.addEventListener('unhandledrejection', e => { el.style.borderColor = '#ff596a'; el.textContent += `\nPromise rejection: ${String(e.reason).slice(0,200)}`; });
})();
