import {runPhysicsEpisode} from './qa-real-physics-runner.mjs';
import {runRealPhysicsQaBatch} from './qa-real-physics-batch.mjs';
window.__realPhysicsQa={runPhysicsEpisode,runRealPhysicsQaBatch,spawn:()=>new Worker(new URL('./qa-real-physics-worker.mjs',import.meta.url),{type:'module'})};
