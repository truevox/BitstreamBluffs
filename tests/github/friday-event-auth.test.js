/** Real YAML resolver JavaScript executed with fake read-only GitHub records. */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const helper=require('../../.github/scripts/friday-pr-lifecycle.cjs');
const yaml=readFileSync('.github/workflows/friday-pr-lifecycle.yml','utf8');
const block=yaml.split('      - name: Resolve stable parent issue for serialized label writes\n')[1]
  .split('  lifecycle:\n')[0];
const source=block.split('          script: |\n')[1]?.replace(/^ {12}/gm,'');
const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
const execute=new AsyncFunction('github','context','core','process','require',source);
const sha='5a0ea5f3d0fce0544481594346b0579c8f6181f1';
const pr={number:174,head:{sha,repo:{full_name:'truevox/BitstreamBluffs'}},body:'Refs #79',title:'[#79] recorded run'};
const signal=(kind='REQUEST',value=sha)=>`[GAL FRIDAY REVIEW ${kind}] exact HEAD \`${value}\` verified`;

async function resolve(pointer, {runEvent=pointer.event_name,comment=null,review=null,permission='write',associated=[174]}={}) {
  const outputs={};
  const env={DIRECT_PR_NUMBER:''};
  const fakeRequire=(name)=>{
    if(name==='node:fs')return {readFileSync:()=>JSON.stringify(pointer)};
    if(name==='fs')return {existsSync:()=>true};
    if(name==='./.github/scripts/friday-pr-lifecycle.cjs')return helper;
    throw new Error('Unexpected require: '+name);
  };
  const github={rest:{
    pulls:{get:async()=>({data:pr}),getReview:async()=>({data:review})},
    issues:{getComment:async()=>({data:comment})},
    repos:{getCollaboratorPermissionLevel:async()=>({data:{permission}})},
  }};
  const context={repo:{owner:'truevox',repo:'BitstreamBluffs'},eventName:'workflow_run',
    payload:{workflow_run:{event:runEvent,pull_requests:associated.map(n=>({number:n}))}}};
  await execute(github,context,{setOutput:(k,v)=>outputs[k]=v,info:()=>{},warning:()=>{}},{env},fakeRequire);
  return outputs;
}

test('read-only resolver authorizes only a trusted exact-head matching issue comment',async()=>{
  const p={pr_number:174,event_name:'issue_comment',action:'created',comment_id:77};
  const good={issue_url:'https://api.github.com/repos/truevox/BitstreamBluffs/issues/174',
    body:signal(),author_association:'OWNER',user:{login:'truevox'}};
  expect(await resolve(p,{comment:good})).toEqual({key:'issue-79',pr_number:'174',origin_event:'issue_comment',origin_action:'created'});
  expect(await resolve(p,{comment:{...good,author_association:'CONTRIBUTOR'}})).toEqual({});
  expect(await resolve(p,{comment:good,permission:'read'})).toEqual({});
  expect(await resolve(p,{comment:{...good,issue_url:'https://api.github.com/repos/truevox/BitstreamBluffs/issues/999'}})).toEqual({});
  expect(await resolve(p,{comment:{...good,body:signal('REQUEST','a'.repeat(40))}})).toEqual({});
  expect(await resolve(p,{comment:good,runEvent:'pull_request'})).toEqual({});
});

test('read-only resolver binds actual current-head commented review and rejects unrelated or untrusted reviews',async()=>{
  const p={pr_number:174,event_name:'pull_request_review',action:'submitted',review_id:88};
  const good={state:'COMMENTED',body:signal('PASSED'),commit_id:sha,author_association:'OWNER',user:{login:'truevox'}};
  expect(await resolve(p,{review:good})).toEqual({key:'issue-79',pr_number:'174',origin_event:'pull_request_review',origin_action:'submitted'});
  expect(await resolve(p,{review:{...good,state:'COMMENTED',body:'arbitrary review'}})).toEqual({});
  expect(await resolve(p,{review:{...good,commit_id:'b'.repeat(40)}})).toEqual({});
  expect(await resolve(p,{review:good,permission:'read'})).toEqual({});
});

test('origin run must contain PR number, preventing an untrusted artifact picking a different PR',async()=>{
  const p={pr_number:174,event_name:'pull_request',action:'closed'};
  expect(await resolve(p,{associated:[174]})).toEqual({key:'issue-79',pr_number:'174',origin_event:'pull_request',origin_action:'closed'});
  expect(await resolve(p,{associated:[177]})).toEqual({});
  expect(await resolve(p,{associated:[]})).toEqual({});
  expect(await resolve({...p,pr_number:0},{associated:[174]})).toEqual({});
});
