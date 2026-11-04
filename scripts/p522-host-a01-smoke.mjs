import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop'),req=createRequire(path.join(desktop,'package.json'));
const out='docs/architecture/evidence/p522-host-a01',run=Date.now(),shots=`${out}/screenshots/${run}`,root=path.resolve(`.artifacts/p522-host-a01-${run}`),home=path.join(root,'home'),plugin=path.join(home,'desktop-plugins/careeradapt-experience-p522');
fs.mkdirSync(plugin,{recursive:true});fs.mkdirSync(shots,{recursive:true});
fs.copyFileSync('.artifacts/p522-host-experience/production-like/plugin.js',path.join(plugin,'plugin.js'));
fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: poc-offline\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: poc-not-a-secret\n');fs.writeFileSync(path.join(home,'.env'),'');
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v&&!/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_BASE_URL)$/.test(k)&&!k.startsWith('HERMES')&&k!=='ELECTRON_RUN_AS_NODE'));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:'HOST-A01-'+run,HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5186'});
const result={status:'RUNNING',run,root,shots,errors:[],consoleErrors:[],matrix:[],checks:[],realProvider:'NOT VERIFIED; offline isolated provider; no real credentials'};
let app,page;
const shot=name=>page.screenshot({path:`${shots}/${name}.png`});
const nav=()=>page.getByRole('navigation',{name:'CareerAdapt 主导航',exact:true});
const profileReady=()=>page.getByRole('tab',{name:/基本信息/}).waitFor({timeout:15000});
try{
 app=await _electron.launch({executablePath:req('electron'),args:[desktop,'--disable-gpu','--no-sandbox'],cwd:desktop,env,timeout:30000});page=await app.firstWindow({timeout:20000});
 page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});
 await nav().waitFor({timeout:45000});await shot('initial');
 await page.getByText(/Gateway ready/).first().waitFor({timeout:45000});
 const dismiss=page.getByRole('button',{name:/dismiss notification/i});if(await dismiss.count())await dismiss.first().click();
 if(await nav().count()!==1)throw Error('Duplicate product navigation');
 await nav().getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('main',{name:'CareerAdapt 首页'}).waitFor();await shot('home-before');
 await nav().getByRole('button',{name:'AI 工作台',exact:true}).click();
 result.chatInventory=await page.locator('textarea,[contenteditable=true],input[type=file],button').evaluateAll(els=>els.map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),placeholder:e.getAttribute('placeholder'),text:e.tagName==='BUTTON'?e.textContent?.slice(0,100):undefined})).filter(e=>e.tag!=='BUTTON'||/attach|file|image|stop|cancel|附件|文件|上传/i.test((e.label||'')+(e.text||''))));
 await shot('native-chat');
 const editor=page.locator('textarea,[contenteditable=true]').first();await editor.waitFor({timeout:15000});
 await page.getByRole('button',{name:'Add context',exact:true}).click();await page.getByRole('menuitem',{name:/files/i}).first().waitFor();await shot('native-attachment-menu');await page.keyboard.press('Escape');result.checks.push('Native attachment menu Files/Images reachable; no file selected/uploaded');
 await editor.fill('HOST-A01 isolated unsent draft');
 await nav().getByRole('button',{name:'个人资料库',exact:true}).click();await profileReady();
 if(await page.getByRole('tab').count()!==19)throw Error('Incomplete Profile categories');
 if(await page.locator('.ca-host-conversation-heading').count()!==0)throw Error('Chat context leaked into Profile');
 await page.getByRole('tab',{name:/项目经历/}).click();await page.getByRole('button',{name:/虚构灯塔信息导航/}).click();await page.getByRole('region',{name:'资料详情'}).getByText('项目背景',{exact:true}).waitFor();
 await page.getByLabel('搜索资料',{exact:true}).fill('不存在的搜索');await page.getByText('当前筛选下没有条目',{exact:true}).waitFor();await page.getByLabel('搜索资料',{exact:true}).fill('');
 await page.getByLabel('使用状态',{exact:true}).selectOption('archived');await page.getByRole('heading',{name:'虚构归档项目（合成）',exact:true}).waitFor();await page.getByLabel('使用状态',{exact:true}).selectOption('all');
 result.checks.push('19 categories; project selection/details; search; archived filter; synthetic read-only marker');
 for(const size of [{width:1920,height:1080},{width:1440,height:900},{width:1024,height:768}]){
  await page.setViewportSize(size);
  for(const mode of ['light','dark']){
   await nav().getByRole('button',{name:'首页',exact:true}).focus();
   if(await page.evaluate(()=>document.documentElement.dataset.hermesMode)!==mode)await page.keyboard.press('Shift+X');
   await page.waitForFunction(m=>document.documentElement.dataset.hermesMode===m,mode);
   await nav().getByRole('button',{name:'个人资料库',exact:true}).click();await profileReady();await page.getByRole('tab',{name:/基本信息/}).click();
   await shot(`profile-${mode}-${size.width}`);
   await nav().getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('main',{name:'CareerAdapt 首页'}).waitFor();await shot(`home-${mode}-${size.width}`);
   await nav().getByRole('button',{name:'AI 工作台',exact:true}).click();await editor.waitFor();await shot(`chat-${mode}-${size.width}`);
   const geometry=await nav().evaluate(el=>({navigationCount:document.querySelectorAll('[aria-label="CareerAdapt 主导航"]').length,width:el.getBoundingClientRect().width,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}));
   if(geometry.navigationCount!==1||geometry.overflow)throw Error('Shell geometry '+JSON.stringify(geometry));
   result.matrix.push({size,mode,geometry});
  }
 }
 await nav().getByRole('button',{name:'个人资料库',exact:true}).click();await profileReady();await page.reload();await page.getByText(/Gateway ready/).first().waitFor({timeout:45000});await nav().getByRole('button',{name:'个人资料库',exact:true}).click();await profileReady();result.checks.push('Profile refresh; gateway-ready UI before further navigation');
 await nav().getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByRole('button',{name:'System',exact:true}).click();
 await page.evaluate(()=>{location.hash='/careeradapt-home';});await page.getByRole('main',{name:'CareerAdapt 首页'}).waitFor();
 result.system=[];
 for(const colorScheme of ['dark','light']){await page.emulateMedia({colorScheme});await page.waitForFunction(m=>document.documentElement.dataset.hermesMode===m,colorScheme);await shot('system-'+colorScheme);result.system.push(colorScheme);}
 await nav().getByRole('button',{name:'AI 工作台',exact:true}).click();await page.getByText('AI 能力与高级管理',{exact:true}).click();await page.getByRole('navigation',{name:'AI 能力与高级管理',exact:true}).getByRole('button',{name:'能力 / Skills',exact:true}).click();await shot('native-skills');
 result.checks.push('Native settings and System mode; native Skills route reachable; native chat draft entered without submission');
 if(result.errors.length||result.consoleErrors.length)throw Error('Renderer errors');result.status='PASS';
}catch(error){result.status='FAIL';result.failure=String(error.stack||error);if(page)await shot('failure');process.exitCode=1;}
finally{if(app)await app.close();fs.writeFileSync(`${out}/host-smoke-${run}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
