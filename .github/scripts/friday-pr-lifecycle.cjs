'use strict';
/** GitHub Actions-only orchestration. The action checks out DEFAULT BRANCH code,
 * not a PR head; event payloads and comment bodies are always untrusted data.
 * No workflow token, label or message alone grants approval to merge. */
const STATES = Object.freeze({
  todo: 'friday:todo', progress: 'friday:in-progress', review: 'friday:in-review', done: 'friday:done',
});
const COLORS = { todo:'D4C5F9', progress:'FBCA04', review:'1D76DB', done:'0E8A16' };
const SHA = /^[0-9a-f]{40}$/i;
const REVIEW_MESSAGE = /^\s*\[(GAL FRIDAY REVIEW (?:REQUEST|PASSED|CHANGES REQUESTED))\]/i;
const TRUSTED_ASSOCIATIONS = new Set(['OWNER','MEMBER','COLLABORATOR']);

/** Extract only top-level issue directives: never read "Closes" examples from
 * code fences, HTML comments, indented code or raw HTML code/pre blocks. */
function bodyDirectives(body) {
  const markers=[], refs=[];
  const cleaned=String(body||'').replace(/<(pre|code|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, v=>'\n'.repeat((v.match(/\n/g)||[]).length));
  let fence=null, inComment=false, inlineCode=null;
  for(let line of cleaned.split(/\r?\n/)){
    const delimiter=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if(fence){
      if(delimiter&&delimiter[1][0]===fence.char&&delimiter[1].length>=fence.length&&/^\s*$/.test(delimiter[2]))fence=null;
      continue;
    }
    if(delimiter){fence={char:delimiter[1][0],length:delimiter[1].length};continue;}
    if(/^ {4,}|^\t/.test(line))continue;
    // A Friday machine marker is a whole standalone HTML comment line, not
    // an example buried inside another multiline HTML comment.
    const marker=/^\s*<!--\s*friday-issue:\s*(\d+)\s*-->\s*$/i.exec(line);
    if(marker&&!inComment&&inlineCode===null){markers.push(Number(marker[1]));continue;}
    const rawLine=line, startedInsideComment=inComment;
    let prose='';
    while(line.length){
      if(inComment){
        const end=line.indexOf('-->');
        if(end<0){line='';break;}
        line=line.slice(end+3);inComment=false;
      }else{
        const start=line.indexOf('<!--');
        if(start<0){prose+=line;break;}
        prose+=line.slice(0,start);line=line.slice(start+4);inComment=true;
      }
    }
    // CommonMark code spans may cross line boundaries. A backtick-delimited
    // example must NEVER be a real issue instruction even if its interior
    // line begins with an otherwise valid `Closes #N`.
    const startedInsideCode=inlineCode!==null;
    for(let at=0;at<prose.length;){
      if(prose[at]==='`' && (at===0||prose[at-1]!=='\\')){
        let next=at+1;
        while(next<prose.length&&prose[next]==='`')next++;
        const count=next-at;
        if(inlineCode===null)inlineCode=count;
        else if(inlineCode===count)inlineCode=null;
        at=next;
        continue;
      }
      at++;
    }
    const ref=(startedInsideCode||startedInsideComment)?null:/^\s*(?:\*\*)?(refs?|closes?|fixes?|resolves?)\s+#(\d+)\b/i.exec(rawLine);
    if(ref)refs.push({verb:ref[1].toLowerCase(),number:Number(ref[2])});
  }
  return {markers,refs};
}

function getIssueReference(pr) {
  const {markers,refs}=bodyDirectives(pr.body);
  const titles=[...String(pr.title||'').matchAll(/\[#(\d+)\]/g)].map(x=>Number(x[1]));
  const referenced=refs.map(x=>x.number);
  const picks=markers.length?markers:referenced.length?referenced:titles;
  const unique=[...new Set(picks)];
  if(unique.length!==1||!Number.isSafeInteger(unique[0])||unique[0]<1)return null;
  if(markers.length&&referenced.some(n=>n!==unique[0]))return null;
  if(titles.some(n=>n!==unique[0]))return null;
  return unique[0];
}

function explicitlyCloses(pr,issueNumber){
  return bodyDirectives(pr.body).refs.some(x=>x.number===issueNumber&&
    /^(?:closes?|fixes?|resolves?)$/.test(x.verb));
}

function parseReviewSignal(body) {
  if(typeof body !== 'string') return null;
  const match=REVIEW_MESSAGE.exec(body);
  if(!match) return null;
  const trailing=body.slice(match[0].length, 2500);
  // Require an explicit current commit SHA. Prefer the 'HEAD sha' spelling, and
  // otherwise accept the first complete 40-hex SHA in the review text.
  const head=/(?:exact\s+)?HEAD\s*(?:sha|commit)?\s*[:=` ]+`?([0-9a-f]{40})\b/i.exec(trailing);
  const any=/(?<![a-f0-9])([a-f0-9]{40})(?![a-f0-9])/i.exec(trailing);
  const sha=(head||any)?.[1]?.toLowerCase();
  if(!sha||!SHA.test(sha))return null;
  const normalized=match[1].toUpperCase();
  return {sha, kind:normalized.endsWith('REQUEST')?'request':normalized.endsWith('PASSED')?'passed':'changes'};
}

const matchingLabel=(l,name)=>(typeof l==='string'?l:l.name)===name;
function hasLabel(item,name){return (item.labels||[]).some(l=>matchingLabel(l,name));}
function scopes(body){const m=/<!--\s*friday-scope:\s*([\s\S]*?)\s*-->/i.exec(body||'');return m?m[1].split(',').map(s=>s.trim()).filter(Boolean):[];}
function scoped(scope,file){return scope===file||(scope.endsWith('/**')&&(file===scope.slice(0,-3)||file.startsWith(scope.slice(0,-3)+'/')));}
function overlaps(a,b){return scoped(a,b)||scoped(b,a);}
const isActiveStarter=(f)=>f.status!=='removed'&&/^\.friday\/issue-\d+-start\.md$/.test(f.filename);

async function run({github,context,core,expectedKey=null,prNumber:resolvedPrNumber=null,originEvent=null,originAction=null}) {
  const {owner,repo}=context.repo;
  const event=context.eventName;
  // The privileged workflow_run carries only a previously validated numeric
  // pointer from an unprivileged workflow. It NEVER executes its artifact.
  const source=originEvent||event;
  const sourceAction=originAction||context.payload?.action||'';
  const prEvent=source==='pull_request_target'||source==='pull_request';
  const payload=context.payload||{};
  const prNumber=Number.isSafeInteger(resolvedPrNumber)&&resolvedPrNumber>0
    ? resolvedPrNumber
    : event==='issue_comment' ? payload.issue?.pull_request && payload.issue.number
    : event==='workflow_dispatch' ? Number(payload.inputs?.pr_number)
    : payload.pull_request?.number;
  if(!Number.isSafeInteger(prNumber)||prNumber<1){core.info('No PR in event; skip');return;}

  const trustCache=new Map();
  const trusted=async (login,association)=>{
    if(!login||!TRUSTED_ASSOCIATIONS.has(association))return false;
    if(trustCache.has(login))return trustCache.get(login);
    let allowed=false;
    try{
      const r=await github.rest.repos.getCollaboratorPermissionLevel({owner,repo,username:login});
      allowed=['admin','maintain','write'].includes(r.data.permission);
    }catch(e){if(e.status!==403&&e.status!==404)throw e;}
    trustCache.set(login,allowed);return allowed;
  };

  // Untrusted user/bot comments never cause any issue/PR mutation. We only
  // replay authorized, exact-head review signals; no implicit PR-code execution.
  if(event==='issue_comment'){
    if(!['created','edited'].includes(payload.action))return;
    if(!parseReviewSignal(payload.comment?.body))return;
    if(!await trusted(payload.comment?.user?.login,payload.comment?.author_association)){
      core.info('Untrusted review-comment author; skip');return;
    }
  }
  if(event==='pull_request_review' && !['submitted','dismissed'].includes(payload.action))return;

  const fetched=await github.rest.pulls.get({owner,repo,pull_number:prNumber});
  const pr=fetched.data;
  if(pr.head?.repo?.full_name!==`${owner}/${repo}`){core.info('Fork or untrusted PR head; skip');return;}
  const issueNumber=getIssueReference(pr);
  if(!issueNumber){core.info('Not a uniquely linked Friday PR; skip');return;}
  if(expectedKey&&expectedKey!==`issue-${issueNumber}`){core.warning('PR parent changed after queue routing; wait for edited event');return;}
  const issueResponse=await github.rest.issues.get({owner,repo,issue_number:issueNumber});
  if(issueResponse.data.pull_request){core.warning('Linked number points to a PR; skip');return;}

  const ensureLabels=async()=>{
    for(const [key,name] of Object.entries(STATES)){
      try{await github.rest.issues.createLabel({owner,repo,name,color:COLORS[key],description:'Friday orchestration lifecycle state'});}
      catch(e){if(e.status!==422)throw e;}
    }
  };
  await ensureLabels();

  async function setState(number,item,desired){
    const active=Object.values(STATES).filter(label=>hasLabel(item,label));
    const removals=active.filter(label=>label!==desired);
    for(const name of removals){
      try{await github.rest.issues.removeLabel({owner,repo,issue_number:number,name});}
      catch(e){if(e.status!==404)throw e;}
    }
    if(desired&&!active.includes(desired))await github.rest.issues.addLabels({owner,repo,issue_number:number,labels:[desired]});
  }

  const commentCache=new Map(),reviewCache=new Map(),fileCache=new Map();
  async function files(p){
    if(!fileCache.has(p.number)) fileCache.set(p.number,await github.paginate(github.rest.pulls.listFiles,
      {owner,repo,pull_number:p.number,per_page:100}));
    return fileCache.get(p.number);
  }
  async function reviewState(p){
    if(p.draft)return STATES.progress;
    const changes=await files(p);
    if(changes.some(isActiveStarter)){
      core.info(`PR #${p.number} still has a starter marker`);return STATES.progress;
    }
    if(!commentCache.has(p.number))commentCache.set(p.number,await github.paginate(github.rest.issues.listComments,
      {owner,repo,issue_number:p.number,per_page:100}));
    const events=[];
    for(const c of commentCache.get(p.number)){
      const signal=parseReviewSignal(c.body);
      if(!signal||signal.sha!==p.head.sha.toLowerCase())continue;
      if(!await trusted(c.user?.login,c.author_association))continue;
      events.push({...signal,at:Date.parse(c.updated_at||c.created_at)||0,id:c.id||0});
    }
    if(!reviewCache.has(p.number))reviewCache.set(p.number,await github.paginate(github.rest.pulls.listReviews,
      {owner,repo,pull_number:p.number,per_page:100}));
    for(const rv of reviewCache.get(p.number)){
      if(rv.commit_id?.toLowerCase()!==p.head.sha.toLowerCase()||
        !['APPROVED','CHANGES_REQUESTED','COMMENTED'].includes(rv.state))continue;
      if(!await trusted(rv.user?.login,rv.author_association))continue;
      // Gal Friday's connected `truevox` identity owns the PR and GitHub does
      // not allow a native APPROVE of one's own PR. The review tool submits a
      // COMMENTED review with [GAL FRIDAY REVIEW PASSED] and an exact HEAD.
      // Treat that as a REVIEW VERDICT for label bookkeeping only, never as a
      // substitute for required branch-protection approval by another user.
      const signal=parseReviewSignal(rv.body);
      const kind=rv.state==='APPROVED'?'passed':rv.state==='CHANGES_REQUESTED'?'changes'
        :signal?.sha===p.head.sha.toLowerCase()&&signal.kind!=='request'?signal.kind:null;
      if(kind)events.push({kind,at:Date.parse(rv.submitted_at)||0,id:rv.id||0});
    }
    events.sort((a,b)=>a.at-b.at||a.id-b.id);
    return events.at(-1)?.kind==='request'?STATES.review:STATES.progress;
  }

  // Compute each CURRENT sibling's state from the authenticated GitHub record.
  // Every event for this parent reconciles every linked open PR; that is
  // important because GitHub's job concurrency may coalesce queued events.
  const listOpen=()=>github.paginate(github.rest.pulls.list,{owner,repo,state:'open',per_page:100});
  const linked=(all)=>all.filter(p=>getIssueReference(p)===issueNumber&&
    p.head?.repo?.full_name===`${owner}/${repo}`);
  const open=await listOpen();
  const siblings=linked(open);
  const seen=new Map();
  for(const p of siblings){
    const status=await reviewState(p);
    seen.set(p.number,{status,sha:p.head.sha,draft:p.draft});
    await setState(p.number,p,status);
  }
  const currentState=pr.state==='open'?await reviewState(pr):null;
  if(pr.state==='closed')await setState(pr.number,pr,pr.merged?STATES.done:null);
  else if(!seen.has(pr.number))await setState(pr.number,pr,currentState);

  // Read current open PRs and current issue labels again just before writing
  // the shared parent; the original event payload and early issue snapshot
  // can be stale. All instances for this parent have been serialized by the
  // workflow's parent-issue concurrency key.
  const latestOpen=await listOpen();
  const latestSiblings=linked(latestOpen);
  const states=[];
  for(const p of latestSiblings){
    // A handoff or new commit may have arrived while we checked siblings.
    // Re-read actual comments/reviews for the final shared-issue decision.
    commentCache.delete(p.number);reviewCache.delete(p.number);fileCache.delete(p.number);
    const status=await reviewState(p);
    await setState(p.number,p,status);
    states.push(status);
  }
  const targetIssueState=states.includes(STATES.review)?STATES.review
    : states.length?STATES.progress
    : pr.state==='closed'&&pr.merged?STATES.progress:STATES.todo;
  const onDefault=pr.base.ref===(await github.rest.repos.get({owner,repo})).data.default_branch;
  const complete=pr.state==='closed'&&pr.merged&&onDefault&&prEvent&&sourceAction==='closed'&&explicitlyCloses(pr,issueNumber);
  // A new sibling might appear while we process a closed PR. Revalidate
  // immediately before allowing a completed-issue state transition.
  const closureSiblings=complete?linked(await listOpen()):latestSiblings;
  const issueNow=(await github.rest.issues.get({owner,repo,issue_number:issueNumber})).data;
  if(complete&&!closureSiblings.length){
    await setState(issueNumber,issueNow,STATES.done);
    if(issueNow.state!=='closed')await github.rest.issues.update({owner,repo,issue_number:issueNumber,state:'closed'});
  }else{
    if(issueNow.state==='open')await setState(issueNumber,issueNow,
      closureSiblings.length&&!latestSiblings.length?STATES.progress:targetIssueState);
    else core.info(`Issue #${issueNumber} is closed; do not reopen it`);
  }

  // Preserve original #153 cross-PR scope overlap advisory on PR transitions.
  // No comment event should cause a full overlap scan or trigger a PR build.
  if(prEvent&&pr.state==='open'&&bodyDirectives(pr.body).markers.length>0){
    const myFiles=(await files(pr)).map(f=>f.filename).filter(f=>!f.startsWith('.friday/'));
    const myScopes=scopes(pr.body),conflicts=[];
    for(const other of open){
      if(other.number===pr.number)continue;
      const theirs=scopes(other.body);
      const otherFiles=(myFiles.length||myScopes.length)
        ? (await files(other)).map(f=>f.filename).filter(f=>!f.startsWith('.friday/')):[];
      const hits=new Set();
      for(const f of myFiles)if(otherFiles.includes(f)||theirs.some(s=>scoped(s,f)))hits.add(f);
      for(const s of myScopes){
        for(const t of theirs)if(overlaps(s,t))hits.add(`${s} ↔ ${t}`);
        for(const f of otherFiles)if(scoped(s,f))hits.add(`${s} ↔ ${f}`);
      }
      if(hits.size)conflicts.push({number:other.number,hits:[...hits].slice(0,12)});
    }
    const signature='<!-- friday-overlap-report -->';
    const report=signature+'\n### Friday cross-PR overlap scan\n\n'+
      (conflicts.length?conflicts.map(c=>`- PR #${c.number}: ${c.hits.map(s=>'`'+s+'`').join(', ')}`).join('\n')
        :'No overlapping declared scopes or changed files detected among currently open PRs.')+
      '\n\n*This is an advisory scan of declared scopes and committed PR changes, not uncommitted work. Coordinate overlapping changes before merging.*';
    if(!commentCache.has(pr.number))commentCache.set(pr.number,await github.paginate(github.rest.issues.listComments,
      {owner,repo,issue_number:pr.number,per_page:100}));
    const prior=commentCache.get(pr.number).find(c=>c.user?.type==='Bot'&&c.body?.includes(signature));
    if(prior){if(prior.body!==report)await github.rest.issues.updateComment({owner,repo,comment_id:prior.id,body:report});}
    else if(conflicts.length||myScopes.length)await github.rest.issues.createComment({owner,repo,issue_number:pr.number,body:report});
  }
  // Preserve the original lifecycle gate: a PR containing its temporary
  // starter marker cannot be accepted for review, even when someone flips the
  // GitHub draft switch manually. Labels are reconciled before failing CI.
  if(prEvent&&pr.state==='open'&&!pr.draft){
    const starter=(await files(pr)).find(isActiveStarter);
    if(starter){core.setFailed('Remove temporary '+starter.filename+' before review');return;}
  }
  core.info(`#${pr.number} → #${issueNumber}: PR ${pr.state==='open'?currentState:pr.merged?STATES.done:'closed'}, issue ${complete?'complete':targetIssueState}`);
}

module.exports={run,getIssueReference,explicitlyCloses,parseReviewSignal};
