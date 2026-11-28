import {runPhysicsEpisode} from './qa-real-physics-runner.mjs';
window.__realPhysicsQa={runPhysicsEpisode,spawn:()=>new Worker(new URL('./qa-real-physics-worker.mjs',import.meta.url),{type:'module'})};
