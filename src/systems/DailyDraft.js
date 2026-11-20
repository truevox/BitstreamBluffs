/**
 * Bitstream Bluffs — OFFICIAL DAILY DRAFT (equal-budget arcade competition).
 *
 * Versioned, independent from the permanent upgrade shop and Data Shard bank.
 * Every pilot may distribute the same 1,200 DRAFT CREDITS among the exact
 * ordinary permanent-upgrade curves, edit the build at will, and retain it
 * between visits. The budget applies to *all ranks combined*; it is not a
 * per-category allowance. Classic Daily remains a zero-upgrade contest.
 *
 * All values are source-defined and deterministic. Raising the budget or
 * revising costs MUST increment DRAFT_RULES_VERSION and change the board's
 * competitive identity, never reinterpret old ranked records.
 */
import {UPGRADE_CATALOG, UPGRADE_IDS, emptyUpgradeRanks,
  nextUpgradePrice, activeUpgradeRanks} from './PermanentUpgrades.js';

// v2 (2026-11-20): the three Shard Magnet upgrades joined the catalogue. A new version is a new board.
export const DRAFT_RULES_VERSION=2;
/** Draft catalogue: the shop's upgrades except any marked `draft: false` (rules v2: all ten). */
export const DRAFT_UPGRADES=UPGRADE_CATALOG.filter(u=>u.draft!==false);
const DRAFT_IDS=DRAFT_UPGRADES.map(u=>u.id);
export const DRAFT_BUDGET=1200;

/** Sum every rank's canonical shop price (no free ranks, no shard spending). */
export function draftCost(input){
  const raw=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  let spend=0;
  for(const id of DRAFT_IDS){
    const n=raw[id]??0;
    if(!Number.isSafeInteger(n)||n<0||n>DRAFT_BUDGET)return Infinity;
    for(let rank=0;rank<n;rank++){
      const price=nextUpgradePrice(id,rank);
      if(price===null)return Infinity;
      spend+=price;
      if(spend>DRAFT_BUDGET)return spend;
    }
  }
  return spend;
}

/** Only exact known positive integer ranks under the published budget rank. */
export function validDraftRanks(input){
  if(!input||typeof input!=='object'||Array.isArray(input))return false;
  // Known non-Draft upgrades (e.g. MAGNET PULL) may appear only at rank 0: a full rank sheet stays valid.
  if(Object.keys(input).some(k=>!DRAFT_IDS.includes(k)&&!(UPGRADE_IDS.includes(k)&&!input[k])))return false;
  return DRAFT_IDS.every(id=>input[id]===undefined||
    (Number.isSafeInteger(input[id])&&input[id]>=0))&&draftCost(input)<=DRAFT_BUDGET;
}

/** Normalize persisted settings safely without silently spending the player's bank. */
export function sanitizeDraftRanks(input){
  // Every known id keeps its key (profile shape is stable); non-Draft upgrades always stay 0.
  const out=emptyUpgradeRanks();
  if(!input||typeof input!=='object'||Array.isArray(input))return out;
  // Clamp rather than trust a wildly over-budget saved blob. The catalogue
  // order is stable, making the result deterministic and restart-safe.
  for(const id of DRAFT_IDS){
    const target=Number.isSafeInteger(input[id])&&input[id]>0?input[id]:0;
    for(let rank=0;rank<Math.min(target,DRAFT_BUDGET);rank++){
      const price=nextUpgradePrice(id,rank);
      if(price===null||draftCost({...out,[id]:rank+1})>DRAFT_BUDGET)break;
      out[id]=rank+1;
    }
  }
  return out;
}

/** Atomic draft edit calculation; never mutates input, no player currency. */
export function changeDraftRank(current,id,delta){
  if(!DRAFT_IDS.includes(id)||!Number.isSafeInteger(delta)||Math.abs(delta)!==1)
    return {ok:false,ranks:sanitizeDraftRanks(current),reason:'invalid-change'};
  const old=sanitizeDraftRanks(current);
  const next=Math.max(0,old[id]+delta);
  if(next===old[id])return {ok:false,ranks:old,reason:'at-zero'};
  const ranks={...old,[id]:next};
  if(!validDraftRanks(ranks))return {ok:false,ranks:old,reason:'over-budget'};
  return {ok:true,ranks,cost:draftCost(ranks),remaining:DRAFT_BUDGET-draftCost(ranks)};
}

/** The exact applied snapshot: no unknown names or unspent/purchased upgrades. */
export const draftActiveRanks=input=>activeUpgradeRanks(sanitizeDraftRanks(input));

