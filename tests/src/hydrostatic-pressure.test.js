import { HydrostaticPressure } from '../../src/systems/music/HydrostaticPressure.js';

const sample=(terrainY,{riderY=terrainY,vy=0,grounded=true}={}) =>
	({terrainY,riderY,vy,grounded});

describe('Underwater Hydrostatic — terrain depth memory, never rider hop depth',()=>{
	test('starts with no accumulated depth, remembers deepest terrain and never decays uphill',()=>{
		const p=new HydrostaticPressure();
		expect(p.update(sample(600)).storedPressure01).toBe(0);
		const downhill=p.update(sample(960));
		expect(downhill.deepestTerrainDescentPx).toBe(360);
		expect(downhill.storedPressure01).toBeGreaterThan(.5);
		expect(p.update(sample(750)).deepestTerrainDescentPx).toBe(360);
		expect(p.update(sample(1300)).deepestTerrainDescentPx).toBe(700);
		expect(p.update(sample(850)).storedPressure01).toBe(p.storedPressure01);
	});
	test('airborne upward relief temporarily lifts audible pressure, apex/fall restore, landing fully restores',()=>{
		const p=new HydrostaticPressure();p.update(sample(200));
		const ground=p.update(sample(1000));
		const up=p.update(sample(1000,{riderY:950,vy:-550,grounded:false}));
		expect(up.storedPressure01).toBe(ground.storedPressure01);
		expect(up.audiblePressure01).toBeLessThan(ground.audiblePressure01*.55);
		const apex=p.update(sample(1000,{riderY:875,vy:0,grounded:false}));
		expect(apex.audiblePressure01).toBeGreaterThan(up.audiblePressure01);
		const down=p.update(sample(1000,{riderY:915,vy:600,grounded:false}));
		expect(down.audiblePressure01).toBeGreaterThan(apex.audiblePressure01);
		expect(p.update(sample(1000)).audiblePressure01).toBeCloseTo(ground.storedPressure01);
	});
	test('rider falls far below local terrain but cannot grow stored pressure',()=>{
		const p=new HydrostaticPressure();p.update(sample(100));
		const ground=p.update(sample(540));
		p.update(sample(540,{riderY:2000,vy:1300,grounded:false}));
		expect(p.deepestTerrainDescentPx).toBe(440);
		expect(p.storedPressure01).toBeCloseTo(ground.storedPressure01);
	});
	test('bad terrain, partial velocity and impossible values hold stable state, not a reset',()=>{
		const p=new HydrostaticPressure();p.update(sample(100));
		const known=p.update(sample(760));
		for(const bad of [null,undefined,NaN,Infinity,-Infinity,'900']) {
			expect(p.update({terrainY:bad}).deepestTerrainDescentPx).toBe(660);
		}
		expect(p.update({terrainY:800,grounded:false,riderY:690,vy:NaN}).jumpRelief01).toBe(0);
		expect(p.storedPressure01).toBeGreaterThanOrEqual(known.storedPressure01);
	});
	test('only explicit biome exit/reset removes the memory; each new entry gets a fresh reference',()=>{
		const p=new HydrostaticPressure();p.update(sample(700));p.update(sample(1450));
		const prior=p.storedPressure01;
		p.update(sample(1350,{riderY:1300,grounded:false,vy:-120}));
		expect(p.storedPressure01).toBe(prior);
		expect(p.reset().storedPressure01).toBe(0);
		expect(p.update(sample(1800)).deepestTerrainDescentPx).toBe(0);
	});
});
