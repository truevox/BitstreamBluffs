// Option (c) micro-evidence: cost of calling a WASM function from JS per call, versus the same arithmetic in pure JS.
// Hand-assembled module exporting hypot(x,y) = sqrt(x*x + y*y) over f64 (no toolchain needed). The point is the BOUNDARY cost:
// WASM f64 arithmetic is IEEE-deterministic exactly like JS arithmetic, so WASM buys no determinism over pure JS for these functions;
// it would only matter for moving the whole simulation (Matter + gameplay) into WASM, which is a rewrite. DIAGNOSTIC.
const bytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,                         // magic, version
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7c, 0x7c, 0x01, 0x7c,                   // type: (f64,f64)->f64
  0x03, 0x02, 0x01, 0x00,                                                 // func 0 : type 0
  0x07, 0x09, 0x01, 0x05, 0x68, 0x79, 0x70, 0x6f, 0x74, 0x00, 0x00,       // export "hypot"
  0x0a, 0x10, 0x01, 0x0e, 0x00, 0x20, 0x00, 0x20, 0x00, 0xa2, 0x20, 0x01, 0x20, 0x01, 0xa2, 0xa0, 0x9f, 0x0b, // body: sqrt(x*x+y*y)
]);
const { instance } = await WebAssembly.instantiate(bytes);
const wh = instance.exports.hypot, jh = (x, y) => Math.sqrt(x * x + y * y);
const xs = Float64Array.from({ length: 4096 }, (_, i) => Math.sin(i) * 100), ys = Float64Array.from({ length: 4096 }, (_, i) => Math.cos(i * 1.3) * 100);
function bench(fn) { let s = 0; for (let w = 0; w < 100; w++) for (let i = 0; i < 4096; i++) s += fn(xs[i], ys[i]); const t0 = performance.now(); const R = 3000; for (let r = 0; r < R; r++) for (let i = 0; i < 4096; i++) s += fn(xs[i], ys[i]); return [(performance.now() - t0) * 1e6 / (R * 4096), s]; }
let same = 0; for (let i = 0; i < 4096; i++) if (wh(xs[i], ys[i]) === jh(xs[i], ys[i])) same++;
const r = { runtime: typeof process !== 'undefined' ? 'node ' + process.version : 'browser', bitIdenticalToJs: same + '/4096', wasmNsPerCall: +bench(wh)[0].toFixed(2), jsNsPerCall: +bench(jh)[0].toFixed(2), nativeHypotNsPerCall: +bench((x, y) => Math.hypot(x, y))[0].toFixed(2) };
console.log(JSON.stringify(r));
