// Native IndexedDB fault-injection QA. Always uses a disposable Chromium
// profile and a blank loopback origin; never opens a player's browser DB.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = new URL(process.argv[2] || 'http://127.0.0.1:43237/');
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
assert(base.port && base.pathname === '/' && !base.username && !base.password && !base.search && !base.hash);
const profile = await mkdtemp(join(tmpdir(), 'bb-save-qa-'));
let context;
async function open() {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, args: ['--no-sandbox'],
  });
  const page = context.pages()[0];
  await page.route(new URL('/storage-qa-blank', base).href, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Disposable storage QA</title>',
  }));
  await page.goto(new URL('/storage-qa-blank', base).href);
  return page;
}
try {
  let page = await open();
  const first = await page.evaluate(async () => {
    const { SaveStore } = await import('/src/systems/SaveStore.js');
    const make = id => {
      const r = {version:1,id,seed:'qa',startedAt:1000,endedAt:2000,durationMs:1000,
        score:123,distanceM:7,trickPoints:0,tricks:{},bestCombo:1,maxAirtimeMs:0,cause:'crash'};
      r.ledgerHash = SaveStore.computeLedgerHash(r);
      return r;
    };
    const a = new SaveStore();
    await a.init();
    const committed = await a.saveRun(make('control'));
    const r = make('aborted');
    const put = IDBObjectStore.prototype.put;
    let requests = 0, successes = 0;
    IDBObjectStore.prototype.put = function (...args) {
      requests++;
      const request = put.apply(this, args);
      request.addEventListener('success', () => { successes++; this.transaction.abort(); });
      return request;
    };
    let aborted;
    try { aborted = await a.saveRun(r); }
    finally { IDBObjectStore.prototype.put = put; }
    const b = new SaveStore(); await b.init();
    const beforeRetry = b.runs.some(x => x.id === r.id);
    const retry = await a.saveRun({...r, score:99999});
    const initials = await a.setInitials(r.id, 'QA1');
    // Inject a synchronous quota-like failure, then retain session fallback.
    const tx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names, mode, ...rest) {
      if (mode === 'readwrite') throw new DOMException('injected quota failure','QuotaExceededError');
      return tx.call(this,names,mode,...rest);
    };
    let quota;
    try { quota = await a.saveRun(make('quota')); }
    finally { IDBDatabase.prototype.transaction = tx; }
    const quotaState = a.getRunPersistence('quota');
    // Native IDB request error (duplicate add); do not simulate success.
    IDBObjectStore.prototype.put = function (v) { return this.add(v); };
    let requestError;
    try { requestError = await a.setInitials('control', 'ERR'); }
    finally { IDBObjectStore.prototype.put = put; }
    const memoryCount = a.runs.length;
    return {committed,aborted,requests,successes,beforeRetry,retry,initials,quota,quotaState,requestError,memoryCount,
      state:a.getRunPersistence(r.id),controlState:a.getRunPersistence('control')};
  });
  assert.deepEqual(first,{committed:'committed',aborted:'session-only',requests:1,successes:1,beforeRetry:false,
    retry:'committed',initials:'committed',quota:'session-only',quotaState:'session-only',requestError:'session-only',
    memoryCount:3,state:'committed',controlState:'session-only'});
  await context.close(); context = null;
  page = await open();
  const reopened = await page.evaluate(async () => {
    const { SaveStore } = await import('/src/systems/SaveStore.js');
    const a = new SaveStore(); await a.init();
    return a.runs.map(r=>({id:r.id,score:r.score,initials:r.initials??null,state:a.getRunPersistence(r.id)}))
      .sort((a,b)=>a.id.localeCompare(b.id));
  });
  assert.deepEqual(reopened,[
    {id:'aborted',score:123,initials:'QA1',state:'committed'},
    {id:'control',score:123,initials:null,state:'committed'},
  ]);
  console.log(JSON.stringify({first,reopened},null,2));
  console.log('PASS native Chromium abort/commit/retry, request error, quota fallback, fresh process reopen');
} finally {
  await context?.close();
  await rm(profile,{recursive:true,force:true});
}
