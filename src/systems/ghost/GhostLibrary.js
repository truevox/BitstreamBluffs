/**
 * OWNER: core-logic engineer. NO Phaser imports. Never throws; falls back to memory when
 * IndexedDB is unavailable (Jest, private windows), like SaveStore.
 *
 * Local ghost library (issue #56). Per course (exact seed + biome mask) it keeps at most
 * five ghost roles: Latest, Best and Favorites A/B/C. A run that holds several roles is one
 * tape and one ghost. Tapes are deleted only when no role on any course references them.
 *
 * Course-archive capacity (#56) restricts NEW distinct seed+biome libraries only
 * after legacy grandfathering. Full means refuse, never evict pinned data.
 * Pricing is a reversible pre-alpha balance; nothing here uploads anything.
 */
import { GHOST_TAPE_FORMAT, GHOST_TAPE_VERSION, GHOST_PHYSICS_VERSION, courseKey } from './GhostTape.js';
import { KODIAK_VERSION } from '../Kodiaks.js';
import { SIM_TICK_HZ } from '../SimClock.js';
import { INCLUDED_COURSE_ARCHIVES, mayArchiveNewCourse } from './CourseArchiveCapacity.js';

export const GHOST_DB = 'bitstream-ghosts';
export const GHOST_DB_VERSION = 1;
export const FAVORITE_SLOTS = 3;
export const MAX_GHOSTS_PER_COURSE = 2 + FAVORITE_SLOTS;
export const GHOST_ROLES = Object.freeze(['best','latest','fav0','fav1','fav2']);
const IDB_TIMEOUT_MS = 2500;

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('idb request failed'));
});

// Stored run IDs identify immutable recorded data, not just matching JSON
// strings: JSON.stringify loses undefined, -0, NaN and object property order.
// Only strict plain object/array graphs with equal own data properties may be
// retried idempotently. Cycles, accessors and exotic objects fail closed.
function sameRecording(a,b){
  const leftSeen=new WeakSet(),rightSeen=new WeakSet();
  const equal=(x,y)=>{
    if(x===null||y===null||typeof x!=='object'||typeof y!=='object')return Object.is(x,y);
    if(Array.isArray(x)!==Array.isArray(y))return false;
    if(!Array.isArray(x)){
      const xp=Object.getPrototypeOf(x),yp=Object.getPrototypeOf(y);
      if((xp!==Object.prototype&&xp!==null)||(yp!==Object.prototype&&yp!==null))return false;
    }
    if(leftSeen.has(x)||rightSeen.has(y))return false;
    leftSeen.add(x);rightSeen.add(y);
    const keys=Reflect.ownKeys(x),other=Reflect.ownKeys(y);
    if(keys.length!==other.length)return false;
    for(const key of keys){
      if(typeof key!=='string'||!Object.prototype.hasOwnProperty.call(y,key))return false;
      const d=Object.getOwnPropertyDescriptor(x,key),e=Object.getOwnPropertyDescriptor(y,key);
      if(!d||!e||!Object.prototype.hasOwnProperty.call(d,'value')||
         !Object.prototype.hasOwnProperty.call(e,'value')||!equal(d.value,e.value))return false;
    }
    return true;
  };
  try{return equal(a,b);}catch{return false;}
}
const copyRecording=t=>typeof structuredClone==='function'
  ?structuredClone(t):JSON.parse(JSON.stringify(t));


/** A tape this build can draw: right format, version, tick rate and physics. A Kodiak run from another bear ruleset (contact crashed before v3) would not replay. */
export function tapeCompatible(tape) {
  return Boolean(tape && tape.format === GHOST_TAPE_FORMAT && tape.version === GHOST_TAPE_VERSION &&
    tape.simTickHz === SIM_TICK_HZ && tape.physicsVersion === GHOST_PHYSICS_VERSION && typeof tape.trace === 'string' &&
    (tape.kodiaksOn !== true || tape.kodiakVersion === KODIAK_VERSION));
}

function emptyCourse(key, tape) {
  return { key, seed: tape.seed, biomeMask: tape.biomeMask || 0, latest: null, best: null, bestDistanceM: -1,
    favorites: Array(FAVORITE_SLOTS).fill(null), lastPlayedAt: 0 };
}

/** Role -> runId pairs of a course, merged per run: [{runId, roles:['best','latest']}], at most five. */
export function courseGhostRuns(course) {
  if (!course) return [];
  const byRun = new Map();
  const add = (role, runId) => { if (runId) byRun.set(runId, [...(byRun.get(runId) || []), role]); };
  add('best', course.best);
  add('latest', course.latest);
  course.favorites.forEach((runId, i) => add(`fav${i}`, runId));
  return [...byRun].map(([runId, roles]) => ({ runId, roles })).slice(0, MAX_GHOSTS_PER_COURSE);
}

