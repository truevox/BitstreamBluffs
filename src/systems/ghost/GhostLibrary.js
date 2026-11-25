/**
 * OWNER: core-logic engineer. NO Phaser imports. Never throws; falls back to memory when
 * IndexedDB is unavailable (Jest, private windows), like SaveStore.
 *
 * Local ghost library (issue #56). Per course (exact seed + biome mask) it keeps at most
 * five ghost roles: Latest, Best and Favorites A/B/C. A run that holds several roles is one
 * tape and one ghost. Tapes are deleted only when no role on any course references them.
 *
 * Course-archive capacity (the repeatable upgrade) is NOT enforced yet: its starting size,
 * price and eviction rules are open owner decisions. Nothing here uploads anything; Brain
 * Bazaar publishing (#58) will be a separate, explicit action.
 */
import { GHOST_TAPE_FORMAT, GHOST_TAPE_VERSION, GHOST_PHYSICS_VERSION, courseKey } from './GhostTape.js';
import { KODIAK_VERSION } from '../Kodiaks.js';
import { SIM_TICK_HZ } from '../SimClock.js';

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

// Stored run IDs identify immutable recorded data. Comparing JSON structure
// conservatively refuses even harmless key-order differences rather than ever
// replacing an existing tape's checkpoints/score/trace under a pinned ID.
// Undefined/non-JSON/circular data are not valid idempotent replay identities.
function sameRecording(a,b){
  try{
    const first=JSON.stringify(a);
    return typeof first==='string'&&first===JSON.stringify(b);
  }catch{return false;}
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
          tapes.get(tape.runId).onsuccess = safely((existing) => {
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
          });
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
    if (!tape?.runId || tape.mode === 'gym') return null;
    if (this._db) return this._idbChange('save', { tape });
    const key = courseKey(tape.seed, tape.biomeMask);
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
