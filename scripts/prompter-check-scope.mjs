import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
const before=process.env.BEFORE;
let trackingOnly=false;
if(/^[a-f0-9]{40}$/.test(before||'')&&!/^0+$/.test(before)){
  const files=execFileSync('git',['diff','--name-only',before,'HEAD'],{encoding:'utf8'}).trim().split('\n');
  const allowed=/^(src\/prompter(?:-reader\.js|\.js|-guide\.ts|-matcher\.ts)|public\/prompter\/(?:runtime\.js|release\.json|assets\/semantic\.worker-[\w-]+\.js)|scripts\/(?:prompter-[\w.-]+|build-prompter-tracking\.mjs)|tests\/(?:prompter-tracking\.test\.js|browser\/prompter-tracking\.spec\.js)|docs\/prompter-tracking\.md|\.github\/workflows\/pages\.yml)$/;
  trackingOnly=files.length>0&&files.every(file=>allowed.test(file));
}
appendFileSync(process.env.GITHUB_OUTPUT,`tracking_only=${trackingOnly}\n`);
console.log({trackingOnly});
