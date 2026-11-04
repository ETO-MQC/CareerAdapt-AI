import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop'),req=createRequire(path.join(desktop,'package.json'));
const out='docs/architecture/evidence/p522-host-a01r',run=Date.now(),root=path.resolve('.artifacts/p522-host-a01-fallback-'+run),home=path.join(root,'home');fs.mkdirSync(home,{recursive:true});
fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: poc-offline\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: poc-not-a-secret\n');fs.writeFileSync(path.join(home,'.env'),'');
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v&&!/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_BASE_URL)$/.test(k)&&!k.startsWith('HERMES')&&k!=='ELECTRON_RUN_AS_NODE'));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:'HOST-A01-DEFAULT',HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5187'});
const result={status:'RUNNING',root,errors:[],consoleErrors:[],realProvider:'NOT VERIFIED',switchMethod:'Separate isolated launch without --careeradapt; no live runtime/shell hot-swap claim'};let app,page;
try{app=await _electron.launch({executablePath:req('electron'),args:[desktop,'--disable-gpu','--no-sandbox'],cwd:desktop,env,timeout:20000});page=await app.firstWindow({timeout:15000});page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});
 const later=page.getByRole('button',{name:"I'll choose a provider later",exact:true});
 await Promise.any([later.waitFor({state:'visible',timeout:20000}),page.getByRole('textbox',{name:'Message',exact:true}).click({trial:true,timeout:20000})]);
 if(await later.isVisible()){await later.click();await later.waitFor({state:'hidden',timeout:5000});result.onboarding='Native ChooseLaterLink completed';}else{result.onboarding='Native configured readiness closed overlay without picker';}
 await page.getByRole('button',{name:/^New session/}).first().waitFor({timeout:20000});await page.getByRole('textbox',{name:'Message',exact:true}).waitFor({timeout:10000});
 await page.getByRole('button',{name:/Gateway.*ready/i}).first().waitFor({timeout:15000});await page.getByRole('button',{name:/^New session/}).first().click({timeout:10000});await page.getByRole('textbox',{name:'Message',exact:true}).fill('DEFAULT-SHELL unsent verification');result.nativeNavigationAndComposer='PASS; native New session click not intercepted; unsent text entered';
 result.careerMainNavigation=await page.getByRole('navigation',{name:'CareerAdapt 主导航',exact:true}).count();result.nativeChatSurfaces=await page.locator('[data-chat-surface]').count();
 await page.screenshot({path:`${out}/default-shell-${run}.png`});
 if(result.careerMainNavigation!==0||result.nativeChatSurfaces<1||result.errors.length||result.consoleErrors.length)throw Error('Native fallback failed');result.status='PASS';
}catch(error){result.status='FAIL';result.failure=String(error.stack||error);if(page)await page.screenshot({path:`${out}/default-shell-failure-${run}.png`});process.exitCode=1;}
finally{if(app)await app.close();fs.writeFileSync(`${out}/default-shell-verification-${run}.json`,JSON.stringify(result,null,2)+'\n');fs.writeFileSync(`${out}/default-shell-verification.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
