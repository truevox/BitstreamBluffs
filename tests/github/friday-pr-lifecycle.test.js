import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {run,getIssueReference,parseReviewSignal,explicitlyCloses}=require('../../.github/scripts/friday-pr-lifecycle.cjs');
const clone=(v)=>JSON.parse(JSON.stringify(v));
const repoName='truevox/BitstreamBluffs';
const sha1='5a0ea5f3d0fce0544481594346b0579c8f6181f1';
const sha2='f3fc93d4078fddcc76c4d14b211f678268d29863';
const author={login:'truevox',type:'User'};
function pr(n,issue,{body=`Refs #${issue}`,title=`[#${issue}] Example`,head=sha1,draft=false,state='open',merged=false,base='main',fork=false}={}){
 return {number:n,body,title,head:{sha:head,repo:{full_name:fork?'stranger/fork':repoName}},base:{ref:base},draft,state,merged,labels:[],user:author};
}
function comment(id,body,{association='OWNER',login='truevox',at}={}){
 return {id,body,author_association:association,user:{login},created_at:at||new Date(1740000000000+id*1000).toISOString(),updated_at:at||new Date(1740000000000+id*1000).toISOString()};
}
const msg=(kind,sha=sha1)=>`[GAL FRIDAY REVIEW ${kind}] — independent exact HEAD \`${sha}\`; evidence verified`;
function api(initial,mode={}){
 const data={prs:new Map(initial.prs.map(p=>[p.number,clone(p)])),issues:new Map(initial.issues.map(i=>[i.number,{...i,labels:[...(i.labels||[])]}])),comments:clone(initial.comments||{}),reviews:clone(initial.reviews||{}),writes:[],listCalls:0,perms:mode.perms||{truevox:'admin'},files:initial.files||{}};
 function target(n){return data.prs.get(n)||data.issues.get(n);}
 const gh={rest:{
  pulls:{
   get:async({pull_number})=>({data:data.prs.get(pull_number)}),
   list:async()=>{data.listCalls++;mode.onListOpen?.({call:data.listCalls,data});return {data:[...data.prs.values()].filter(p=>p.state==='open')};},
   listFiles:async({pull_number})=>({data:data.files[pull_number]||[]}),
   listReviews:async({pull_number})=>({data:data.reviews[pull_number]||[]}),
  },
  issues:{
   get:async({issue_number})=>({data:data.issues.get(issue_number)}),
   createLabel:async()=>({data:{}}),
   listComments:async({issue_number})=>({data:data.comments[issue_number]||[]}),
   addLabels:async({issue_number,labels})=>{const x=target(issue_number);for(const l of labels)if(!x.labels.some(z=>(typeof z==='string'?z:z.name)===l))x.labels.push({name:l});data.writes.push(['add',issue_number,...labels]);},
   removeLabel:async({issue_number,name})=>{const x=target(issue_number);x.labels=x.labels.filter(z=>(typeof z==='string'?z:z.name)!==name);data.writes.push(['remove',issue_number,name]);},
   update:async({issue_number,state})=>{data.issues.get(issue_number).state=state;data.writes.push(['state',issue_number,state]);},
   updateComment:async(args)=>{data.writes.push(['updateComment',args.comment_id]);},
   createComment:async(args)=>{data.writes.push(['createComment',args.issue_number]);},
  },
  repos:{
   get:async()=>({data:{default_branch:'main'}}),
   getCollaboratorPermissionLevel:async({username})=>({data:{permission:data.perms[username]||'read'}}),
  }
 }};
 gh.paginate=async(fn,args)=>(await fn(args)).data;
 const core={log:[],info(s){this.log.push(s);},warning(s){this.log.push(s);},setFailed(s){throw new Error(s);}};
 async function fire(eventName,payload,expectedKey=null){await run({github:gh,context:{repo:{owner:'truevox',repo:'BitstreamBluffs'},eventName,payload},core,expectedKey});}
 return {data,gh,core,fire};
}
const labels=(obj)=>obj.labels.map(l=>typeof l==='string'?l:l.name).filter(l=>l.startsWith('friday:'));
const notify=(prNumber,c)=>({action:'created',issue:{number:prNumber,pull_request:{url:'x'}},comment:c});

