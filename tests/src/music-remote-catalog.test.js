import { jest } from '@jest/globals';
import { StemMusicDirector } from '../../src/systems/music/StemMusicDirector.js';

const remote='https://bsb-audio.bearcave.win/releases/20261124-melody-only-748a0670/catalog.json';
const doc={format:'bitstream-music-catalog-v1',tracks:[{id:'sample',title:'Sample',manifest:'packs/sample/pack.json'}]};
afterEach(()=>{delete global.fetch;});
test('uses the remote catalog as the base for its manifests',async()=>{
	global.fetch=jest.fn(async()=>({ok:true,json:async()=>doc}));
	const d=new StemMusicDirector({});
	expect(await d.initPromise).toBe(true);
	expect(d.catalogUrl).toBe(remote);
	expect(d.catalog[0].manifest).toBe('packs/sample/pack.json');
});
test('falls back to the bundled catalog if remote fetch fails',async()=>{
	global.fetch=jest.fn(async(url)=>{if(url===remote)throw Error('offline');return {ok:true,json:async()=>doc};});
	const d=new StemMusicDirector({});
	expect(await d.initPromise).toBe(true);
	expect(d.catalogUrl).toBe('music/catalog.json');
	expect(global.fetch).toHaveBeenCalledTimes(2);
});
test('an explicit catalog URL does not unexpectedly switch hosts',async()=>{
	global.fetch=jest.fn(async()=>({ok:false}));
	const d=new StemMusicDirector({},'music/test-catalog.json');
	expect(await d.initPromise).toBe(false);
	expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('invalid remote catalog falls back to the bundled catalog',async()=>{
	global.fetch=jest.fn(async(url)=>({ok:true,json:async()=>url===remote?{format:'bad',tracks:[]}:doc}));
	const d=new StemMusicDirector({});
	expect(await d.initPromise).toBe(true);
	expect(d.catalogUrl).toBe('music/catalog.json');
});
test('remote catalog keeps existing transition metadata on the game origin',async()=>{
	global.fetch=jest.fn(async()=>({ok:true,json:async()=>doc}));
	const d=new StemMusicDirector({});
	await d.initPromise;
	d.setCrossfade(true);
	await d._gridRequest;
	expect(global.fetch.mock.calls[1][0].href).toBe(new URL('music/transition-grids.json',window.location.href).href);
});
test('checks remote catalog with a fresh network request to make offline fallback reliable',async()=>{
	global.fetch=jest.fn(async()=>({ok:true,json:async()=>doc}));
	const d=new StemMusicDirector({}); await d.initPromise;
	expect(global.fetch.mock.calls[0][1]).toMatchObject({cache:'no-store'});
	expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
test('times out a stalled remote host and loads the bundled catalog',async()=>{
	jest.useFakeTimers();
	global.fetch=jest.fn((url,options)=>url===remote ? new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')))) : Promise.resolve({ok:true,json:async()=>doc}));
	try {
		const d=new StemMusicDirector({});
		await jest.advanceTimersByTimeAsync(5000);
		expect(await d.initPromise).toBe(true);
		expect(d.catalogUrl).toBe('music/catalog.json');
	} finally { jest.useRealTimers(); }
});
test('times out a stalled remote catalog body and uses the bundled catalog',async()=>{
	jest.useFakeTimers();
	global.fetch=jest.fn((url,options)=>url===remote
		? Promise.resolve({ok:true,json:()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))) )})
		: Promise.resolve({ok:true,json:async()=>doc}));
	try {
		const d=new StemMusicDirector({});
		await jest.advanceTimersByTimeAsync(5000);
		expect(await d.initPromise).toBe(true);
		expect(d.catalogUrl).toBe('music/catalog.json');
	} finally { jest.useRealTimers(); }
});
