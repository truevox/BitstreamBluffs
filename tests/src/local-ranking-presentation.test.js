import { SaveStore } from '../../src/systems/SaveStore.js';
import { presentLocalRunRankings } from '../../src/systems/local-ranking-presentation.js';
import { calculateLocalRankings, localRankingSelectionForRecord } from '../../src/systems/local-rankings.js';

function run(id, changes={}) {
  const rec={ version:1, hashV:2, id, seed:'PORTAL', dailyRuleId:'featherweight',
    startedAt:1000, endedAt:11000, durationMs:10000, score:100,
    distanceM:100, tricks:{frontflip:1}, trickPoints:40, bestCombo:1,
    maxAirtimeMs:200, cause:'crash', dailyOfficial:false, initials:'ABC', ...changes};
  rec.ledgerHash=SaveStore.computeLedgerHash(rec);
  return rec;
}

test('local presentation uses only a complete exact cohort; all metrics are read-only', () => {
  const one=run('one');
  const better=run('better',{distanceM:200,score:300,durationMs:12000,tricks:{frontflip:2,backflip:1},maxAirtimeMs:600});
  const otherSeed=run('other',{seed:'OTHERS'});
  const tampered={...run('tampered'),score:999999};
  const invalidImported=run('imported',{imported:true});
  const history=[one,better,otherSeed,tampered,invalidImported];
  const original=JSON.stringify(history);
  const data=presentLocalRunRankings(history,one);
  expect(data.status).toBe('ready');
  expect(data.sampleSize).toBe(2);
  expect(data.metrics).toHaveLength(7);
  expect(data.metrics[0]).toEqual({key:'distanceM',label:'DISTANCE',unit:'M',value:'100',percentile:'25%',sampleSize:2});
  expect(data.metrics[1].percentile).toBe('25%');
  expect(data.frontier).toBe('dominated');
  expect(data.frontierSampleSize).toBe(2);
  expect(JSON.stringify(history)).toBe(original);
  const front=presentLocalRunRankings(history,better);
  expect(front.frontier).toBe('nondominated');
});

test('ties expose midranks without invented global rankings', () => {
  const a=run('a'),b=run('b');
  const data=presentLocalRunRankings([b,a],a);
  expect(data.metrics.map(x=>x.percentile)).toEqual(Array(7).fill('50%'));
  expect(data.frontier).toBe('nondominated');
});

test('single-run and missing/illegal records fail closed rather than inventing percentiles', () => {
  const only=run('only');
  const data=presentLocalRunRankings([only],only);
  expect(data.sampleSize).toBe(1);
  expect(data.metrics.map(x=>x.percentile)).toEqual(Array(7).fill('N/A'));
  expect(data.frontier).toBeNull();
  expect(presentLocalRunRankings([],only).status).toBe('not-saved');
  expect(presentLocalRunRankings([only],run('ai',{imported:true})).status).toBe('ineligible');
  expect(presentLocalRunRankings([{...only,score:9999}],only).status).toBe('not-saved');
});

test('identical id with contradictory local history excludes that id', () => {
  const only=run('collision');
  const other=run('collision',{score:230});
  expect(presentLocalRunRankings([only,other],only).status).toBe('not-saved');
});


test('ordinary runs with NO initials are visible locally but remain excluded from initials-gated boards', () => {
  // RunScene creates records before (and usually without) Top-10 initials.
  const everyday=run('ordinary');delete everyday.initials;
  const ranked=run('named',{score:180,distanceM:150});
  const history=[everyday,ranked];
  const selection=localRankingSelectionForRecord(ranked);
  expect(calculateLocalRankings(history,selection).rows.map(r=>r.id)).toEqual(['named']);
  expect(localRankingSelectionForRecord(everyday)).toBeNull();
  expect(localRankingSelectionForRecord(everyday,{includeUnenteredLocalRuns:true})).toEqual(selection);
  const data=presentLocalRunRankings(history,everyday);
  expect(data.status).toBe('ready');
  expect(data.sampleSize).toBe(2);
  expect(data.metrics[1].percentile).toBe('25%');
  expect(data.frontier).toBe('dominated');
  // Missing initials do not bypass proof or provenance rules.
  expect(presentLocalRunRankings([{...everyday,score:99999}],everyday).status).toBe('not-saved');
  expect(presentLocalRunRankings([{...everyday,imported:true}],everyday).status).toBe('not-saved');
});
