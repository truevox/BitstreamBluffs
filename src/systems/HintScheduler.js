/**
 * First-run tutorial hint scheduler (pure, Phaser-free).
 *
 * One hint is on screen at a time. Every frame the scene tells the scheduler which hints currently have their trigger
 * condition (`wants`), and gets back the show / hide transitions to emit. Rules:
 *  - a hint that is up stays at least `minMs` (readable) unless the player performs the action (`complete`);
 *  - it hides once its trigger is gone (after `minMs`) and always after `maxMs` (it never gets stuck); a hint that timed
 *    out must see its trigger go false before it can show again;
 *  - after any hide there is a `gapMs` pause before the next hint;
 *  - nothing shows before `startMs` of run time except hints marked `early` (push: the sled is stalled);
 *  - when something of higher priority wants to show, the current hint is replaced once it has been up `minMs`;
 *  - `danger` hints (an imminent hazard, a stall) may show while `danger` is set; every other hint is held back then, so
 *    a low-priority hint cannot swallow the warning window of a hazard;
 *  - `perRun` caps how often one hint may show in one run; ids in `done` never show again.
 * Persistence of `done` and any counters is the caller's job (it gets `{id, show}` events and `complete()` results).
 */
export const HINT_DEFS = {
  push: { priority: 5, minMs: 1500, maxMs: 6000, danger: true, early: true },
  hop: { priority: 4, minMs: 1500, maxMs: 4500, danger: true },
  boost: { priority: 3, minMs: 2200, maxMs: 2200 },
  flip: { priority: 2, minMs: 1500, maxMs: 5000, perRun: 3 },
  tuck: { priority: 1, minMs: 2500, maxMs: 4500, perRun: 1 },
};

export class HintScheduler {
  /**
   * @param {{defs?:object, done?:Set<string>, gapMs?:number, startMs?:number}} [opts]
   */
  constructor(opts = {}) {
    this.defs = opts.defs || HINT_DEFS;
    this.done = opts.done || new Set();
    this.gapMs = opts.gapMs != null ? opts.gapMs : 600;
    this.startMs = opts.startMs != null ? opts.startMs : 2500;
    this.cur = null; // { id, since }
    this.lastHideAt = -1e9;
    this.latched = new Set();
    this.shows = {};
  }

  get currentId() { return this.cur ? this.cur.id : null; }

  _best(now, wants, danger, aboveP) {
    let best = null;
    for (const id of Object.keys(this.defs)) {
      const d = this.defs[id];
      if (!wants[id] || this.done.has(id) || this.latched.has(id)) continue;
      if (d.perRun && (this.shows[id] || 0) >= d.perRun) continue;
      if (danger && !d.danger) continue;
      if (now < this.startMs && !d.early) continue;
      if (aboveP != null && d.priority <= aboveP) continue;
      if (!best || d.priority > this.defs[best].priority) best = id;
    }
    return best;
  }

  /**
   * @param {number} now run time in ms
   * @param {Object<string, boolean>} wants hint id -> trigger condition holds this frame
   * @param {boolean} [danger] an imminent danger is pending: only `danger` hints may start
   * @returns {{id:string, show:boolean}[]}
   */
  update(now, wants, danger = false) {
    const out = [];
    for (const id of [...this.latched]) if (!wants[id]) this.latched.delete(id);
    const cur = this.cur;
    if (cur) {
      const d = this.defs[cur.id];
      const age = now - cur.since;
      if (age >= d.maxMs) {
        this.latched.add(cur.id);
        out.push(this._hide(now));
      } else if (age >= d.minMs && (!wants[cur.id] || this._best(now, wants, false, d.priority))) {
        out.push(this._hide(now));
      }
    }
    if (!this.cur && now - this.lastHideAt >= this.gapMs) {
      const id = this._best(now, wants, danger, null);
      if (id) {
        this.cur = { id, since: now };
        this.shows[id] = (this.shows[id] || 0) + 1;
        out.push({ id, show: true });
      }
    }
    return out;
  }

  _hide(now) {
    const id = this.cur.id;
    this.cur = null;
    this.lastHideAt = now;
    return { id, show: false };
  }

  /** The player did what the hint asks: hide it now (even below minMs) and never show it again. Returns the events. */
  complete(id, now) {
    if (this.done.has(id)) return [];
    this.done.add(id);
    return this.cur && this.cur.id === id ? [this._hide(now)] : [];
  }
}
