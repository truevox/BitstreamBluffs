import {runPhysicsEpisode} from './qa-real-physics-runner.mjs';
import {measureRealPhysicsWorkerThroughput} from './qa-real-physics-throughput.mjs';
window.__realPhysicsQa={runPhysicsEpisode,measureRealPhysicsWorkerThroughput,spawn:()=>new Worker(new URL('./qa-real-physics-worker.mjs',import.meta.url),{type:'module'})};
