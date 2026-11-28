import {runPhysicsEpisode} from './qa-real-physics-runner.mjs';
self.onmessage=event=>{
 const data=event.data;
 if(!data||data.kind!=='run-physics-qa'||!Number.isSafeInteger(data.id))return;
 try{self.postMessage({kind:'physics-qa-result',id:data.id,result:runPhysicsEpisode(data.spec)});}
 catch(error){self.postMessage({kind:'physics-qa-error',id:data.id,error:String(error?.stack||error)});}
};
