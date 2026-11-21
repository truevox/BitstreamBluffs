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
  expect(runSignal('pull_request',{pull_request:{number:174}})).toEqual({
    pointer:{pr_number:174,event_name:'pull_request'},ready:true,
  });
  expect(runSignal('pull_request_review',{pull_request:{number:174},review:{id:234}})).toEqual({
    pointer:{pr_number:174,event_name:'pull_request_review'},ready:true,
  });
  expect(runSignal('issue_comment',{issue:{number:174,pull_request:{url:'...'}}})).toEqual({
    pointer:{pr_number:174,event_name:'issue_comment'},ready:true,
  });
});

test('non-PR, malformed, zero and oversized issue pointers are not emitted',()=>{
  for(const [kind,event] of [
    ['issue_comment',{issue:{number:174}}],
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
  expect(signal).not.toContain('actions/checkout');
  expect(privileged).toContain('workflow_run:');
  expect(privileged).not.toContain('pull_request_target:');
  expect(privileged).toMatch(/workflow_run:\s+workflows: \[Friday PR lifecycle signal\]/);
  expect(privileged).toContain('size_in_bytes>4096');
  expect(privileged).toContain('actions/download-artifact@v4');
  expect(privileged).toContain('github.event.repository.default_branch');
  expect(privileged).toContain('queue: max');
});
