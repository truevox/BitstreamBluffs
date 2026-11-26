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

test('persistent random browser ID survives reload, while session IDs rotate', async () => {
  const ids = [
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013',
  ];
  const bodies = [];
  const win = {sessionStorage, localStorage, crypto:{randomUUID:()=>ids.shift()},
    fetch:async (_, options)=>{bodies.push(JSON.parse(options.body)); return {ok:true,json:async()=>({ok:true})};}};
  localStorage.removeItem('bb.playtest.player.v1');
  sessionStorage.removeItem(QUEUE_KEY);
  for (let i=0;i<2;i++) {
    const u = createPlaytestUpload(win,'2.25.16');
    u.add({type:'runStart'}); await u.flush();
  }
  expect(bodies.map(b=>b.player)).toEqual(['00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000012']);
  expect(bodies.map(b=>b.session)).toEqual(['00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000013']);
  localStorage.removeItem('bb.playtest.player.v1');
});

test('storage unavailable: upload remains session-only', async () => {
  let body;
  const win = {sessionStorage, get localStorage(){throw Error('denied');},
    crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000014'},
    fetch:async (_,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({ok:true})};}};
  sessionStorage.removeItem(QUEUE_KEY);
  const u=createPlaytestUpload(win,'2.25.16');u.add({type:'sample'});await u.flush();
  expect(body).not.toHaveProperty('player');
});
