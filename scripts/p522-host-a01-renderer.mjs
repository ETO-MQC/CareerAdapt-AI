import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
const desktop=path.join(host,'apps/desktop'),req=createRequire(path.join(desktop,'package.json'));
const {createServer,build,loadConfigFromFile}=req('vite');
const optIn=process.argv.includes('--careeradapt');
const command=process.argv.includes('--build')?'build':'serve';
const port=Number(process.argv.find(arg=>arg.startsWith('--port='))?.slice(7)??5186);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid development port');
const out=path.resolve('docs/architecture/evidence/p522-host-a01');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
if(execFileSync('git',['-C',host,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!=='eb52760564dbba2e5971fa54bd67384e281cd3b8')throw Error('Unqualified Hermes source');
const config=(await loadConfigFromFile({command,mode:'development'},path.join(desktop,'vite.config.ts'),desktop)).config;
const navigation=path.resolve('poc/host-a01/navigation').replaceAll('\\','/');
const records=[];
const fontFiles=['node_modules/@vscode/codicons/dist/codicon.ttf','node_modules/@nous-research/ui/dist/fonts/Collapse-Bold.woff2'].map(rel=>path.join(host,rel));
const fontAssets={name:'host-a01-dev-font-assets',configureServer(server){
 const assets=new Map(fontFiles.map(file=>['/@fs/'+file.replaceAll('\\','/'),file]));
 server.middlewares.use((request,response,next)=>{
  const file=assets.get(decodeURI((request.url||'').split('?')[0]));
  if(!file)return next();
  response.setHeader('Content-Type',file.endsWith('.ttf')?'font/ttf':'font/woff2');response.end(fs.readFileSync(file));
 });
}};
const integration={name:'careeradapt-host-a01-opt-in',enforce:'pre',transform(source,id){
 const original=source;
 source=source.replaceAll('\r\n','\n');
 const file=id.split('?')[0].replaceAll('\\','/');
 let patched=source;
 if(file.endsWith('/src/app/chat/sidebar/index.tsx')){
  const start=source.indexOf('        <SidebarGroup className="shrink-0 p-0 pb-2');
  const end=source.indexOf('\n\n        {showSessionSections && (',start);
  if(start<0||end<0)throw Error('Sidebar composition anchor changed');
  patched=source.slice(0,start)+'        <CareerNavigation onNavigate={item => { if (item.action === \'new-session\') $newChatProfile.set(null); onNavigate(item); }} pathname={pathname} showConversation={currentView === \'chat\'} />\n        {currentView === \'chat\' && <>'+source.slice(end);
  const close='      </SidebarContent>';
  if(patched.split(close).length!==2)throw Error('Sidebar closing anchor changed');
  patched=patched.replace(close,'        </>}\n'+close);
  patched=`import { CareerNavigation } from ${JSON.stringify(navigation)};\n`+patched;
 }else if(file.endsWith('/src/app/contrib/surfaces.tsx')){
  // Keep native ChatRoutesSurface, chatView, actions and all built-in routes.
  const anchor='    <Routes>';
  if(source.split(anchor).length!==2)throw Error('Routes composition anchor changed');
  patched=`import { CareerHome } from ${JSON.stringify(navigation)};\n`+source.replace(anchor,anchor+'\n      <Route element={page(<CareerHome onNavigate={actions.onNavigate} />)} path="careeradapt-home" />');
 }else if(file.endsWith('/src/app/contrib/controller.tsx')){
  const anchor='className="flex h-screen min-h-0 w-screen flex-col bg-(--ui-bg-chrome) text-(--ui-text-primary)"';
  if(source.split(anchor).length!==2)throw Error('Shell root anchor changed');
  patched=source.replace(anchor,anchor.replace('className="','className="ca-host-shell '));
 }else if(file.endsWith('/src/app/routes.ts')){
  const anchor="  { id: 'new', path: NEW_CHAT_ROUTE, view: 'chat' },";
  if(source.split(anchor).length!==2)throw Error('Route classification anchor changed');
  // Reserve the home path so it is never interpreted as a Session id.
  patched=source.replace(anchor,anchor+"\n  { id: 'careeradapt-home', path: '/careeradapt-home', view: 'extension' },").replace("export type AppRouteId =","export type AppRouteId =\n  | 'careeradapt-home'");
 }
 if(patched===source)return null;
 if(!records.some(r=>r.file===file)){
  const rel=path.relative(host,file).replaceAll('\\','/');
  records.push({file:rel,originalSha256:sha(original),patchedSha256:sha(patched),upstreamFileWritten:false});
  fs.mkdirSync(path.join(out,'patched',path.dirname(rel)),{recursive:true});
  fs.writeFileSync(path.join(out,'patched',rel+'.txt'),patched);
  fs.writeFileSync(path.join(out,'patch-manifest.json'),JSON.stringify({optIn,upstreamCommit:'eb52760564dbba2e5971fa54bd67384e281cd3b8',method:'Exact-anchor Vite pre-transform; upstream disk untouched',records},null,2)+'\n');
 }
 return {code:patched,map:null};
}};
const options={...config,configFile:false,root:desktop,plugins:[...(optIn?[integration]:[]),fontAssets,...config.plugins],server:{...config.server,port,fs:{allow:[...config.server.fs.allow,process.cwd()]}},build:{...config.build,outDir:path.resolve('.artifacts/p522-host-a01-renderer'),emptyOutDir:false}};
if(command==='build'){await build(options);console.log('HOST_A01_BUILD_PASS');}else{const server=await createServer(options);await server.listen();console.log('HOST_A01_READY optIn='+optIn+' http://127.0.0.1:'+port);}