describe('Friday issue linking and exact-head review parsing',()=>{
 test('reads Morgan Refs, CC bracketed titles, Group B markers, and Home Closes',()=>{
  expect(getIssueReference(pr(174,79))).toBe(79);
  expect(getIssueReference(pr(163,152,{body:'Replay contract foundation for #116 and #118',title:'[DRAFT][#152] Replay foundation'}))).toBe(152);
  expect(getIssueReference(pr(162,115,{body:'<!-- friday-issue: 115 -->\nRefs #115'}))).toBe(115);
  expect(getIssueReference(pr(158,117,{body:'Closes #117'}))).toBe(117);
  expect(getIssueReference(pr(175,172,{body:'**Refs #172 — important**'}))).toBe(172);
  expect(explicitlyCloses(pr(158,117,{body:'Closes #117'}),117)).toBe(true);
  expect(explicitlyCloses(pr(174,79),79)).toBe(false);
 });
 test('refuses mixed/ambiguous issue linkage and unrelated PRs',()=>{
  expect(getIssueReference(pr(9,12,{body:'Refs #12\nRefs #13'}))).toBe(null);
  expect(getIssueReference(pr(9,12,{body:'<!-- friday-issue: 12 -->\nRefs #13'}))).toBe(null);
  expect(getIssueReference(pr(9,12,{title:'[#13] wrong',body:'Refs #12'}))).toBe(null);
  expect(getIssueReference(pr(9,12,{title:'generic',body:'mentions #12 somewhere'}))).toBe(null);
 });
 test('fenced examples, indented code and HTML comments never become issue closure directives',()=>{
  const examples=[
    '```markdown\nCloses #79\n```',
    '~~~\n<!-- friday-issue: 79 -->\n~~~',
    '<!--\nCloses #79\n-->',
    '<pre>\nCloses #79\n</pre>',
    '    Closes #79',
    '> Closes #79',
  ];
  for(const example of examples){
    const x=pr(500,80,{body:`${example}\nRefs #80`,title:'Issue #80'});
    expect(getIssueReference(x)).toBe(80);
    expect(explicitlyCloses(x,79)).toBe(false);
    expect(explicitlyCloses(x,80)).toBe(false);
  }
  const pureExample=pr(500,80,{body:'```md\n<!-- friday-issue: 79 -->\nRefs #79\n```',title:'no issue'});
  expect(getIssueReference(pureExample)).toBe(null);
  const full=pr(501,80,{body:'<!-- friday-issue: 80 -->\nCloses #80',title:'[#80] Fix'});
  expect(getIssueReference(full)).toBe(80);
  expect(explicitlyCloses(full,80)).toBe(true);
 });
 test('requires current full 40-character SHA and leading marker; ignores sample instructions',()=>{
  expect(parseReviewSignal(msg('REQUEST'))).toEqual({sha:sha1,kind:'request'});
  expect(parseReviewSignal(msg('PASSED',sha2))).toEqual({sha:sha2,kind:'passed'});
  expect(parseReviewSignal(msg('CHANGES REQUESTED'))).toEqual({sha:sha1,kind:'changes'});
  expect(parseReviewSignal('[GAL FRIDAY REVIEW REQUEST] sha 5a0ea5f')).toBe(null);
  expect(parseReviewSignal('Please post `[GAL FRIDAY REVIEW REQUEST]` with exact HEAD SHA')).toBe(null);
 });
});