export class GhostLibrary {
  constructor() {
    /** @type {Map<string, object>} course entries (small; always in memory) */
    this.courses = new Map();
    /** @type {Map<string, object>} tapes: memory backend, or a read cache over IndexedDB */
    this.tapes = new Map();
    this.backend = 'memory';
    this._db = null;
    // Null means the legacy migration did not durably establish a limit.
    // This avoids losing existing ghost tapes on storage-denied devices.
    this.archiveLimit = null;
    this.lastArchiveFailure = null;
  }

  /** Open IndexedDB and load course entries. Never rejects. */
  async init() {
    try {
      const idb = globalThis.indexedDB;
      if (!idb) return;
      const db = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('idb open timeout')), IDB_TIMEOUT_MS);
        const req = idb.open(GHOST_DB, GHOST_DB_VERSION);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('courses')) d.createObjectStore('courses', { keyPath: 'key' });
          if (!d.objectStoreNames.contains('tapes')) d.createObjectStore('tapes', { keyPath: 'runId' });
        };
        req.onsuccess = () => { clearTimeout(timer); resolve(req.result); };
        req.onerror = () => { clearTimeout(timer); reject(req.error); };
        req.onblocked = () => { clearTimeout(timer); reject(new Error('idb blocked')); };
      });
      const all = await req2p(db.transaction('courses', 'readonly').objectStore('courses').getAll());
      for (const c of all || []) if (c && typeof c.key === 'string') this.courses.set(c.key, c);
      this._db = db;
      this.backend = 'idb';
    } catch {
      this._db = null;
      this.backend = 'memory';
    }
  }

  course(seed, biomeMask = 0) { return this.courses.get(courseKey(seed, biomeMask)) || null; }

  /** Configure only AFTER the profile's legacy course baseline is persisted. */
  setArchiveLimit(limit) {
    this.archiveLimit = Number.isSafeInteger(limit) && limit >= INCLUDED_COURSE_ARCHIVES ? limit : null;
  }

  archiveStatus() {
    const used = this.courses.size;
    return {used,limit:this.archiveLimit,full:this.archiveLimit !== null && used >= this.archiveLimit,
      lastFailure:this.lastArchiveFailure};
  }

  /** Fresh read makes a manager in one tab see course additions from another. */
  async listArchiveCourses() {
    if (this._db) {
      try {
        const all = await req2p(this._db.transaction('courses', 'readonly').objectStore('courses').getAll());
        this.courses.clear();
        for (const c of all || []) if (c && typeof c.key === 'string') this.courses.set(c.key,c);
      } catch { return null; } // do not offer destructive actions against stale records
    }
    return [...this.courses.values()].sort((a,b)=>(b.lastPlayedAt||0)-(a.lastPlayedAt||0)||String(a.key).localeCompare(String(b.key)));
  }

  /** Explicit user management, NEVER automatic eviction. Two-store atomic. */
  async deleteArchiveCourse(key) {
    if (typeof key !== 'string' || !this.courses.has(key)) return false;
    if (!this._db) {
      this.courses.delete(key);
      for (const [id,tape] of this.tapes) {
        if (tape && courseKey(tape.seed,tape.biomeMask)===key) this.tapes.delete(id);
      }
      this.lastArchiveFailure=null;
      return true;
    }
    return new Promise(resolve=>{
      let tx;
      try {tx=this._db.transaction(['courses','tapes'],'readwrite');}
      catch {resolve(false);return;}
      const cs=tx.objectStore('courses'),ts=tx.objectStore('tapes');
      const reject=()=>{try{tx.abort();}catch{/* ended */}};
      let removed=null,deleted=[];
      tx.oncomplete=()=>{
        if(removed){
          this.courses.delete(key);
          for(const id of deleted)this.tapes.delete(id);
          this.lastArchiveFailure=null;
        }
        resolve(!!removed);
      };
      tx.onabort=()=>resolve(false);
      tx.onerror=()=>{};
      cs.get(key).onsuccess=ev=>{
        try{
          const entry=ev.target.result;
          if(!entry){reject();return;}
          ts.getAll().onsuccess=tev=>{
            try{
              const archived=(tev.target.result||[]).filter(t=>t && courseKey(t.seed,t.biomeMask)===key);
              cs.getAll().onsuccess=cev=>{
                try{
                  const external=new Set((cev.target.result||[]).filter(c=>c.key!==key)
                    .flatMap(c=>courseGhostRuns(c).map(x=>x.runId)));
                  for(const t of archived){if(!external.has(t.runId)){ts.delete(t.runId);deleted.push(t.runId);}}
                  cs.delete(key);
                  removed=entry;
                }catch{reject();}
              };
            }catch{reject();}
          };
        }catch{reject();}
      };
    });
  }

  /** One atomic IndexedDB transaction for the whole role mutation.
   * No awaits inside a live transaction: every dependent get/put is scheduled
   * from request callbacks. Other tabs' readwrite transactions serialize on
   * both stores, so a pending favorite can't be overwritten by stale Latest.
   * Returns null on refusal, quota or transaction failure (no false durable
   * success); the memory-only backend retains its legacy behavior.
   */
  async _idbChange(kind, { tape, seed, biomeMask, slot, runId, role, on } = {}) {
    const key = kind === 'save' ? courseKey(tape.seed, tape.biomeMask) : courseKey(seed, biomeMask);
    return new Promise((resolve) => {
      let tx;
      try { tx = this._db.transaction(['courses', 'tapes'], 'readwrite'); }
      catch { resolve(null); return; }
      const courses = tx.objectStore('courses');
      const tapes = tx.objectStore('tapes');
      let updated = null;
      let writtenTape = null;
      const deletedTapes = [];
      const reject = () => { try { tx.abort(); } catch { /* already complete */ } };
      const safely = (fn) => (ev) => { try { fn(ev.target.result); } catch { reject(); } };
      tx.oncomplete = () => {
        if (updated) {
          if(kind==='save')this.lastArchiveFailure=null;
          this.courses.set(key, updated);
          if (writtenTape) this.tapes.set(writtenTape.runId, writtenTape);
          for (const id of deletedTapes) this.tapes.delete(id);
        }
        resolve(updated);
      };
      tx.onabort = () => resolve(null);
      // An error aborts the entire transaction, including the tape and role.
      tx.onerror = () => {};
      const reclaim = (prior, next, revision) => {
        const after = new Set(courseGhostRuns(next).map((r) => r.runId));
        const displaced = courseGhostRuns(prior).map((r) => r.runId).filter((id) => !after.has(id));
        if (!displaced.length) return;
        courses.getAll().onsuccess = safely((all) => {
          const referenced = new Set((all || []).flatMap((c) => courseGhostRuns(c).map((r) => r.runId)));
          for (const id of displaced) {
            if (referenced.has(id)) continue;
            tapes.get(id).onsuccess = safely((oldTape) => {
              // Retain historical tapes from other terrain revisions for
              // explicit replay, exactly like the original saveRun path.
              if (revision && oldTape && oldTape.simRevision !== revision) return;
              tapes.delete(id);
              deletedTapes.push(id);
            });
          }
        });
      };
      const courseReq = courses.get(key);
      courseReq.onsuccess = safely((onDisk) => {
        if (kind === 'save') {
          const attemptSave = () => { tapes.get(tape.runId).onsuccess = safely((existing) => {
            if(existing){
              // Same-course collisions are just as dangerous as foreign IDs:
              // a pinned Favorite could otherwise change behind its label.
              // Exact retries are NO-OP, not a promotion back to Latest.
              if(courseKey(existing.seed,existing.biomeMask)!==key||
                 !sameRecording(existing,tape)||!onDisk){reject();return;}
              updated=onDisk;writtenTape=existing;
              return;
            }
            const prior = onDisk || emptyCourse(key, tape);
            const next = { ...prior, favorites: [...(prior.favorites || Array(FAVORITE_SLOTS).fill(null))] };
            const finalize = (oldBest) => {
              next.latest = tape.runId;
              const newerRevision = Number.isSafeInteger(tape.simRevision) && tape.simRevision > 0 &&
                next.best && oldBest?.simRevision !== tape.simRevision;
              if (newerRevision || tape.distanceM > next.bestDistanceM) {
                next.best = tape.runId;
                next.bestDistanceM = tape.distanceM;
              }
              next.lastPlayedAt = tape.endedAt || Date.now();
              tapes.put(tape);
              courses.put(next);
              updated = next;
              writtenTape = copyRecording(tape);
              reclaim(prior, next, tape.simRevision);
            };
            if (next.best) tapes.get(next.best).onsuccess = safely(finalize);
            else finalize(null);
          }); };
          // Check the authoritative IndexedDB course COUNT while holding the
          // very same readwrite transaction as the future course+tape put.
          // Two tabs adding different seeds cannot both claim the last slot.
          if (!onDisk && this.archiveLimit !== null) {
            courses.count().onsuccess = safely(count => {
              if (!mayArchiveNewCourse(count,this.archiveLimit)) {
                this.lastArchiveFailure='full';reject();return;
              }
              attemptSave();
            });
          } else attemptSave();
        } else if (kind === 'favorite') {
          if (!onDisk || !Number.isInteger(slot) || slot < 0 || slot >= FAVORITE_SLOTS) { reject(); return; }
          const update = (selected) => {
            if (runId && (!selected || courseKey(selected.seed, selected.biomeMask) !== key)) { reject(); return; }
            const next = { ...onDisk, favorites: [...onDisk.favorites] };
            next.favorites[slot] = runId || null;
            courses.put(next);
            updated = next;
            reclaim(onDisk, next, null);
          };
          if (runId) tapes.get(runId).onsuccess = safely(update);
          else update(null);
        } else if (kind === 'show') {
          if (!onDisk || !GHOST_ROLES.includes(role)) { reject(); return; }
          const next = { ...onDisk, show: { ...(onDisk.show || {}), [role]: on !== false } };
          courses.put(next);
          updated = next;
        } else reject();
      });
    });
  }

  /** Refresh course metadata from disk before displaying roles from other tabs. */
  async freshCourse(seed, biomeMask = 0) {
    const key = courseKey(seed, biomeMask);
    if (!this._db) return this.courses.get(key) || null;
    try {
      const course = await req2p(this._db.transaction('courses', 'readonly').objectStore('courses').get(key));
      if (course) this.courses.set(key, course);
      else this.courses.delete(key);
      return course || null;
    } catch { return null; } // failure must not display stale role data
  }

  /**
   * Store a finished run's tape and update its course's Latest and Best.
   * Best is the furthest distance; a tie keeps the earlier run.
   * @returns {Promise<object>} the updated course entry
   */
  async saveRun(tape) {
    // Gym practice and #72 takeover tapes (unranked practice / TAS) are never library ghosts.
    if (!tape?.runId || tape.mode === 'gym' || tape.mode === 'takeover') return null;
    if (this._db) return this._idbChange('save', { tape });
    const key = courseKey(tape.seed, tape.biomeMask);
    // A full archive rejects only NEW courses, never a newer run on an
    // existing course or a truly idempotent retry. The RunRecord and local
    // protected evidence stores are independent of this Ghost Library.
    if (!this.courses.has(key) && !mayArchiveNewCourse(this.courses.size,this.archiveLimit)) {
      this.lastArchiveFailure='full';return null;
    }
    // Memory fallback is synchronous until course+tape are both committed:
    // two same-tick callers cannot both pass the first-read ID check.
    const existing = this.tapes.get(tape.runId) || null;
    if(existing){
      if(courseKey(existing.seed,existing.biomeMask)!==key||!sameRecording(existing,tape))return null;
      // Exact retry: never re-promote a stale recording to Latest/Best.
      return this.courses.get(key)||null;
    }
    const course = { ...(this.courses.get(key) || emptyCourse(key, tape)) };
    course.favorites = [...course.favorites];
    const before = new Set(courseGhostRuns(course).map((g) => g.runId));
    course.latest = tape.runId;
    // Terrain/ruleset revisions are distinct courses for competitive Best
    // purposes even when their seed and mask are identical. An old-terrain
    // distance must not permanently outrank every fresh-terrain tape.
    const oldBest = course.best ? (this.tapes.get(course.best) || null) : null;
    const staleBest = Number.isSafeInteger(tape.simRevision) && tape.simRevision > 0 &&
      course.best && oldBest?.simRevision !== tape.simRevision;
    if (staleBest || tape.distanceM > course.bestDistanceM) {
      course.best = tape.runId;
      course.bestDistanceM = tape.distanceM;
    }
    course.lastPlayedAt = tape.endedAt || Date.now();
    // Do not expose the caller's mutable object as the stored identity.
    this.tapes.set(tape.runId,copyRecording(tape));
    this.courses.set(key,course);
    this.lastArchiveFailure=null;
    const after = new Set(courseGhostRuns(course).map((g) => g.runId));
    for (const runId of before) {
      if (after.has(runId)) continue;
      // Preserve displaced legacy/other-revision tapes for explicit replay
      // tools and later historical analysis, even though current gameplay
      // no longer draws them. Normal same-revision role GC is unchanged.
      const previous = await this.getTape(runId);
      if (Number.isSafeInteger(tape.simRevision) && tape.simRevision > 0 &&
          previous && previous.simRevision !== tape.simRevision) continue;
      await this._collect(runId);
    }
    return course;
  }

  /** Pin (or with runId null, clear) Favorite slot 0..2 of a course. */
  async setFavorite(seed, biomeMask, slot, runId) {
    if (this._db) return this._idbChange('favorite', { seed, biomeMask, slot, runId });
    const key = courseKey(seed, biomeMask);
    const old = this.courses.get(key);
    if (!old || !Number.isInteger(slot) || slot < 0 || slot >= FAVORITE_SLOTS) return null;
    if (runId) {
      const tape = await this.getTape(runId);
      // Nothing from a different seed or biome selection can occupy a local
      // favorite role, even when the global tape ID exists and is compatible.
      if (!tape || courseKey(tape.seed, tape.biomeMask) !== key) return null;
    }
    const course = { ...old, favorites: [...old.favorites] };
    const dropped = course.favorites[slot];
    course.favorites[slot] = runId || null;
    await this._putCourse(course);
    if (dropped && !courseGhostRuns(course).some((g) => g.runId === dropped)) await this._collect(dropped);
    return course;
  }

  /** Per-course on/off switch for one ghost role (used for Favorites A/B/C). */
  async setShow(seed, biomeMask, role, on) {
    if (this._db) return this._idbChange('show', { seed, biomeMask, role, on });
    const old = this.courses.get(courseKey(seed, biomeMask));
    if (!old || !GHOST_ROLES.includes(role)) return null;
    const course = { ...old, show: { ...(old.show || {}), [role]: on !== false } };
    await this._putCourse(course);
    return course;
  }

  /**
   * Ghosts to draw on a course: deduped runs with their roles, filtered by `show`
   * (role -> boolean) and the course's own `show` switches; a run shows if any of its roles is shown.
   * Compatible tapes only. `simRevision` is a display-only current-terrain
   * gate; leave `tapeCompatible` and direct getTape/manifest replay unchanged.
   * When present, an invalid revision refuses all display candidates.
   * Omitting the fourth argument preserves the legacy tool/library API.
   */
  async ghostsFor(seed, biomeMask = 0, show = {}, { simRevision } = {}) {
    const out = [];
    if (simRevision !== undefined && (!Number.isSafeInteger(simRevision) || simRevision < 1)) return out;
    const course = await this.freshCourse(seed, biomeMask);
    // A role shows when both the player's global switch (`show`) and the course's own switch allow it.
    const visible = (r) => show[r] !== false && course?.show?.[r] !== false;
    for (const g of courseGhostRuns(course)) {
      if (!g.roles.some(visible)) continue;
      const tape = await this.getTape(g.runId);
      // No silent legacy->current simulation identity inference. Old or
      // unstamped trace poses can float/clip on the revised terrain.
      if (tapeCompatible(tape) && courseKey(tape.seed, tape.biomeMask) === course.key &&
          (simRevision === undefined || tape.simRevision === simRevision)) {
        out.push({ ...g, tape });
      }
    }
    return out;
  }

  async getTape(runId) {
    // The IDB record wins over this tab's possibly stale read cache. A tape
    // deleted by another tab must not continue drawing from old memory.
    if (!this._db){
      const tape=this.tapes.get(runId);
      return tape ? copyRecording(tape) : null;
    }
    try {
      const tape = await req2p(this._db.transaction('tapes', 'readonly').objectStore('tapes').get(runId));
      if (tape) this.tapes.set(runId, tape);
      else this.tapes.delete(runId);
      return tape || null;
    } catch { return null; }
  }

  /** Delete a tape no course still references. */
  async _collect(runId) {
    for (const c of this.courses.values()) if (courseGhostRuns(c).some((g) => g.runId === runId)) return;
    this.tapes.delete(runId);
    if (this._db) {
      try { await req2p(this._db.transaction('tapes', 'readwrite').objectStore('tapes').delete(runId)); } catch { /* best effort */ }
    }
  }

  async _putTape(tape) {
    this.tapes.set(tape.runId, tape);
    if (this._db) {
      try { await req2p(this._db.transaction('tapes', 'readwrite').objectStore('tapes').put(tape)); } catch { /* quota: memory keeps the session */ }
    }
  }

  async _putCourse(course) {
    this.courses.set(course.key, course);
    if (this._db) {
      try { await req2p(this._db.transaction('courses', 'readwrite').objectStore('courses').put(course)); } catch { /* quota */ }
    }
  }
}
