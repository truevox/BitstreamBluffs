/** Test-browser-only original OGG fetch provenance.
 * Clone each successful PRODUCTION fetch response before the game decodes it;
 * never intercept/change returned bytes or publish the original recording.
 * The live FatalCrashCountIn source buffer is checked against this evidence.
 */
(function installOriginalOggFetchProvenance(){
  const original=window.fetch.bind(window);
  const records=new Map(),pending=[];
  window.__bbOriginalOggFetchProof={records,pending,protocol:'game-original-response-clone-v2'};
  window.fetch=async(...args)=>{
    const response=await original(...args);
    const path=new URL(response.url||args[0],window.location.href).pathname;
    if(response.ok&&path.startsWith('/music/packs/')&&path.endsWith('.ogg')){
      const clone=response.clone(); // Before the game consumes its own original response.
      const proof=(async()=>{
        const bytes=await clone.arrayBuffer();
        const digest=await crypto.subtle.digest('SHA-256',bytes);
        const sha256=[...new Uint8Array(digest)]
          .map(n=>n.toString(16).padStart(2,'0')).join('');
        const prior=records.get(path);
        if(prior&&(prior.sha256!==sha256||prior.bytes!==bytes.byteLength))
          throw Error('Inconsistent game source OGG response for '+path);
        records.set(path,{sha256,bytes:bytes.byteLength});
      })();
      pending.push(proof);
    }
    return response;
  };
})();
