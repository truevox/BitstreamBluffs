/** Security-boundary test: exercise the unprivileged workflow's real Node snippet. */
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = join(import.meta.dirname ?? process.cwd(), '.');
const signal = readFileSync('.github/workflows/friday-pr-lifecycle-signal.yml', 'utf8');
const privileged = readFileSync('.github/workflows/friday-pr-lifecycle.yml', 'utf8');
const snippet = signal.match(/node <<'NODE'\n([\s\S]*?)\n\s+NODE\b/)?.[1]?.replace(/^ {10}/gm, '');

function runSignal(eventName, payload) {
  const temp=mkdtempSync(join(tmpdir(),'bb-friday-signal-'));
  try {
    const eventPath=join(temp,'event.json');
    const outputPath=join(temp,'github-output.txt');
    writeFileSync(eventPath,JSON.stringify(payload));
    writeFileSync(outputPath,'');
    execFileSync(process.execPath,['-e',snippet],{
      cwd:temp,env:{...process.env,GITHUB_EVENT_NAME:eventName,GITHUB_EVENT_PATH:eventPath,GITHUB_OUTPUT:outputPath},
      stdio:'pipe',timeout:5000,
    });
    const artifact=join(temp,'friday-event-pointer.json');
    return { pointer:existsSync(artifact)?JSON.parse(readFileSync(artifact,'utf8')):null,
      ready:readFileSync(outputPath,'utf8').includes('ready=true') };
  }finally{rmSync(temp,{recursive:true,force:true});}
}

test('unprivileged collector passes exactly a numeric PR pointer and bounded source event',()=>{
  expect(snippet).toMatch(/Number\.isSafeInteger/);
  expect(runSignal('pull_request',{action:'synchronize',pull_request:{number:174}})).toEqual({
    pointer:{pr_number:174,event_name:'pull_request'},ready:true,
  });
  expect(runSignal('pull_request_review',{action:'submitted',pull_request:{number:174},review:{id:234,state:'APPROVED'}})).toEqual({
    pointer:{pr_number:174,event_name:'pull_request_review',review_id:234},ready:true,
  });
  expect(runSignal('issue_comment',{action:'created',issue:{number:174,pull_request:{url:'...'}},comment:{id:456,body:'[GAL FRIDAY REVIEW REQUEST] HEAD '+'a'.repeat(40)}})).toEqual({
    pointer:{pr_number:174,event_name:'issue_comment',comment_id:456},ready:true,
  });
});

test('non-PR, malformed, zero and oversized issue pointers are not emitted',()=>{
  for(const [kind,event] of [
    ['issue_comment',{issue:{number:174}}],
    ['issue_comment',{action:'created',issue:{number:174,pull_request:{}},comment:{id:456,body:'Random discussion'}}],
    ['pull_request_review',{action:'submitted',pull_request:{number:174},review:{id:123,state:'COMMENTED',body:'Other feedback'}}],
    ['pull_request',{pull_request:{number:0}}],
    ['pull_request',{pull_request:{number:'abc'}}],
    ['pull_request_review',{pull_request:{number:1000000000}}],
  ]){
    expect(runSignal(kind,event)).toEqual({pointer:null,ready:false});
  }
});

test('unprivileged source has no label writes or checkout; privileged writer starts on default branch only',()=>{
  expect(signal).toMatch(/name: Friday PR lifecycle signal/);
  expect(signal).toMatch(/permissions:\s+contents: read/);
  expect(signal).not.toContain('issues: write');
  expect(signal).toContain('github.event.comment.author_association');
  expect(signal).toContain('startsWith(github.event.comment.body');
  expect(signal).not.toContain('actions/checkout');
  expect(privileged).toContain('workflow_run:');
  expect(privileged).not.toContain('pull_request_target:');
  expect(privileged).toMatch(/workflow_run:\s+workflows: \[Friday PR lifecycle signal\]/);
  expect(privileged).toContain('size_in_bytes>4096');
  expect(privileged).toContain('readPointerArchive(buffer)');
  expect(privileged).not.toContain('uses: actions/download-artifact@v4');
  expect(privileged).toContain('github.rest.actions.downloadArtifact');
  expect(privileged).toContain('github.event.repository.default_branch');
  expect(privileged).toContain('queue: max');
});

test('PR-head starter check runs with read-only GitHub API and fails the PR check when marker exists',async()=>{
  const block=signal.split('      - name: Enforce removal of starter file from the actual PR HEAD\n')[1]
    .split('      - name: Emit validated issue/PR pointer only\n')[0];
  const script=block.split('          script: |\n')[1]?.replace(/^ {12}/gm,'');
  expect(script).toContain('github.rest.git.getTree');
  const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
  const run=new AsyncFunction('github','context','core',script);
  const context={repo:{owner:'truevox',repo:'BitstreamBluffs'},
    payload:{pull_request:{head:{sha:'a'.repeat(40),repo:{full_name:'truevox/BitstreamBluffs'}}}}};
  const call=async(data)=>{
    const fail=[];
    const github={rest:{git:{getTree:async()=>({data})}}};
    await run(github,context,{setFailed:(msg)=>fail.push(msg)});
    return fail;
  };
  expect(await call({truncated:false,tree:[{path:'.friday/issue-117-start.md',type:'blob'}]}))
    .toEqual(['Remove temporary .friday/issue-117-start.md before marking this PR ready']);
  expect(await call({truncated:false,tree:[{path:'src/game.js',type:'blob'}]})).toEqual([]);
  expect(await call({truncated:true,tree:[]})).toEqual(['Cannot verify entire PR-head tree; starter check unsafe']);
});

test('starter gate remains a PR-head workflow check rather than only a downstream label-writer failure',()=>{
  expect(signal).toContain("if: github.event_name == 'pull_request'");
  expect(signal).toContain('tree_sha:pr.head.sha');
  expect(signal).toContain('pull-requests: read');
  expect(signal).not.toContain('issues: write');
  expect(privileged).toContain('workflow_run:');
});
