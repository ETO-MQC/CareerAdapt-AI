import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop'),req=createRequire(path.join(desktop,'package.json'));
const out='docs/architecture/evidence/p522-slice1',run=Date.now(),shots=out+'/screenshots/run-'+run,root=path.resolve('.artifacts/p522-slice1-'+run),home=path.join(root,'home'),plugin=path.join(home,'desktop-plugins/careeradapt-experience-p522');
fs.mkdirSync(plugin,{recursive:true});fs.mkdirSync(shots,{recursive:true});
fs.copyFileSync('.artifacts/p522-host-experience/production-like/plugin.js',path.join(plugin,'plugin.js'));
fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: poc-offline\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: poc-not-a-secret\n');fs.writeFileSync(path.join(home,'.env'),'');
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v&&!/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_BASE_URL)$/.test(k)&&!k.startsWith('HERMES')&&k!=='ELECTRON_RUN_AS_NODE'));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:'Slice1-'+run,HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5174'});
const evidence={status:'RUNNING',run,root,shots,errors:[],consoleErrors:[],matrix:[],interactions:[],lifecycle:[]};let app,page;
async function shot(name){await page.screenshot({path:shots+'/'+name+'.png'});}
async function ready(){await page.getByRole('tab',{name:/基本信息/}).waitFor({timeout:15000});}
async function tab(name){await page.getByRole('tab',{name:new RegExp(name)}).click({timeout:10000});}
try{
 app=await _electron.launch({executablePath:req('electron'),args:[desktop,'--disable-gpu','--no-sandbox'],cwd:desktop,env,timeout:30000});page=await app.firstWindow({timeout:20000});
 page.on('pageerror',e=>evidence.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')evidence.consoleErrors.push(m.text());});
 await page.getByText('CareerAdapt',{exact:true}).first().click({timeout:45000});await ready();
 if(!process.env.P522_SYSTEM_ONLY){
 if(await page.getByRole('tab').count()!==19)throw Error('Missing categories');
 for(const size of [{width:1920,height:1080},{width:1440,height:900},{width:1024,height:768}]){
  await page.setViewportSize(size);
  for(const mode of ['light','dark']){
   if(await page.evaluate(()=>document.documentElement.dataset.hermesMode)!==mode)await page.keyboard.press('Shift+X');
   await page.waitForFunction(m=>document.documentElement.dataset.hermesMode===m,mode);
   await tab('基本信息');await page.locator('.ca-experience').evaluate(el=>{el.scrollTop=0;});
   const geometry=await page.locator('.ca-experience').evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {right:r.right,width:r.width,viewport:innerWidth,overflow:el.scrollWidth>el.clientWidth,background:s.backgroundColor,text:s.color,action:s.getPropertyValue('--ca-action').trim(),minFont:Math.min(...Array.from(el.querySelectorAll('p,span,small,time,button,dt,dd')).map(e=>parseFloat(getComputedStyle(e).fontSize)))};});
   if(geometry.overflow||geometry.right>size.width+1||geometry.minFont<11)throw Error('Geometry '+JSON.stringify(geometry));
   await shot(`profile-${mode}-${size.width}`);await tab('项目经历');
   await page.getByRole('button',{name:/虚构灯塔信息导航/}).click();
   await page.getByRole('region',{name:'资料详情'}).getByText('项目背景',{exact:true}).waitFor();
   await page.locator('.ca-experience').evaluate(el=>{el.scrollTop=0;});await shot(`project-${mode}-${size.width}`);
   evidence.matrix.push({size,mode,geometry,projectDetails:'PASS'});
  }
 }
 await page.setViewportSize({width:1440,height:900});
 for(const name of ['教育经历','工作经历','实习经历','奖项荣誉','专业技能','证书','语言能力','科研经历','自我评价']){await tab(name);await shot('category-'+name);}
 evidence.interactions.push('19 categories rendered; education/work/internship/award/skill/certificate/language/empty inspected');
 await tab('项目经历');await page.getByLabel('搜索资料',{exact:true}).fill('不存在的搜索');await page.getByText('当前筛选下没有条目',{exact:true}).waitFor();
 if(await page.locator('.ca-detail-scroll').innerText()!=='请选择一个条目\n\n切换分类，在左侧列表选择条目。')throw Error('Stale detail');
 await page.getByLabel('搜索资料',{exact:true}).fill('');await page.getByLabel('使用状态',{exact:true}).selectOption('archived');await page.getByRole('heading',{name:'虚构归档项目（合成）',exact:true}).waitFor();await shot('archived');
 await page.getByLabel('使用状态',{exact:true}).selectOption('unused');await page.getByRole('button',{name:/虚构灯塔信息导航/}).waitFor();
 await page.getByLabel('使用状态',{exact:true}).selectOption('used');await page.getByRole('button',{name:/AI 求职应用课程项目/}).waitFor();
 evidence.interactions.push('search empty clears details; archived/unused/used filters PASS');
 await tab('基本信息');const first=page.getByRole('tab',{name:/基本信息/});await first.focus();await page.keyboard.press('ArrowRight');
 if(await page.getByRole('tab',{name:/自我评价/}).getAttribute('aria-selected')!=='true')throw Error('Tab keyboard');
 await page.keyboard.press('End');await page.keyboard.press('Home');
 await page.getByLabel('详情内容',{exact:true}).focus();const focus=await page.locator('.ca-detail-scroll').evaluate(el=>({focused:el===document.activeElement,outline:getComputedStyle(el).outlineStyle}));if(!focus.focused||focus.outline==='none')throw Error('Focus');evidence.focus=focus;
 for(const state of ['loading','empty','error','invalid','success']){await page.getByLabel('验证场景',{exact:true}).selectOption(state);if(state==='success')await ready();else await page.locator('.ca-state').waitFor();await shot('state-'+state);}
 evidence.interactions.push('Loading/Empty/Error/Invalid/Success; roving tab focus and detail focus PASS');
 await page.getByRole('button',{name:'重新加载合成资料',exact:true}).click();await ready();await page.reload();await ready();
 await page.evaluate(()=>{location.hash='/';});await page.locator('.ca-experience').waitFor({state:'detached'});if(await page.locator('style[data-careeradapt-experience]').count())throw Error('CSS route residue');
 await page.getByText('CareerAdapt',{exact:true}).first().click();await ready();evidence.interactions.push('reload/page refresh/native route exit/re-entry PASS');
 for(let i=0;i<2;i++){
  await page.evaluate(async()=>{await(await import('/src/contrib/plugins-store.ts')).setPluginEnabled('careeradapt-experience-p522',false);});await page.locator('.ca-experience').waitFor({state:'detached'});if(await page.locator('style[data-careeradapt-experience]').count())throw Error('Disable CSS residue');
  await page.evaluate(async()=>{await(await import('/src/contrib/plugins-store.ts')).setPluginEnabled('careeradapt-experience-p522',true);});await page.getByText('CareerAdapt',{exact:true}).first().click();await ready();
  const version=await page.evaluate(async()=>(await import('/src/contrib/registry.ts')).$registryVersion.get());fs.appendFileSync(path.join(plugin,'plugin.js'),'\n// slice1 hot reload '+i+'\n');
  await page.waitForFunction(async v=>(await import('/src/contrib/registry.ts')).$registryVersion.get()>v,version,{timeout:15000});await ready();
  const styles=await page.locator('style[data-careeradapt-experience]').count();if(styles!==1)throw Error('Hot reload CSS duplicate');
  evidence.lifecycle.push({cycle:i,disabledStyles:0,enabledAndReloadedStyles:styles});
 }
 }
 await page.evaluate(()=>{location.hash='/settings';});await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByRole('button',{name:'System',exact:true}).click();await page.evaluate(()=>{location.hash='/careeradapt-experience';});await ready();
 evidence.system=[];
 for(const colorScheme of ['dark','light']){await page.emulateMedia({colorScheme});await page.waitForFunction(m=>document.documentElement.dataset.hermesMode===m,colorScheme);await page.waitForFunction(scheme=>getComputedStyle(document.querySelector('.ca-experience .product-input')).backgroundColor===(scheme==='dark'?'rgb(26, 33, 36)':'rgb(255, 255, 255)'),colorScheme,{timeout:5000});evidence.system.push(await page.locator('.ca-experience').evaluate(el=>({controlBackground:getComputedStyle(el.querySelector('.product-input')).backgroundColor,mode:document.documentElement.dataset.hermesMode,background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el).color})));await shot('system-'+colorScheme);}
 if(evidence.errors.length||evidence.consoleErrors.length)throw Error('Renderer errors');evidence.status='PASS';
}catch(error){evidence.status='FAIL';evidence.failure=String(error.stack||error);if(page)await shot('failure');process.exitCode=1;}
finally{if(app)await app.close();fs.writeFileSync(out+'/host-smoke-'+run+'.json',JSON.stringify(evidence,null,2)+'\n');fs.writeFileSync(out+(process.env.P522_SYSTEM_ONLY?'/system-theme-verification.json':'/interaction-verification.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,failure:evidence.failure,matrix:evidence.matrix,errors:evidence.errors,consoleErrors:evidence.consoleErrors,shots}));}
