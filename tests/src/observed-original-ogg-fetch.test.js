import {readFileSync} from 'node:fs';
import {webcrypto,createHash} from 'node:crypto';
import vm from 'node:vm';
const script=readFileSync(new URL('../../tools/music/observe-original-ogg-fetch.js',import.meta.url),'utf8');
const path='http://127.0.0.1:8220/music/packs/test/drums.ogg';
function setup(fetcher){
  const window={fetch:fetcher,location:{href:'http://127.0.0.1:8220/'}};
  vm.runInNewContext(script,{window,crypto:webcrypto,URL,Uint8Array,Error});
  return window;
}
function response(bytes){
  const b=Uint8Array.from(bytes);
  return {url:path,ok:true,clone(){return {arrayBuffer:async()=>b.slice().buffer}},
    arrayBuffer:async()=>b.slice().buffer};
}
test('observes exactly the original bytes consumed by production fetch without mutating response',async()=>{
  const payload=[12,24,48,96];
  const win=setup(async()=>response(payload));
  const res=await win.fetch(path);
  expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(payload);
  await Promise.all(win.__bbOriginalOggFetchProof.pending);
  const proof=win.__bbOriginalOggFetchProof.records.get('/music/packs/test/drums.ogg');
  expect(proof.bytes).toBe(payload.length);
  expect(proof.sha256).toBe(createHash('sha256').update(Buffer.from(payload)).digest('hex'));
});
test('different data served for the same song path fails closed',async()=>{
  let count=0;
  const win=setup(async()=>response(++count===1?[1,2,3]:[1,2,4]));
  await win.fetch(path);
  await Promise.all(win.__bbOriginalOggFetchProof.pending);
  await win.fetch(path);
  await expect(Promise.all(win.__bbOriginalOggFetchProof.pending)).rejects.toThrow(/Inconsistent/);
});
