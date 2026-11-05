import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
const config=JSON.parse(fs.readFileSync('.artifacts/p522-host-a02-01/provider.local.json','utf8').replace(/^\uFEFF/,''));
const home=path.resolve('.artifacts/p522-host-a02-01/provider-resolution-'+Date.now());fs.mkdirSync(home,{recursive:true});
const file=path.join(home,'config.yaml');
fs.writeFileSync(file,`model:\n  default: ${JSON.stringify(config.model)}\n  provider: custom\n  base_url: ${JSON.stringify(config.base_url)}\n  api_key: ${JSON.stringify(config.api_key)}\n`);
fs.writeFileSync(path.join(home,'.env'),'');
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH)$/i;
const env={...Object.fromEntries(Object.entries(process.env).filter(([n])=>allowed.test(n))),HERMES_HOME:home,PYTHONPATH:host,PYTHONUTF8:'1'};
try{
 const code=`import json,os,sys\nfrom hermes_cli.runtime_provider import resolve_runtime_provider\nfrom hermes_cli.auth import has_usable_secret\nkey=json.load(sys.stdin)['api_key']\nrecords=[]\nfor stage in ['inline_config_only','isolated_openrouter_env']:\n if stage=='isolated_openrouter_env':os.environ['OPENROUTER_API_KEY']=key\n r=resolve_runtime_provider()\n records.append(dict(stage=stage,provider=r.get('provider'),base_url=r.get('base_url'),credentialUsable=has_usable_secret(r.get('api_key','')),credentialMatchesLocal=r.get('api_key')==key))\nprint(json.dumps(dict(records=records,modelRequests=0)))\n`;
 const r=spawnSync(path.join(host,'venv/Scripts/python.exe'),['-c',code],{env,cwd:home,input:JSON.stringify({api_key:config.api_key}),encoding:'utf8',timeout:90000,windowsHide:true});
 const text=(r.stdout+r.stderr).replaceAll(config.api_key,'[REDACTED]');
 const result={exitCode:r.status,output:text,error:r.error?.message};
 fs.writeFileSync('docs/architecture/evidence/p522-host-a02-01/continuation/provider-resolution.json',JSON.stringify(result,null,2)+'\n');
 console.log(text);if(r.status!==0)process.exitCode=1;
}finally{fs.unlinkSync(file);}
