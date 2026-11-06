import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop'),ts=createRequire(path.join(desktop,'package.json'))('typescript');
const out='docs/architecture/evidence/p522-a05-native-career/implementation',patches=new Map();
const manifest=JSON.parse(fs.readFileSync(out+'/renderer-build/patch-manifest.json','utf8'));
for(const r of manifest.records)patches.set(path.resolve(host,r.file).toLowerCase(),fs.readFileSync(path.join(out,'renderer-build/patched',r.file+'.txt'),'utf8'));
for(const r of JSON.parse(fs.readFileSync(out+'/patches.json','utf8')))patches.set(path.resolve(host,r.file).toLowerCase(),fs.readFileSync(path.join(out,'patched',r.file+'.txt'),'utf8'));
const result={};
for(const [area,filename] of [['renderer','tsconfig.json'],['mainPreload','tsconfig.electron.json']]){
 if(process.argv.includes('--main-only')&&area!=='mainPreload')continue;
 const config=ts.readConfigFile(path.join(desktop,filename),ts.sys.readFile),parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,desktop,{noEmit:true,incremental:false,composite:false});
 const run=overlay=>{
  const compiler=ts.createCompilerHost(parsed.options),read=compiler.readFile;
  compiler.readFile=file=>overlay&&patches.has(path.resolve(file).toLowerCase())?patches.get(path.resolve(file).toLowerCase()):read(file);
  compiler.resolveModuleNames=(names,containing)=>names.map(name=>ts.resolveModuleName(name==='virtual:careeradapt-host/navigation'?path.resolve('poc/host-a01/navigation'):name,containing,parsed.options,compiler).resolvedModule);
  return ts.getPreEmitDiagnostics(ts.createProgram({rootNames:parsed.fileNames,options:parsed.options,host:compiler})).map(d=>({file:d.file?.fileName,code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n')}));
 };
 const baseline=run(false),integrated=run(true),ids=new Set(baseline.map(d=>JSON.stringify(d))),introduced=integrated.filter(d=>!ids.has(JSON.stringify(d)));
 result[area]={baseline,integrated,introduced};if(introduced.length)process.exitCode=1;
}
fs.writeFileSync(out+(process.argv.includes('--main-only')?'/native-typecheck-main-final.json':'/native-typecheck.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,{baseline:v.baseline.length,integrated:v.integrated.length,introduced:v.introduced}]))));
