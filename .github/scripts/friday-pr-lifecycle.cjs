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

function getIssueReference(pr) {
  const body=String(pr.body || ''), title=String(pr.title || '');
  const marker=[...body.matchAll(/<!--\s*friday-issue:\s*(\d+)\s*-->/gi)].map(x=>Number(x[1]));
  const refs=[...body.matchAll(/^\s*(?:\*\*)?(?:refs?|closes?|fixes?|resolves?)\s+#(\d+)\b/gmi)].map(x=>Number(x[1]));
  const titles=[...title.matchAll(/\[#(\d+)\]/g)].map(x=>Number(x[1]));
  // Explicit marker > top-level Ref/Close > bracketed title. Conflicts must not
  // let a PR unexpectedly manipulate an unrelated issue.
  const picks=marker.length ? marker : refs.length ? refs : titles;
  const unique=[...new Set(picks)];
  if (unique.length !== 1 || !Number.isSafeInteger(unique[0]) || unique[0] < 1) return null;
  if (marker.length && refs.length && refs.some(n=>n!==unique[0])) return null;
  if (titles.length && titles.some(n=>n!==unique[0])) return null;
  return unique[0];
}

function explicitlyCloses(pr, issueNumber) {
  const lines=[...String(pr.body||'').matchAll(/^\s*(?:\*\*)?(?:closes?|fixes?|resolves?)\s+#(\d+)\b/gmi)];
  return lines.some(x=>Number(x[1])===issueNumber);
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

async function run({github,context,core}) {
  const {owner,repo}=context.repo;
  const event=context.eventName;
  const payload=context.payload||{};
  const prNumber=event==='issue_comment' ? payload.issue?.pull_request && payload.issue.number
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
    if(changes.some(f=>/^\.friday\/issue-\d+-start\.md$/.test(f.filename))){
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

  // A shared parent may have multiple open PRs (e.g. #172). Derive its state
  // from ALL linked open PRs, not merely whichever event happened to arrive.
  const open=await github.paginate(github.rest.pulls.list,{owner,repo,state:'open',per_page:100});
  const siblings=open.filter(p=>getIssueReference(p)===issueNumber&&p.head?.repo?.full_name===`${owner}/${repo}`);
  const states=[];
  for(const p of siblings)states.push(await reviewState(p));
  const currentState=pr.state==='open' ? await reviewState(pr) : null;
  const targetIssueState=states.includes(STATES.review)?STATES.review
    : states.length?STATES.progress
    : pr.state==='closed'&&pr.merged?STATES.progress:STATES.todo;
  // A merged PR is done as a PR. A partial Ref-only merge is not a done ISSUE.
  await setState(pr.number,pr,pr.state==='open'?currentState:pr.merged?STATES.done:null);
  const onDefault=pr.base.ref===(await github.rest.repos.get({owner,repo})).data.default_branch;
  const complete=pr.state==='closed'&&pr.merged&&onDefault&&explicitlyCloses(pr,issueNumber);
  if(complete&&!siblings.length){
    await setState(issueNumber,issueResponse.data,STATES.done);
    if(issueResponse.data.state!=='closed')await github.rest.issues.update({owner,repo,issue_number:issueNumber,state:'closed'});
  }else{
    // Preserve a completed/closed issue unless an unfinished open PR really is
    // continuing work; no accidental reopen of externally closed issues.
    if(issueResponse.data.state==='open')await setState(issueNumber,issueResponse.data,targetIssueState);
    else core.info(`Issue #${issueNumber} is closed; do not reopen it`);
  }

  // Preserve original #153 cross-PR scope overlap advisory on PR transitions.
  // No comment event should cause a full overlap scan or trigger a PR build.
  if(event==='pull_request'&&pr.state==='open'&&/<!--\s*friday-issue:\s*\d+\s*-->/i.test(pr.body||'')){
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
  if(event==='pull_request'&&pr.state==='open'&&!pr.draft){
    const starter=(await files(pr)).find(f=>/^\.friday\/issue-\d+-start\.md$/.test(f.filename));
    if(starter){core.setFailed('Remove temporary '+starter.filename+' before review');return;}
  }
  core.info(`#${pr.number} → #${issueNumber}: PR ${pr.state==='open'?currentState:pr.merged?STATES.done:'closed'}, issue ${complete?'complete':targetIssueState}`);
}

module.exports={run,getIssueReference,explicitlyCloses,parseReviewSignal};
