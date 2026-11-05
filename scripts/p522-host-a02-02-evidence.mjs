import path from 'node:path';
export function sanitize(value,secrets=[]){
 if(Array.isArray(value))return value.map(v=>sanitize(v,secrets));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/^headers$|authorization|cookie/i.test(k)).map(([k,v])=>[k,/api_key/i.test(k)?'[REDACTED]':sanitize(v,secrets)]));
 if(typeof value!=='string')return value;
 let s=value;for(const secret of secrets.filter(Boolean))s=s.replaceAll(secret,'[REDACTED]');
 const replacements=[[path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),'[HERMES_ROOT]'],[process.cwd(),'[PROJECT]'],[process.env.USERPROFILE,'[USER]'],['E:/DEF','[WORKSPACE_PARENT]'],['E:\\DEF','[WORKSPACE_PARENT]']];
 for(const [from,to] of replacements){for(const variant of new Set([from,from.replaceAll('\\','/'),from.replaceAll('\\','\\\\'),from.replaceAll('\\','\\\\\\\\')]))s=s.replaceAll(variant,to);}
 return s.replace(/[A-Za-z]:(?:\\+|\/)Users(?:\\+|\/)[^\\/\s"]+/g,'[USER]');
}
