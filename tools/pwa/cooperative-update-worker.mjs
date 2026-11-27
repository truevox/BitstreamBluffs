/** Active worker coordinates a safe handoff; waiting worker never activates on
 * a page's direct command. New in-scope navigations are held during the short
 * handoff and retry against whichever worker wins. */
export function renderCooperativeUpdateWorker() {
  return `
let updateGate = false;
const scopeWindows = async () => (await self.clients.matchAll({type:'window'}))
  .filter(c => new URL(c.url).pathname.startsWith(BASE));
function prepareClient(client, token) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const done = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
    const timer = setTimeout(() => done(false), 2500);
    channel.port1.onmessage = e => done(e.data?.token === token && e.data?.ready === true);
    try { client.postMessage({type:'bb:pwa:prepare', token}, [channel.port2]); }
    catch { done(false); }
  });
}
self.addEventListener('message', event => {
  if (event.data?.type === 'bb:pwa:activate') {
    // The old active worker is the only permitted sender. A browser page
    // cannot masquerade as a ServiceWorker source.
    if (event.source instanceof ServiceWorker &&
        event.source.scriptURL === self.location.href &&
        event.source.state === 'activated' &&
        self.registration.waiting) {
      // Acknowledge acceptance before activation; the old worker must not
      // extend its message event until activation completes.
      event.ports[0]?.postMessage({accepted:true});
      event.ports[0]?.close();
      event.waitUntil(self.skipWaiting());
    }
    return;
  }
  if (event.data?.type !== 'bb:pwa:update' || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    const waiting = self.registration.waiting;
    if (!waiting || updateGate) { port.postMessage({status:'busy'}); port.close(); return; }
    updateGate = true;
    let windows = [], token = crypto.randomUUID(), committed = false;
    try {
      windows = await scopeWindows();
      if (!windows.length || !windows.some(c => c.id === event.source?.id)) return;
      const ready = await Promise.all(windows.map(c => prepareClient(c, token)));
      if (!ready.every(Boolean)) return;
      const current = await scopeWindows();
      // A new client or an intervening newer waiting worker invalidates consent.
      if (current.some(c => !windows.some(old => old.id === c.id)) ||
          self.registration.waiting !== waiting) return;
      // Freeze all consenting clients through activation, not merely until
      // the first response. A newer waiting worker still invalidates consent.
      for (const c of windows) c.postMessage({type:'bb:pwa:commit',token});
      const channel = new MessageChannel();
      committed = await new Promise(resolve => {
        const done = accepted => { clearTimeout(timer);channel.port1.close();resolve(accepted); };
        const timer = setTimeout(() => done(false), 2500);
        channel.port1.onmessage = e => done(e.data?.accepted === true);
        try { waiting.postMessage({type:'bb:pwa:activate'}, [channel.port2]); }
        catch { done(false); }
      });
    } finally {
      // Hold new navigations through the handoff; release on failure.
      if (committed) {
        // If activation is superseded, release the old worker's navigation
        // gate and every frozen page. Otherwise the old worker retires.
        const check = () => {
          if (waiting.state !== 'redundant') return;
          updateGate = false;
          for (const c of windows) try { c.postMessage({type:'bb:pwa:abort',token}); } catch {}
        };
        waiting.addEventListener('statechange',check);
        check();
      } else updateGate = false;
      if (!committed) for (const c of windows) {
        try { c.postMessage({type:'bb:pwa:abort',token}); } catch {}
      }
      try { port.postMessage({status:committed?'ready':'blocked'}); port.close(); } catch {}
    }
  })());
});
`;
}
