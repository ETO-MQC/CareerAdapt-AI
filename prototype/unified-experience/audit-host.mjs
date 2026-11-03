import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
const hermes=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(hermes,'apps/desktop');
const req=createRequire(path.join(desktop,'package.json'));
const root=path.resolve('.artifacts/p521-host-'+Date.now()),home=path.join(root,'home');fs.mkdirSync(home,{recursive:true});
fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: poc-offline\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: poc-not-a-secret\n');fs.writeFileSync(path.join(home,'.env'),'');
const dir=path.join(home,'desktop-plugins/careeradapt-profile-packaging-poc');fs.mkdirSync(dir,{recursive:true});fs.copyFileSync('.artifacts/p520b2b2-profile-plugin/production-like/plugin.js',path.join(dir,'plugin.js'));
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v&&!/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_BASE_URL)$/.test(k)&&!k.startsWith('HERMES')&&k!=='ELECTRON_RUN_AS_NODE'));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:hermes,HERMES_DESKTOP_APP_NAME:'CareerAdaptDesignAudit',HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5174'});
const out='docs/architecture/evidence/p521';fs.mkdirSync(out,{recursive:true});
const result={root,status:'RUNNING',errors:[],captures:[]};let app;
try{
 app=await _electron.launch({executablePath:req('electron'),args:[desktop,'--disable-gpu','--no-sandbox'],env,cwd:desktop,timeout:30000});
 const p=await app.firstWindow();p.on('pageerror',e=>result.errors.push(e.message));
 await p.getByText('CareerAdapt Profile',{exact:true}).first().waitFor({timeout:60000});
 for(const size of [{width:1440,height:900},{width:1920,height:1080},{width:1024,height:768}]){
  await p.setViewportSize(size);
  for(const [name,hash] of [['home','/'],['settings','/settings'],['artifacts','/artifacts'],['profile','/careeradapt-profile']]){
   await p.evaluate(h=>location.hash=h,hash);await p.waitForTimeout(650);
   const file=`host-${name}-${size.width}.png`;await p.screenshot({path:path.join(out,file)});result.captures.push(file);
   fs.writeFileSync(path.join(root,`${name}-${size.width}.txt`),await p.locator('body').innerText());
  }
 }
 await p.setViewportSize({width:1440,height:900});await p.evaluate(()=>location.hash='/settings');await p.waitForTimeout(300);
 fs.writeFileSync(path.join(root,'buttons.json'),JSON.stringify(await p.getByRole('button').allTextContents(),null,2));
 await p.getByRole('button',{name:'Plugins',exact:true}).click();await p.waitForTimeout(500);await p.screenshot({path:path.join(out,'host-plugins-1440.png')});result.captures.push('host-plugins-1440.png');
 await p.evaluate(()=>location.hash='/');await p.waitForTimeout(400);
 result.buttons=await p.getByRole('button').evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label'),title:e.getAttribute('title'),text:e.textContent})));
 for(const state of ['normal','running','complete']){
  await p.evaluate(async state=>{const s=await import('/src/store/session.ts');s.setActiveSessionId(null);s.setMessages([{id:'design-user',role:'user',parts:[{type:'text',text:'Synthetic UI audit: summarize a fictional project.'}]},{id:'design-assistant',role:'assistant',pending:state==='running',parts:state==='normal'?[{type:'text',text:'This is a synthetic renderer fixture. No provider or agent tool was invoked.'}]:[{type:'tool-call',toolCallId:'design-tool',toolName:'read_file',args:{path:'synthetic-example.txt'},argsText:'{"path":"synthetic-example.txt"}',...(state==='complete'?{result:'Synthetic project notes. No file read was performed.'}:{})},{type:'text',text:state==='complete'?'Synthetic result displayed.':'Reviewing synthetic project notes…'}]}]);},state);
  await p.waitForTimeout(500);const file='host-synthetic-'+state+'-1440.png';await p.screenshot({path:path.join(out,file)});result.captures.push(file);
 }
 await p.getByRole('button',{name:'Hide sidebar',exact:true}).click();await p.waitForTimeout(250);await p.screenshot({path:path.join(out,'host-sidebar-collapsed-1440.png')});result.captures.push('host-sidebar-collapsed-1440.png');
 await p.getByRole('button',{name:'Show sidebar',exact:true}).click();await p.waitForTimeout(250);await p.screenshot({path:path.join(out,'host-sidebar-expanded-1440.png')});result.captures.push('host-sidebar-expanded-1440.png');
 await p.getByRole('button',{name:'Show right sidebar',exact:true}).click();await p.waitForTimeout(300);await p.screenshot({path:path.join(out,'host-right-sidebar-1440.png')});result.captures.push('host-right-sidebar-1440.png');
 result.syntheticStates='Harness-only draft message atom injection in real renderer, no real runtime/tool execution';
 result.version=await app.evaluate(({app})=>app.getVersion());result.status='PASS';
}catch(e){result.status='FAIL';result.failure=String(e)}finally{if(app)await app.evaluate(({app})=>app.exit(0));fs.writeFileSync(path.join(out,'host-audit.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
if(result.status!=='PASS')process.exitCode=1;
