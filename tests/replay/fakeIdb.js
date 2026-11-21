// Test-only IndexedDB stand-in (not a test file).
/** Structured-clone stand-in (jsdom has no structuredClone): copies typed arrays, plain objects and arrays. */
const structuredClone = (v) => (ArrayBuffer.isView(v) ? Uint8Array.from(v) : Array.isArray(v) ? v.map(structuredClone)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, structuredClone(x)])) : v);

/** Minimal in-memory IndexedDB: enough for open/upgrade, put/get/getAll/delete, with failure injection. */
export function fakeIdb() {
  const dbs = new Map(); // name -> { stores: Map<name, {keyPath, rows: Map}> }
  const hooks = { failPut: null };
  const later = (fn) => Promise.resolve().then(fn);
  const request = (run) => {
    const req = {};
    later(() => { try { req.result = run(); req.onsuccess && req.onsuccess(); } catch (e) { req.error = e; req.onerror && req.onerror(); } });
    return req;
  };
  // One transaction over one or more stores: oncomplete fires after every request finished OK; any failure aborts it.
  const makeTx = (db, names, mode) => {
    const tx = { error: null };
    let pending = 0;
    let failed = false;
    const settle = () => later(() => { if (!failed && pending === 0 && tx.oncomplete) { tx.oncomplete(); tx.oncomplete = null; } });
    const track = (run) => {
      pending++;
      const req = {};
      later(() => {
        try { req.result = run(); pending--; req.onsuccess && req.onsuccess(); settle(); } catch (e) {
          pending--; failed = true; req.error = e; tx.error = e; req.onerror && req.onerror(); tx.onabort && tx.onabort();
        }
      });
      return req;
    };
    const store = (s) => ({
      put: (v) => track(() => { if (mode === 'readwrite' && hooks.failPut) throw hooks.failPut; s.rows.set(v[s.keyPath], structuredClone(v)); return v[s.keyPath]; }),
      get: (k) => track(() => (s.rows.has(k) ? structuredClone(s.rows.get(k)) : undefined)),
      getAll: () => track(() => [...s.rows.values()].map((v) => structuredClone(v))),
      delete: (k) => track(() => { s.rows.delete(k); }),
    });
    tx.objectStore = (n) => { if (!names.includes(n)) throw new Error(`store ${n} not in transaction`); return store(db.stores.get(n)); };
    settle();
    return tx;
  };
  const idb = {
    hooks,
    names: () => [...dbs.keys()],
    open(name) {
      const req = {};
      later(() => {
        let db = dbs.get(name);
        const fresh = !db;
        if (fresh) { db = { stores: new Map() }; dbs.set(name, db); }
        const handle = {
          objectStoreNames: { contains: (n) => db.stores.has(n) },
          createObjectStore: (n, { keyPath }) => { db.stores.set(n, { keyPath, rows: new Map() }); },
          transaction: (n, mode) => makeTx(db, [].concat(n), mode),
        };
        req.result = handle;
        if (fresh && req.onupgradeneeded) req.onupgradeneeded();
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
  return idb;
}

