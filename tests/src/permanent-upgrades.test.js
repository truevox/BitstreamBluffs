import fs from 'node:fs';
import { defaultProfile } from '../../src/systems/Progression.js';
import { ProfileStore, PROFILE_KEY, sanitizeProfile } from '../../src/systems/ProfileStore.js';
import { UPGRADE_CATALOG, UPGRADE_IDS, emptyUpgradeRanks, sanitizeUpgradeRanks,
  activeUpgradeRanks, nextUpgradePrice, upgradeBenefit, upgradeEffects,
  upgradeLoadoutForRun, purchaseUpgrade } from '../../src/systems/PermanentUpgrades.js';
import { upgradeShopLayout, shopLayout } from '../../src/ui/ShopLayout.js';
import { SaveStore, sanitizeRun, verifyLedgerHash, UPGRADE_LEDGER_HASH_V } from '../../src/systems/SaveStore.js';

const levels=JSON.parse(fs.readFileSync(new URL('../../src/data/progression/levels.json',import.meta.url),'utf8'));
const storage=()=>{
  let data=null;
  return {getItem:()=>data,setItem:(key,value)=>{if(key===PROFILE_KEY)data=value},value:()=>data};
};

describe('permanent upgrade economy',()=>{
  test('ten known tracks; ranks are validated and ordered, unknown junk ignored',()=>{
    expect(UPGRADE_IDS).toHaveLength(10);
    expect(sanitizeUpgradeRanks({hop:6,speed:2,flip:-4,evil:999,canopy:'11'}))
      .toMatchObject({hop:6,speed:2,flip:0,canopy:0});
    expect(Object.keys(activeUpgradeRanks({hop:2,speed:1,evil:3}))).toEqual(['speed','hop']);
    expect(emptyUpgradeRanks()).toMatchObject({speed:0,hop:0});
    expect(defaultProfile().upgrades).toEqual(emptyUpgradeRanks());
    expect(sanitizeProfile(defaultProfile(),levels)).toEqual(sanitizeProfile({},levels)===null ? {} : sanitizeProfile(defaultProfile(),levels));
  });
  test('unlimited ranks; cost rises, physical benefits approach finite caps',()=>{
    for(const {id,cap} of UPGRADE_CATALOG){
      expect(nextUpgradePrice(id,0)).toBeGreaterThan(0);
      expect(nextUpgradePrice(id,2)).toBeGreaterThan(nextUpgradePrice(id,1));
      expect(upgradeBenefit(id,1)).toBeGreaterThan(0);
      expect(upgradeBenefit(id,10)).toBeGreaterThan(upgradeBenefit(id,1));
      expect(upgradeBenefit(id,1000000)).toBeLessThan(cap);
      expect(upgradeBenefit(id,1000000)).toBeGreaterThan(cap*.9);
      expect(upgradeBenefit(id,3)-upgradeBenefit(id,2))
        .toBeLessThan(upgradeBenefit(id,2)-upgradeBenefit(id,1));
    }
    expect(nextUpgradePrice('speed',100000)).toBeGreaterThan(0);
    expect(nextUpgradePrice('wrong',0)).toBeNull();
  });
  test('purchase is atomic and may be repeated; invalid and insufficient balance never mutate',()=>{
    const first = { ...defaultProfile(),bank:900 };
    const once=purchaseUpgrade(first,'hop');
    expect(once.bank).toBe(first.bank-nextUpgradePrice('hop',0));
    expect(once.upgrades.hop).toBe(1);
    expect(first.upgrades.hop).toBe(0);
    const twice=purchaseUpgrade(once,'hop');
    expect(twice.upgrades.hop).toBe(2);
    expect(twice.bank).toBe(once.bank-nextUpgradePrice('hop',1));
    expect(purchaseUpgrade(twice,'bad')).toBe(twice);
    expect(purchaseUpgrade({...twice,bank:0},'hop').upgrades.hop).toBe(2);
    const broke={...first,bank:-1};
    expect(purchaseUpgrade(broke,'speed')).toBe(broke);
  });
  test('in-memory / storage write failure cannot charge; successful writes persist ranks',()=>{
    const mem=new ProfileStore({levels,storage:null});
    mem.load();
    mem.save({...mem.profile,bank:200});
    const failed=mem.buyUpgrade('speed');
    expect(failed.ok).toBe(false);
    expect(mem.profile.upgrades.speed).toBe(0);
    const denied={getItem:()=>null,setItem:()=>{throw new Error('denied')}};
    const broken=new ProfileStore({levels,storage:denied});
    broken.load();
    broken.save({...broken.profile,bank:200});
    expect(broken.buyUpgrade('speed').ok).toBe(false);
    expect(broken.profile.bank).toBe(200);
    const disk=storage(),store=new ProfileStore({levels,storage:disk});
    store.load();store.save({...store.profile,bank:200});
    expect(store.buyUpgrade('speed').ok).toBe(true);
    const persisted=new ProfileStore({levels,storage:disk}).load();
    expect(persisted.upgrades.speed).toBe(1);
    expect(persisted.bank).toBe(200-nextUpgradePrice('speed',0));
  });
  test('buying upgrades never enables them implicitly, and official daily always clean',()=>{
    const p={...defaultProfile(),bank:2000,upgradesEnabled:false};
    const bought=purchaseUpgrade(p,'speed');
    expect(upgradeLoadoutForRun(bought).enabled).toBe(false);
    expect(upgradeLoadoutForRun({...bought,upgradesEnabled:true}).enabled).toBe(true);
    expect(upgradeLoadoutForRun({...bought,upgradesEnabled:true},{daily:true}).enabled).toBe(false);
    expect(upgradeEffects({}).speedMul).toBe(1);
    expect(upgradeEffects({hop:3}).hopMul).toBeGreaterThan(1);
  });
  test('a purchasable upgrades page fits, has no overlaps and survives rank changes',()=>{
    const p={...defaultProfile(),bank:1000};
    const layout=upgradeShopLayout({profile:p});
    expect(layout.rows.filter(r=>r.kind==='upgradeItem')).toHaveLength(10);
    expect(layout.rows.find(r=>r.kind==='upgradeToggle').state).toBe('OFF');
    expect(shopLayout({profile:p}).rows.some(r=>r.kind==='upgradeLink')).toBe(true);
    // Secret gameplay may not be explained or offered before discovery.
    expect(layout.rows.some(r=>r.kind==='gym')).toBe(false);
    expect(layout.texts.some(r=>/BLUFF|SURFING|FUEL REFILL/i.test(r.text))).toBe(false);
    expect(upgradeShopLayout({profile:{...p,bsodGym:{discovered:true,owned:false}}})
      .rows.find(r=>r.kind==='gym').state).toContain('LOCKED');
    expect(upgradeShopLayout({profile:{...p,bsodGym:{discovered:true,owned:true}}})
      .rows.find(r=>r.kind==='gym').state).toBe('ENTER');
    expect(layout.h).toBeLessThanOrEqual(248);
    const overlaps=[];
    for(let i=0;i<layout.texts.length;i++)
      for(let j=i+1;j<layout.texts.length;j++){
        const a=layout.texts[i],b=layout.texts[j];
        if(a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h)overlaps.push([a.key,b.key]);
      }
    expect(overlaps).toEqual([]);
    const after=upgradeShopLayout({profile:purchaseUpgrade(p,'speed')});
    expect(after.rows.find(r=>r.id==='speed').label).toContain('R1');
  });
});