describe('GitHub-native issue and PR label reconciliation',()=>{
 test('Morgan handoff labels both PR and issue; review PASSED clears label without closing partial issue',async()=>{
  const v=pr(174,79);const c=comment(1,msg('REQUEST'));
  const x=api({prs:[v],issues:[{number:79,state:'open',labels:[{name:'P1: low-effort'}]}],comments:{174:[c]}});
  await x.fire('issue_comment',notify(174,c));
  expect(labels(x.data.prs.get(174))).toEqual(['friday:in-review']);
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-review']);
  const approved=comment(2,msg('PASSED'));
  x.data.comments[174].push(approved);
  await x.fire('issue_comment',notify(174,approved));
  expect(labels(x.data.prs.get(174))).toEqual(['friday:in-progress']);
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-progress']);
  expect(x.data.issues.get(79).state).toBe('open');
  const written=x.data.writes.length;
  await x.fire('issue_comment',notify(174,approved));
  expect(x.data.writes).toHaveLength(written);
 });
 test('new commit invalidates old approval and old review request; only new head matters',async()=>{
  const v=pr(174,79);const c=comment(1,msg('REQUEST'));
  const x=api({prs:[v],issues:[{number:79,state:'open'}],comments:{174:[c]}});
  await x.fire('issue_comment',notify(174,c));
  x.data.prs.get(174).head.sha=sha2;
  await x.fire('pull_request_target',{action:'synchronize',pull_request:x.data.prs.get(174)});
  expect(labels(x.data.prs.get(174))).toEqual(['friday:in-progress']);
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-progress']);
  x.data.comments[174].push(comment(2,msg('REQUEST',sha2)));
  await x.fire('pull_request_target',{action:'synchronize',pull_request:x.data.prs.get(174)});
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-review']);
 });
 test('draft or starter-marker PR never enters review even with trusted current-sha comment',async()=>{
  for(const [draft,files] of [[true,[]],[false,[{filename:'.friday/issue-117-start.md'}]]]){
   const v=pr(158,117,{body:'Closes #117',draft});const c=comment(1,msg('REQUEST'));
   const x=api({prs:[v],issues:[{number:117,state:'open'}],comments:{158:[c]},files:{158:files}});
   await x.fire('issue_comment',notify(158,c));
   expect(labels(x.data.prs.get(158))).toEqual(['friday:in-progress']);
   expect(labels(x.data.issues.get(117))).toEqual(['friday:in-progress']);
  }
 });
 test('a deleted starter marker is NOT present at HEAD; an added/renamed-into marker is present',async()=>{
  for(const [status,expected] of [['removed','friday:in-review'],['added','friday:in-progress'],['renamed','friday:in-progress']]){
    const p=pr(158,117,{body:'<!-- friday-issue: 117 -->',draft:false});
    const c=comment(1,msg('REQUEST'));
    const x=api({prs:[p],issues:[{number:117,state:'open'}],comments:{158:[c]},
      files:{158:[{filename:'.friday/issue-117-start.md',status}]}});
    await x.fire('issue_comment',notify(158,c));
    expect(labels(x.data.issues.get(117))).toEqual([expected]);
  }
 });
 test('non-draft PR with starter marker fails original CI lifecycle gate, remains in-progress',async()=>{
  const p=pr(158,117,{body:'<!-- friday-issue: 117 -->\nCloses #117'});
  const x=api({prs:[p],issues:[{number:117,state:'open'}],files:{158:[{filename:'.friday/issue-117-start.md'}]}});
  await expect(x.fire('pull_request_target',{action:'ready_for_review',pull_request:p})).rejects.toThrow(/Remove temporary/);
  expect(labels(x.data.issues.get(117))).toEqual(['friday:in-progress']);
 });
 test('shared #172 stays review while another PR is awaiting feedback; draft sibling remains progress',async()=>{
  const p1=pr(173,172,{draft:true}),p2=pr(175,172,{head:sha2});const c=comment(4,msg('REQUEST',sha2));
  const x=api({prs:[p1,p2],issues:[{number:172,state:'open'}],comments:{175:[c]}});
  await x.fire('issue_comment',notify(175,c));
  expect(labels(x.data.issues.get(172))).toEqual(['friday:in-review']);
  expect(labels(x.data.prs.get(173))).toEqual(['friday:in-progress']); // Every sibling is reconciled.
  const done=comment(5,msg('PASSED',sha2));x.data.comments[175].push(done);
  await x.fire('issue_comment',notify(175,done));
  expect(labels(x.data.issues.get(172))).toEqual(['friday:in-progress']);
 });
 test('partial Refs merge is done as PR but leaves parent issue open and in-progress',async()=>{
  const p=pr(174,79,{state:'closed',merged:true});const x=api({prs:[p],issues:[{number:79,state:'open'}]});
  await x.fire('pull_request_target',{action:'closed',pull_request:p});
  expect(labels(x.data.prs.get(174))).toEqual(['friday:done']);
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-progress']);
  expect(x.data.issues.get(79).state).toBe('open');
 });
 test('explicit full Closes merge to default marks issue done, but stacked branch does not',async()=>{
  for(const [base,expected] of [['main','closed'],['feature-branch','open']]){
   const p=pr(158,117,{body:'Closes #117',state:'closed',merged:true,base});const x=api({prs:[p],issues:[{number:117,state:'open'}]});
   await x.fire('pull_request_target',{action:'closed',pull_request:p});
   expect(x.data.issues.get(117).state).toBe(expected);
   expect(labels(x.data.issues.get(117))).toEqual([base==='main'?'friday:done':'friday:in-progress']);
  }
 });
 test('a sibling opened midway through a merge-reconciliation prevents closing the parent',async()=>{
  const merged=pr(158,117,{body:'Closes #117',state:'closed',merged:true});
  const sibling=pr(178,117,{body:'Refs #117',draft:true});
  const x=api({prs:[merged],issues:[{number:117,state:'open'}]},
    {onListOpen:({call,data})=>{if(call===2)data.prs.set(178,clone(sibling));}});
  await x.fire('pull_request_target',{action:'closed',pull_request:merged});
  expect(x.data.issues.get(117).state).toBe('open');
  expect(labels(x.data.issues.get(117))).toEqual(['friday:in-progress']);
  expect(labels(x.data.prs.get(178))).toEqual(['friday:in-progress']);
 });
 test('a review request arriving during reconciliation is included in final parent state',async()=>{
  const p=pr(175,172,{head:sha2});const c=comment(8,msg('REQUEST',sha2));
  const x=api({prs:[p],issues:[{number:172,state:'open'}],comments:{175:[]}},
    {onListOpen:({call,data})=>{if(call===2)data.comments[175].push(c);}});
  await x.fire('workflow_dispatch',{inputs:{pr_number:'175'}});
  expect(labels(x.data.issues.get(172))).toEqual(['friday:in-review']);
  expect(labels(x.data.prs.get(175))).toEqual(['friday:in-review']);
 });
 test('routing lock refuses a PR that changed linked issue after resolve-parent step',async()=>{
  const p=pr(174,79);const c=comment(1,msg('REQUEST'));
  const x=api({prs:[p],issues:[{number:79,state:'open'}],comments:{174:[c]}});
  await x.fire('issue_comment',notify(174,c),'issue-172');
  expect(x.data.writes).toHaveLength(0);
  await x.fire('issue_comment',notify(174,c),'issue-79');
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-review']);
 });
 test('untrusted author, read-only collaborator and fork cannot mutate states',async()=>{
  const c=comment(1,msg('REQUEST'),{association:'CONTRIBUTOR',login:'evil'});
  const x=api({prs:[pr(174,79)],issues:[{number:79,state:'open'}],comments:{174:[c]}});
  await x.fire('issue_comment',notify(174,c));expect(x.data.writes).toHaveLength(0);
  const reader=comment(2,msg('REQUEST'),{association:'COLLABORATOR',login:'reader'});
  x.data.comments[174]=[reader];await x.fire('issue_comment',notify(174,reader));expect(x.data.writes).toHaveLength(0);
  const f=pr(174,79,{fork:true});const y=api({prs:[f],issues:[{number:79,state:'open'}]});
  await y.fire('pull_request_target',{action:'opened',pull_request:f});expect(y.data.writes).toHaveLength(0);
 });
 test('native write-authorized approval may clear a pending review label',async()=>{
  const p=pr(174,79);const c=comment(1,msg('REQUEST'));
  const x=api({prs:[p],issues:[{number:79,state:'open'}],comments:{174:[c]},reviews:{174:[{id:2,commit_id:sha1,state:'APPROVED',user:{login:'truevox'},author_association:'OWNER',submitted_at:new Date(1740000005000).toISOString()}]}});
  await x.fire('pull_request_review',{action:'submitted',pull_request:p,review:{}});
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-progress']);
 });
 test('Gal Friday exact-head COMMENTED PR review clears queue despite inability to native APPROVE own PR',async()=>{
  const p=pr(174,79), request=comment(1,msg('REQUEST'));
  const review={id:2,commit_id:sha1,state:'COMMENTED',body:msg('PASSED'),
    user:{login:'truevox'},author_association:'OWNER',submitted_at:new Date(1740000005000).toISOString()};
  const x=api({prs:[p],issues:[{number:79,state:'open'}],comments:{174:[request]},reviews:{174:[review]}});
  await x.fire('pull_request_review',{action:'submitted',pull_request:p,review});
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-progress']);
  expect(labels(x.data.prs.get(174))).toEqual(['friday:in-progress']);
 });
 test('a COMMENTED review for an old SHA cannot clear a current review request',async()=>{
  const p=pr(174,79,{head:sha2}), request=comment(1,msg('REQUEST',sha2));
  const review={id:2,commit_id:sha1,state:'COMMENTED',body:msg('PASSED',sha1),
    user:{login:'truevox'},author_association:'OWNER',submitted_at:new Date(1740000005000).toISOString()};
  const x=api({prs:[p],issues:[{number:79,state:'open'}],comments:{174:[request]},reviews:{174:[review]}});
  await x.fire('pull_request_review',{action:'submitted',pull_request:p,review});
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-review']);
 });
 test('the original Friday scope-overlap advisory still reports cross-PR file collisions',async()=>{
  const mine=pr(162,115,{body:'<!-- friday-issue: 115 -->\n<!-- friday-scope: src/systems/** -->'});
  const other=pr(163,152,{body:'<!-- friday-issue: 152 -->\n<!-- friday-scope: src/systems/** -->'});
  const x=api({prs:[mine,other],issues:[{number:115,state:'open'},{number:152,state:'open'}],
    files:{162:[{filename:'src/systems/SimClock.js',status:'modified'}],163:[{filename:'src/systems/SimClock.js',status:'modified'}]}});
  await x.fire('pull_request_target',{action:'synchronize',pull_request:mine});
  expect(x.data.writes).toContainEqual(['createComment',162]);
  expect(labels(x.data.issues.get(115))).toEqual(['friday:in-progress']);
  expect(labels(x.data.issues.get(152))).toEqual([]); // unrelated issue untouched
 });
 test('manual PR-number reconciliation can recover previous missed exact-head handoff',async()=>{
  const c=comment(1,msg('REQUEST')),p=pr(174,79);
  const x=api({prs:[p],issues:[{number:79,state:'open'}],comments:{174:[c]}});
  await x.fire('workflow_dispatch',{inputs:{pr_number:'174'}});
  expect(labels(x.data.issues.get(79))).toEqual(['friday:in-review']);
 });
});
