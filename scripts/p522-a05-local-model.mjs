import http from 'node:http';
// Deterministic protocol driver, not a language model or Provider qualification.
export async function startD3Model(){
 const requests=[],controls={beforeToolMs:0,afterToolMs:0},events=[];
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({object:'list',data:[{id:'d3-local',object:'model',owned_by:'qualification'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  try{
   const body=JSON.parse(raw),messages=body.messages||[],lastUser=[...messages].reverse().find(m=>m.role==='user'),tag=JSON.stringify(lastUser?.content||''),lastTool=messages.at(-1)?.role==='tool'?messages.at(-1):null;
   const entry={at:Date.now(),model:body.model,stream:body.stream,messages,tools:body.tools,tag};requests.push(entry);
   const callId='d3call_'+requests.length;
   const errorMode=tag.includes('search-miss');
   const tool=errorMode?'career.profile.search_facts':'career.profile.get';
   const args=errorMode?{query:'D3_NO_SUCH_KEYWORD',sectionTypes:['project']}:{sectionTypes:['project'],limit:20};
   let text='';
   if(lastTool){
    let result;try{result=JSON.parse(lastTool.content);}catch{result={ok:false,error:{code:'MALFORMED_TOOL_RESULT'}};}
    text=result.ok?`Tool source ${lastTool.tool_call_id}: ${JSON.stringify(result.data)}`:`Tool did not provide Profile facts: ${JSON.stringify(result.error)}. No successful read is claimed.`;
   }
   const completion={id:'d3-local-'+requests.length,object:'chat.completion',created:Math.floor(Date.now()/1000),model:'d3-local',choices:[{index:0,message:lastTool?{role:'assistant',content:text}:{role:'assistant',content:null,tool_calls:[{id:callId,type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]},finish_reason:lastTool?'stop':'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}};
   if(!body.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(completion));return;}
   res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.flushHeaders();
   const emit=delta=>{if(!res.destroyed)res.write('data: '+JSON.stringify({id:completion.id,object:'chat.completion.chunk',created:completion.created,model:'d3-local',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');};
   emit({role:'assistant'});
   if(lastTool){
    if(controls.afterToolMs){events.push({event:'after-tool-hold',at:Date.now(),tag});await wait(controls.afterToolMs);}
    for(let i=0;i<text.length;i+=36){if(res.destroyed)break;emit({content:text.slice(i,i+36)});await wait(15);}
   }else{
    if(controls.beforeToolMs){events.push({event:'before-tool-hold',at:Date.now(),tag});for(let i=0;i<controls.beforeToolMs/100;i++){if(res.destroyed)break;emit({content:i===0?'Preparing a scoped read. ':''});await wait(100);}}
    const encoded=JSON.stringify(args),middle=Math.floor(encoded.length/2);
    emit({tool_calls:[{index:0,id:callId,type:'function',function:{name:tool,arguments:encoded.slice(0,middle)}}]});await wait(25);
    emit({tool_calls:[{index:0,function:{arguments:encoded.slice(middle)}}]});
   }
   if(!res.destroyed){res.write('data: '+JSON.stringify({id:completion.id,object:'chat.completion.chunk',created:completion.created,model:'d3-local',choices:[{index:0,delta:{},finish_reason:lastTool?'stop':'tool_calls'}]})+'\n\ndata: [DONE]\n\n');res.end();}
  }catch(error){if(!res.headersSent)res.statusCode=500;res.end(JSON.stringify({error:{message:error.message}}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {server,url:`http://127.0.0.1:${server.address().port}/v1`,requests,events,controls,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
