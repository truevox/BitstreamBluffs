import { createPlaytestRecorder, installPlaytestTelemetry } from '../../src/systems/PlaytestTelemetry.js';
import { EVT } from '../../src/events.js';

test('opt-in, bounded, explicit field allowlist, local-only data', () => {
  const r = createPlaytestRecorder({version:'test', now:()=>100, limit:5});
  r.event(EVT.RUN_START, {});
  expect(r.snapshot().events).toHaveLength(0);
  r.start();
  r.event(EVT.RUN_START, {seed:'private-seed',runId:'secret',gym:false});
  r.event(EVT.INPUT_ACTION, {action:'anyKey',pressed:true,source:'keyboard',key:'password'});
  r.event(EVT.INPUT_ACTION, {action:'hop',pressed:true,source:'keyboard',key:'password'});
  r.event(EVT.DISTANCE_CHANGED, {meters:42});
  r.tick(60);
  r.event(EVT.RUN_END, {record:{id:'secret',score:42,distanceM:42,initials:'ABC'}});
  r.error('error');
  const s = r.snapshot();
  expect(s.events.map(e=>e.type)).toEqual(['recording_start','runStart','inputAction','sample','run_end']);
  expect(s.events[3].data[EVT.DISTANCE_CHANGED]).toEqual({meters:42});
  expect(s.events[4].data).toEqual({score:42,distanceM:42});
  expect(s.dropped).toBe(1);
  expect(JSON.stringify(s)).not.toMatch(/private-seed|secret|password|ABC/);
  r.clear();
  expect(r.snapshot().events).toEqual([]);
  expect(r.recording).toBe(false);
});

test('normal URLs install nothing', () => {
  expect(installPlaytestTelemetry(null,'test',{location:{search:'?other=1'}})).toBeUndefined();
});

test('dedicated link records automatically, no UI, opt-out erases tab data', () => {
  const handlers = new Map();
  const game = {events:{on:(k,v)=>handlers.set(k,v),once:()=>{},off:()=>{}},loop:{actualFps:60}};
  const win = {
    location:{search:'?playtest=1'}, document:{addEventListener:()=>{},removeEventListener:()=>{}},
    sessionStorage, addEventListener:()=>{}, removeEventListener:()=>{},
    setInterval:()=>1, clearInterval:()=>{},
  };
  installPlaytestTelemetry(game,'test',win);
  handlers.get(EVT.RUN_START)({gym:false});
  handlers.get(EVT.RUN_END)({record:{score:12}});
  expect(win.__bbPlaytest.snapshot().segments[0].events.map(e=>e.type)).toEqual(['recording_start','runStart','run_end']);
  expect(sessionStorage.getItem('bb.playtest.telemetry.v1')).not.toBeNull();
  win.__bbPlaytest.stop();
  handlers.get(EVT.RUN_END)({record:{score:13}});
  expect(sessionStorage.getItem('bb.playtest.telemetry.v1')).toBeNull();
  sessionStorage.setItem('bb.playtest.telemetry.v1','old');
  win.location.search='?playtest=0';
  installPlaytestTelemetry(game,'test',win);
  expect(sessionStorage.getItem('bb.playtest.telemetry.v1')).toBeNull();
});
