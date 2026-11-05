import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop');
const req=createRequire(path.join(desktop,'package.json')),{build}=req('esbuild');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const out=path.resolve('.artifacts/p522-host-a02-01/main-integration');fs.mkdirSync(out,{recursive:true});
const evidence='docs/architecture/evidence/p522-host-a02-01/continuation';fs.mkdirSync(evidence,{recursive:true});
if(execFileSync('git',['-C',host,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!=='eb52760564dbba2e5971fa54bd67384e281cd3b8')throw Error('Hermes HEAD changed');
const records=[];
function adaptGateway(s){
 s=`import {waitForNativeGatewayReady} from ${JSON.stringify(path.resolve('scripts/p522-host-a02-01-gateway-ready.mjs'))};\n`+s;
 return replace(s,'    backendReady = true',`    mark('health.ready')
    await waitForNativeGatewayReady(\`ws://127.0.0.1:\${port}/api/ws?token=\${encodeURIComponent(token)}\`, {onEvent:state=>mark('native.gateway.'+state)})
    backendReady = true`);
}

const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Exact Main anchor changed: '+a);return s.replace(a,b);};
await build({entryPoints:[path.join(desktop,'electron/main.ts')],outfile:path.join(out,'main.mjs'),bundle:true,platform:'node',format:'esm',target:'node20',external:['electron','fs'],banner:{js:`import {createRequire} from 'node:module'; const require=createRequire(${JSON.stringify(path.join(desktop,'package.json'))});`},plugins:[{name:'locked-main-observation',setup(b){b.onResolve({filter:/^node-pty$/},()=>({path:pathToFileURL(req.resolve('node-pty')).href,external:true}));b.onLoad({filter:/electron[\\/]main\.ts$/},args=>{const raw=fs.readFileSync(args.path,'utf8');if(sha(raw)!=='0b184d8d114126ad77ca16ce5b42a410a677de13d5548825c1bc68f80eb6ab4e')throw Error('Main SHA mismatch');let s=raw.replaceAll('\r\n','\n');s=`import {mark,traceChild} from ${JSON.stringify(path.resolve('scripts/p522-host-a02-01-main-trace.mjs'))};\n`+s;s=replace(s,'    const hermesProcess = spawn(','    mark("backend.spawn.begin")\n    const hermesProcess = spawn(');s=replace(s,'    const processOwner = backendConnectionState.attachProcess(connectionAttempt, hermesProcess)','    traceChild(hermesProcess, backend.command, backend.args, hermesCwd, { ...process.env, HERMES_HOME, ...backend.env, TERMINAL_CWD:hermesCwd, HERMES_DASHBOARD_SESSION_TOKEN:token, HERMES_DESKTOP:"1", HERMES_WEB_DIST:webDist })\n    const processOwner = backendConnectionState.attachProcess(connectionAttempt, hermesProcess)');s=replace(s,'    const port = await Promise.race([','    mark("waiter.begin")\n    const port = await Promise.race([');s=replace(s,'    const baseUrl = `http://127.0.0.1:${port}`','    mark("waiter.resolved", {port})\n    const baseUrl = `http://127.0.0.1:${port}`');s=adaptGateway(s);records.push({file:'apps/desktop/electron/main.ts',originalSha256:sha(raw),patchedSha256:sha(s),upstreamFileWritten:false,scope:'Native gateway.ready prerequisite after HTTP Health; no RPC, protocol or port budget change'});fs.writeFileSync(path.join(evidence,'observed-main.ts.txt'),s);return {contents:s,loader:'ts',resolveDir:path.dirname(args.path)};});}}]});
// Preserve native app roots/preload/resource paths while executing a separate bundle.
fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({name:'a02-01-main-observation',version:'0.17.0',type:'module',main:'bootstrap.mjs'}));
fs.writeFileSync(path.join(out,'set-root.cjs'),`const fs=require('node:fs');const {app}=require('electron');const log=(kind,message)=>{if(process.env.CAREERADAPT_STARTUP_TRACE)fs.appendFileSync(process.env.CAREERADAPT_STARTUP_TRACE,JSON.stringify({at:Date.now(),kind,message})+'\\n');};log('bootstrap.start','static ESM entry');process.on('uncaughtException',e=>{log('bootstrap.exception',String(e.stack));app.exit(1);});process.on('unhandledRejection',e=>{log('bootstrap.rejection',String(e?.stack??e));app.exit(1);});app.setAppPath(${JSON.stringify(desktop)});\n`);
fs.writeFileSync(path.join(out,'bootstrap.mjs'),`import './set-root.cjs';\nimport './main.mjs';\n`);
fs.writeFileSync(path.join(evidence,'main-patch-manifest.json'),JSON.stringify({upstreamCommit:'eb52760564dbba2e5971fa54bd67384e281cd3b8',records,appRoot:out,artifactSha256:sha(fs.readFileSync(path.join(out,'main.mjs'))),preloadSha256:sha(fs.readFileSync(path.join(desktop,'dist/electron-preload.js'))),traceHelperSha256:sha(fs.readFileSync('scripts/p522-host-a02-01-main-trace.mjs')),sourcePortBudgetChanged:false,launchPortBudgetMs:150000,healthBudgetMs:45000,gatewayReadyBudgetMs:45000,gatewayHelperSha256:sha(fs.readFileSync('scripts/p522-host-a02-01-gateway-ready.mjs'))},null,2)+'\n');
console.log('MAIN_OBSERVATION_BUILD_PASS');
