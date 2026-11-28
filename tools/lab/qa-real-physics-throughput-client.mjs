/** Isolated #134 diagnostics entry; do not disturb the certified #491
 * main-vs-Worker harness or the parallel #503 real batch QA client.
 */
import {measureRealPhysicsWorkerThroughput} from './qa-real-physics-throughput.mjs';
window.__physicsThroughputQa=measureRealPhysicsWorkerThroughput;
