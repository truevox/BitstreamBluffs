import {runBrowserWorkerBatch} from './worker-episode-batch.mjs';
import {runGovernedBrowserWorkerBatch} from './governed-worker-batch.mjs';
window.__labWorkerQa={runBrowserWorkerBatch,runGovernedBrowserWorkerBatch};
