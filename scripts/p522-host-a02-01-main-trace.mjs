import fs from 'node:fs';
const traceFile=process.env.CAREERADAPT_STARTUP_TRACE;
let key='';
if(process.env.HERMES_HOME){const text=fs.readFileSync(process.env.HERMES_HOME+'/config.yaml','utf8');const m=/^  api_key: (.+)$/m.exec(text);if(m)key=m[1].startsWith('"')?JSON.parse(m[1]):m[1];}
export function mark(kind,details={}){
 if(!traceFile)return;
 let line=JSON.stringify({at:Date.now(),kind,...details});
 if(key)line=line.replaceAll(key,'[REDACTED]');
 fs.appendFileSync(traceFile,line+'\n');
}
export function traceChild(child,command,args,cwd,env){
 const safe=Object.fromEntries(Object.entries(env).map(([k,v])=>[k,/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k)?'[REDACTED]':v]));
 mark('backend.spawn',{pid:child.pid,command,args,cwd,env:safe});
 for(const channel of ['stdout','stderr']){
  let buffer='';
  child[channel].on('data',chunk=>{const text=chunk.toString();mark('backend.data',{pid:child.pid,channel,text});buffer+=text;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n).replace(/\r$/,'');buffer=buffer.slice(n+1);if(/^HERMES_(BACKEND|DASHBOARD)_READY port=\d+$/.test(line))mark('backend.ready',{pid:child.pid,channel,line});}});
  mark('backend.listener',{pid:child.pid,channel});
 }
 child.once('exit',(code,signal)=>mark('backend.exit',{pid:child.pid,code,signal}));
 child.once('error',error=>mark('backend.error',{pid:child.pid,message:error.message}));
 const kill=child.kill.bind(child);child.kill=(...args)=>{mark('backend.kill',{pid:child.pid,args});return kill(...args);};
}
