import { BLUFF, BsodBluffTracker } from '../../src/systems/BsodBluffTracker.js';

const frame = (gapPx, overrides = {}) => ({
  active: true, gapPx, playerX: 500, nowMs: 0, grounded: false,
  crashed: false, canopyDeployed: false, airbrakeDeployed: false,
  relativeAirX: 420, atmosphereDensity: 1, ...overrides,
});

describe('Bitstream Bluffing — actual approach, canopy rescue, escape', () => {
  test('proximity alone gives nothing; a closing gap + parachute + escape awards once', () => {
    const t = new BsodBluffTracker();
    expect(t.update(frame(1200))).toBeNull();
    expect(t.update(frame(270, { nowMs: 100, playerX: 600 }))).toBeNull();
    expect(t.update(frame(260, { nowMs: 200, playerX: 630, canopyDeployed: true }))).toBeNull();
    expect(t.update(frame(840, { nowMs: 600, playerX: 780 }))).toBeNull();
    const r=t.update(frame(855, { nowMs: 800, playerX: 820 }));
    expect(r).toEqual({type:'bitstreamBluff',points:150,chain:1,surfing:false,closestGapPx:260});
    expect(t.update(frame(1400, { nowMs: 900, playerX: 950 }))).toBeNull();
    expect(t.update(frame(1900, { nowMs: 2000, playerX: 1200 }))).toBeNull();
  });

  test('cannot score when caught, grounded, or without the BSOD tailwind in canopy', () => {
    const caught=new BsodBluffTracker();
    caught.update(frame(1000));
    caught.update(frame(100, { nowMs:100, canopyDeployed:true }));
    expect(caught.update(frame(0, { nowMs:200 }))).toBeNull();
    expect(caught.update(frame(900, { nowMs:300 }))).toBeNull();

    const ground=new BsodBluffTracker();
    ground.update(frame(1000));
    ground.update(frame(250, { nowMs:100, canopyDeployed:true }));
    expect(ground.update(frame(850, { nowMs:300, grounded:true }))).toBeNull();

    const windless=new BsodBluffTracker();
    windless.update(frame(1000));
    windless.update(frame(250, { nowMs:100, canopyDeployed:true, relativeAirX:0, atmosphereDensity:0 }));
    expect(windless.update(frame(900, { nowMs:500 }))).toBeNull();
  });

  test('airbrake skill gains points; Surfing the Void chains without landing', () => {
    const t=new BsodBluffTracker();
    t.update(frame(1500,{playerX:1000,nowMs:0}));
    t.update(frame(240,{playerX:1050,nowMs:100,canopyDeployed:true,airbrakeDeployed:true}));
    const first=t.update(frame(900,{playerX:1350,nowMs:750}));
    expect(first).toMatchObject({points:BLUFF.basePoints+BLUFF.airbrakePoints, chain:1,surfing:false});
    t.update(frame(1000,{playerX:1380,nowMs:800}));
    t.update(frame(180,{playerX:1550,nowMs:1000,canopyDeployed:true}));
    const second=t.update(frame(880,{playerX:1800,nowMs:1600}));
    expect(second).toMatchObject({points:BLUFF.basePoints+BLUFF.chainPoints,chain:2,surfing:true});
  });

  test('touching down breaks the chain and cannot bank an armed bluff', () => {
    const t=new BsodBluffTracker();
    t.update(frame(900,{playerX:800,nowMs:0}));
    t.update(frame(200,{playerX:900,nowMs:100,canopyDeployed:true}));
    t.update(frame(850,{playerX:1200,nowMs:600}));
    expect(t.chain).toBe(1);
    t.update(frame(900,{playerX:1210,nowMs:700,grounded:true}));
    expect(t.chain).toBe(0);
    t.update(frame(1000,{playerX:1230,nowMs:800}));
    t.update(frame(200,{playerX:1260,nowMs:1000,canopyDeployed:true}));
    const next=t.update(frame(900,{playerX:1550,nowMs:1500}));
    expect(next).toMatchObject({chain:1,surfing:false});
  });

  test('no per-frame farming, no immediate rearm, minimum travel and time', () => {
    const t=new BsodBluffTracker();
    t.update(frame(1000,{playerX:0,nowMs:0}));
    t.update(frame(240,{playerX:10,nowMs:100,canopyDeployed:true}));
    expect(t.update(frame(860,{playerX:30,nowMs:200}))).not.toBeNull();
    t.update(frame(260,{playerX:60,nowMs:230,canopyDeployed:true}));
    expect(t.update(frame(860,{playerX:70,nowMs:270}))).toBeNull();
    expect(t.update(frame(860,{playerX:70,nowMs:300}))).toBeNull();
    t.update(frame(220,{playerX:160,nowMs:600,canopyDeployed:true}));
    expect(t.update(frame(860,{playerX:250,nowMs:800}))).toMatchObject({chain:2});
  });
});
