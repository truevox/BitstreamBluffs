// Test-only transactional IndexedDB stand-in. No browser network/storage.
const clone = v => (ArrayBuffer.isView(v) ? Uint8Array.from(v) : Array.isArray(v) ? v.map(clone)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k,clone(x)])) : v);

/** Small IDB mock supporting version upgrades, readwrite transaction rollback, and fault injection. */
export function fakeIdb() {
  const dbs = new Map();
  const hooks = { failPut: null, failDelete: null };
  const later = fn => Promise.resolve().then(fn);
  const makeTx = (db, names, mode) => {
    const tx = { error: null };
    let pending = 0, closed = false, failed = false;
    const staged = new Map(names.map(n => [n, new Map([...db.stores.get(n).rows].map(([k,v]) => [k,clone(v)]))]));
    const settle = () => later(() => {
      if (failed || closed || pending !== 0) return;
      closed = true;
      if (mode === 'readwrite') for (const n of names) db.stores.get(n).rows = staged.get(n);
      tx.oncomplete?.();
    });
    const abort = error => {
      if (failed || closed) return;
      failed = true; tx.error = error || new Error('transaction aborted'); tx.onabort?.();
    };
    tx.abort = () => abort(new Error('explicit transaction abort'));
    const track = fn => {
      if (failed || closed) throw new Error('TransactionInactiveError');
      pending++;
      const req = {};
      later(() => {
        if (failed) return;
        try { req.result = fn(); pending--; req.onsuccess?.(); settle(); }
        catch (e) { pending--; req.error = e; req.onerror?.(); abort(e); }
      });
      return req;
    };
    tx.objectStore = n => {
      if (!names.includes(n)) throw new Error(`store ${n} not in transaction`);
      const model = db.stores.get(n), rows = staged.get(n);
      return {
        put: v => track(() => { if (mode === 'readwrite' && hooks.failPut) throw hooks.failPut;
          rows.set(v[model.keyPath],clone(v)); return v[model.keyPath]; }),
        get: k => track(() => rows.has(k) ? clone(rows.get(k)) : undefined),
        getAll: () => track(() => [...rows.values()].map(clone)),
        delete: k => track(() => { if (mode === 'readwrite' && hooks.failDelete) throw hooks.failDelete; rows.delete(k); }),
      };
    };
    settle();
    return tx;
  };
  return {
    hooks, names: () => [...dbs.keys()],
    // Expose no privileged direct database manipulation; upgrade using real IDB calls.
    open(name, version = 1) {
      const req = {};
      later(() => {
        try {
          let db = dbs.get(name);
          if (!db) { db = { version: 0, stores: new Map() }; dbs.set(name,db); }
          if (version < db.version) throw new Error('VersionError');
          const handle = {
            objectStoreNames: { contains: n => db.stores.has(n) },
            createObjectStore: (n,{keyPath}) => {
              if (db.stores.has(n)) throw new Error('ConstraintError');
              db.stores.set(n,{keyPath,rows:new Map()});
            },
            transaction: (n,mode) => makeTx(db,[].concat(n),mode),
            close: () => {},
          };
          req.result = handle;
          if (version > db.version) { req.oldVersion = db.version; req.newVersion = version; req.onupgradeneeded?.(); db.version = version; }
          req.onsuccess?.();
        } catch (e) { req.error=e; req.onerror?.(); }
      });
      return req;
    },
  };
}