describe('upgrade run ledger v3',()=>{
  const record=(extra={})=>({
    version:1,id:'up-run-1',seed:'trial',dailyRuleId:'none',startedAt:100,endedAt:10000,
    durationMs:9900,score:1234,distanceM:250,trickPoints:30,tricks:{frontflip:1},
    bestCombo:1.5,bestFlow:1.2,maxAirtimeMs:900,cause:'crash',modded:true,
    boosts:[],dailyOfficial:false,hashV:UPGRADE_LEDGER_HASH_V,
    upgradeRanks:{speed:4,hop:1},shards:3,nearMisses:1,bonusPoints:50,...extra,
  });
  test('v3 records snapshot ranks and changing them fails verification',()=>{
    const rec=record();
    rec.ledgerHash=SaveStore.computeLedgerHash(rec);
    expect(verifyLedgerHash(rec)).toBe(true);
    expect(verifyLedgerHash(sanitizeRun(rec))).toBe(true);
    expect(sanitizeRun(rec).upgradeRanks).toEqual({speed:4,hop:1});
    expect(verifyLedgerHash({...rec,upgradeRanks:{speed:5,hop:1}})).toBe(false);
    expect(verifyLedgerHash({...rec,modded:false})).toBe(false);
    expect(verifyLedgerHash({...rec,score:rec.score+1})).toBe(false);
  });
  test('existing clean v2 format and verification are unaffected',()=>{
    const rec=record({hashV:2,upgradeRanks:undefined,modded:false});
    rec.ledgerHash=SaveStore.computeLedgerHash(rec);
    expect(verifyLedgerHash(sanitizeRun(rec))).toBe(true);
    expect(sanitizeRun(rec).upgradeRanks).toBeUndefined();
  });
});
