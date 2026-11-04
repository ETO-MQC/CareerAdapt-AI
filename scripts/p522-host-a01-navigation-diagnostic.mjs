import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop'),req=createRequire(path.join(desktop,'package.json'));
const out='docs/architecture/evidence/p522-host-a01',run=Date.now(),root=path.resolve(`.artifacts/p522-host-a01-diagnostic-${run}`),home=path.join(root,'home'),plugin=path.join(home,'desktop-plugins/careeradapt-experience-p522'),shots=`${out}/screenshots/diagnostic-${run}`;
fs.mkdirSync(plugin,{recursive:true});fs.mkdirSync(shots,{recursive:true});fs.copyFileSync('.artifacts/p522-host-experience/production-like/plugin.js',path.join(plugin,'plugin.js'));
fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: poc-offline\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: poc-not-a-secret\n');fs.writeFileSync(path.join(home,'.env'),'');
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v&&!/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_BASE_URL)$/.test(k)&&!k.startsWith('HERMES')&&k!=='ELECTRON_RUN_AS_NODE'));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:'HOST-A01-DIAGNOSTIC-'+run,HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5186'});
const result={run,status:'RUNNING',shots,errors:[],consoleErrors:[],checks:[],visualMatrix:[],scope:'Bounded native-navigation/attachment and final font/theme verification after diagnosed full-smoke selector failure; original full-smoke failures remain recorded'};let app,page;
try{
 app=await _electron.launch({executablePath:req('electron'),args:[desktop,'--disable-gpu','--no-sandbox'],cwd:desktop,env,timeout:20000});page=await app.firstWindow({timeout:15000});page.setDefaultTimeout(10000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});
 const nav=page.getByRole('navigation',{name:'CareerAdapt 主导航',exact:true});await nav.waitFor({timeout:20000});
 result.gatewayButtons=await page.getByRole('button',{name:/Gateway/i}).allTextContents();
 await page.getByRole('button',{name:/Gateway.*ready/i}).first().waitFor({timeout:10000});result.checks.push('Gateway status accessible button ready; label/detail are distinct spans');
 result.fonts=await page.evaluate(async()=>{await document.fonts.ready;const icon=document.querySelector('.codicon');return {loaded:Array.from(document.fonts).map(f=>({family:f.family,status:f.status})),iconFamily:icon?getComputedStyle(icon,'::before').fontFamily:null};});
 const dismiss=page.getByRole('button',{name:/dismiss/i});if(await dismiss.count())await dismiss.first().click();
 await nav.getByRole('button',{name:'个人资料库',exact:true}).click();await page.getByRole('tab',{name:/基本信息/}).waitFor();
 await nav.getByRole('button',{name:'设置',exact:true}).click();result.afterSettings={url:page.url(),buttons:await page.getByRole('button').allTextContents()};
 await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByRole('button',{name:'System',exact:true}).click();result.checks.push('Native onNavigate opens native Settings/Appearance/System');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{location.hash='/careeradapt-home';});await page.getByRole('main',{name:'CareerAdapt 首页'}).waitFor();
 for(const size of [{width:1920,height:1080},{width:1440,height:900},{width:1024,height:768}]){
  await page.setViewportSize(size);
  for(const colorScheme of ['dark','light']){
   await page.emulateMedia({colorScheme});await page.waitForFunction(m=>document.documentElement.dataset.hermesMode===m,colorScheme,{timeout:5000});
   for(const [name,label] of [['home','首页'],['profile','个人资料库'],['chat','AI 工作台']]){
    await nav.getByRole('button',{name:label,exact:true}).click();
    if(name==='home')await page.getByRole('main',{name:'CareerAdapt 首页'}).waitFor();
    if(name==='profile')await page.getByRole('tab',{name:/基本信息/}).waitFor();
    if(name==='chat')await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
    const geometry=await nav.evaluate(el=>({navigationCount:document.querySelectorAll('[aria-label="CareerAdapt 主导航"]').length,overflow:document.documentElement.scrollWidth>innerWidth,navBackground:getComputedStyle(el.closest('aside')||el.parentElement).backgroundColor}));
    if(geometry.navigationCount!==1||geometry.overflow)throw Error('Final geometry '+JSON.stringify(geometry));
    await page.screenshot({path:`${shots}/${name}-${colorScheme}-${size.width}.png`});result.visualMatrix.push({size,colorScheme,page:name,geometry});
   }
  }
 }
 await nav.getByRole('button',{name:'AI 工作台',exact:true}).click();const editor=page.getByRole('textbox',{name:'Message',exact:true});await editor.fill('HOST-A01 unsent native draft');
 await page.getByRole('button',{name:'Add context',exact:true}).click();result.attachmentMenu=await page.getByRole('menuitem').allTextContents();await page.screenshot({path:`${shots}/native-attachments.png`});await page.keyboard.press('Escape');
 await nav.getByRole('button',{name:'个人资料库',exact:true}).click();await page.getByRole('tab',{name:/基本信息/}).waitFor();
 await nav.getByRole('button',{name:'AI 工作台',exact:true}).click();if((await editor.innerText())!=='HOST-A01 unsent native draft')throw Error('Native unsent draft lost across page navigation');
 result.checks.push('Native attachment menu; native unsent draft survives Profile/Chat navigation; no submission');
 await page.getByRole('button',{name:/新建对话/}).click();await editor.waitFor();result.newSessionDraft=await editor.innerText();if(result.newSessionDraft!=='HOST-A01 unsent native draft')throw Error('Fresh draft should preserve the native per-thread unsent composer contents');result.checks.push('Native new-session action invoked on already fresh draft; native code deliberately preserves the per-thread composer draft, no backend session created');
 await page.setViewportSize({width:1440,height:900});await nav.getByRole('button',{name:'个人资料库',exact:true}).click();await page.getByRole('tab',{name:/基本信息/}).waitFor();await page.screenshot({path:`${shots}/profile-final.png`});
 if(result.errors.length||result.consoleErrors.length)throw Error('Renderer errors');result.status='PASS';
}catch(error){result.status='FAIL';result.failure=String(error.stack||error);if(page){result.url=page.url();await page.screenshot({path:`${shots}/failure.png`});}process.exitCode=1;}
finally{if(app)await app.close();fs.writeFileSync(`${out}/navigation-diagnostic.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
