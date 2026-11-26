import {createPlaytestUpload, QUEUE_KEY} from '../../src/systems/PlaytestUpload.js';

test('batches use stable retry ids, explicit ack, credentials omitted and stop erases', async () => {
  const calls = [];
  let ok = false;
  const win = {sessionStorage, crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000002'},
    fetch:async (url, options) => {calls.push(options); return {ok:true,json:async()=>({ok})};}};
  sessionStorage.removeItem(QUEUE_KEY);
  const u = createPlaytestUpload(win,'2.25.13','https://example.test');
  u.add({type:'runStart',ms:0,run:1,data:{}});
  await u.flush();
  expect(u.status().queued).toBe(1);
  ok = true;
  await u.flush();
  expect(calls[0].body).toBe(calls[1].body);
  expect(calls[0].credentials).toBe('omit');
  expect(JSON.parse(calls[0].body).events).toHaveLength(1);
  expect(u.status().queued).toBe(0);
  u.add({type:'run_end'});
  u.stop();
  await u.flush();
  expect(calls).toHaveLength(2);
  expect(sessionStorage.getItem(QUEUE_KEY)).toBeNull();
});

test('caps each batch and persists pending batches for reload retry', async () => {
  const win = {sessionStorage, crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000003'},
    fetch:async()=>{throw Error('offline');}};
  sessionStorage.removeItem(QUEUE_KEY);
  const u=createPlaytestUpload(win,'2.25.13');
  for(let i=0;i<201;i++)u.add({ms:i,type:'sample',data:{x:2}});
  await u.flush();
  const bodies=JSON.parse(sessionStorage.getItem(QUEUE_KEY)).map(JSON.parse);
  expect(bodies.map(b=>b.events.length)).toEqual([100,100,1]);
  expect(createPlaytestUpload(win,'2.25.13').status().queued).toBe(3);
  u.stop();
});
