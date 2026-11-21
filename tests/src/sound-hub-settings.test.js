import { defaultSettings,sanitizeSettings } from '../../src/systems/SaveStore.js';
import { defaultProfile } from '../../src/systems/Progression.js';
import {
	PROFILE_KEY,ProfileStore,purchaseVocals,VOCALS_UNLOCK_SHARDS
} from '../../src/systems/ProfileStore.js';

const storage=()=>{
	const data=new Map();
	return {
		getItem:key=>data.get(key)??null,
		setItem:(key,value)=>data.set(key,value),
		removeItem:key=>data.delete(key),
	};
};

describe('Sound hub: original vocals entitlement and dedicated wind mixer setting',()=>{
	test('wind is independent of the three existing sound sliders',()=>{
		const defaults=defaultSettings();
		expect(defaults.windVolume).toBe(1);
		expect(defaults.musicVocals).toBe(false);
		expect(defaults.vocalGain).toBe(1);
		expect(defaults.melodyWithVocalsGain).toBe(.18);
		const s=sanitizeSettings({
			masterVolume:.71,musicVolume:.32,sfxVolume:.93,windVolume:0,
			musicVocals:true,vocalGain:.4,melodyWithVocalsGain:.6,
		});
		expect(s).toMatchObject({
			masterVolume:.71,musicVolume:.32,sfxVolume:.93,windVolume:0,
			musicVocals:true,vocalGain:.4,melodyWithVocalsGain:.6,
		});
		expect(sanitizeSettings({windVolume:4,vocalGain:2,melodyWithVocalsGain:-2}))
			.toMatchObject({windVolume:1,vocalGain:1,melodyWithVocalsGain:0});
	});
	test('three-way music quality is persisted without changing song selections or SFX volume',()=>{
		const defaults=defaultSettings();
		expect(defaults.musicQuality).toBe('high');
		for(const mode of ['high','saver','off']){
			const copy=sanitizeSettings({...defaults,musicQuality:mode});
			expect(copy.musicQuality).toBe(mode);
			expect(copy.musicEnabledSongs).toEqual(defaults.musicEnabledSongs);
			expect(copy.sfxVolume).toBe(defaults.sfxVolume);
		}
		expect(sanitizeSettings({...defaults,musicQuality:'auto'}).musicQuality).toBe('high');
	});

	test('the provisional shard price is explicit and cannot be debited twice',()=>{
		expect(VOCALS_UNLOCK_SHARDS).toBe(200);
		const profile={...defaultProfile(),bank:220};
		const first=purchaseVocals(profile);
		expect(first.ok).toBe(true);
		expect(first.reason).toBe('purchased');
		expect(first.profile.bank).toBe(20);
		expect(first.profile.unlocked.musicVocals).toBe(true);
		expect(profile.bank).toBe(220);
		expect(profile.unlocked.musicVocals).not.toBe(true);
		const second=purchaseVocals(first.profile);
		expect(second.reason).toBe('already-owned');
		expect(second.profile.bank).toBe(20);
	});
	test('denies insufficient shards and invalid bank without mutation',()=>{
		for(const bank of [0,199,-1,199.7,NaN,undefined]){
			const profile={...defaultProfile(),bank};
			const result=purchaseVocals(profile);
			expect(result.ok).toBe(false);
			expect(profile.unlocked.musicVocals).not.toBe(true);
		}
	});
	test('charges and unlocks atomically across reload',()=>{
		const mem=storage();
		const store=new ProfileStore({storage:mem});
		store.load();
		store.save({...store.profile,bank:240});
		const before=store.profile;
		const bought=store.buyMusicVocals();
		expect(bought).toMatchObject({ok:true,reason:'purchased'});
		expect(bought.profile.bank).toBe(40);
		expect(before.bank).toBe(240);
		const again=store.buyMusicVocals();
		expect(again.reason).toBe('already-owned');
		expect(store.profile.bank).toBe(40);
		const disk=JSON.parse(mem.getItem(PROFILE_KEY));
		expect(disk.bank).toBe(40);
		expect(disk.unlocked.musicVocals).toBe(true);
		const reloaded=new ProfileStore({storage:mem});
		reloaded.load();
		expect(reloaded.profile.bank).toBe(40);
		expect(reloaded.profile.unlocked.musicVocals).toBe(true);
	});
	test('storage rejection must NOT charge shards or grant entitlement',()=>{
		const mem=storage();
		const store=new ProfileStore({storage:mem});
		store.load();
		store.save({...store.profile,bank:210});
		const before=store.profile;
		mem.setItem=()=>{throw new Error('quota exceeded');};
		const tx=store.buyMusicVocals();
		expect(tx.ok).toBe(false);
		expect(tx.reason).toBe('storage-failed');
		expect(store.profile).toBe(before);
		expect(store.profile.bank).toBe(210);
		expect(store.profile.unlocked.musicVocals).toBe(false);
	});
});
