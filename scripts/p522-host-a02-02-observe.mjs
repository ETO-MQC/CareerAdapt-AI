export function createObservedSend({send,page,result,snap,save,shot,assert}) {
const originalSend=send;
return async(label,text,options)=>{
 if(label==='tool-echo')await page.evaluate(()=>{window.__a02ToolUi=[];window.__a02ToolObserver=new MutationObserver(()=>{const body=document.body.innerText;if(body.includes('a02_qualification'))window.__a02ToolUi.push({at:Date.now(),body});});window.__a02ToolObserver.observe(document.body,{childList:true,subtree:true,characterData:true});});
 await originalSend(label,text,options);
 if(label==='tool-echo'){
  result.toolUiSamples=await page.evaluate(()=>{window.__a02ToolObserver.disconnect();return window.__a02ToolUi;});
  result.echoUi=await page.locator('body').innerText();
  result.echoUrl=page.url();
  result.echoSnapshot=await snap();
  save('tool-ui-observed',{samples:result.toolUiSamples,body:result.echoUi});
 }
 if(label==='tool-failure'){
  const originalUrl=result.echoUrl;
  const originalSession=result.echoSnapshot.sessionId;
  await page.getByRole('button',{name:'＋ 新建对话',exact:true}).click();
  await originalSend('history-other','Do not call tools. Reply exactly A02-OTHER-SESSION.');
  const other=await snap();assert.notEqual(other.sessionId,originalSession,'Session switch did not isolate');
  const beforeEvents=result.events.length;
  // Native renderer navigation to its already observed hash route; no store mutation.
  await page.goto(originalUrl);
  await page.waitForFunction(async()=>{const s=await import('/src/store/session.ts');return s.$messages.get().some(m=>JSON.stringify(m).includes('fixed-v1'));},null,{timeout:60000});
  const returned=await snap();await shot('history-return');
  await page.reload();
  await page.getByRole('textbox',{name:'Message',exact:true}).waitFor({timeout:60000});
  await page.waitForFunction(async()=>{const s=await import('/src/store/session.ts');return s.$messages.get().some(m=>JSON.stringify(m).includes('fixed-v1'));},null,{timeout:60000});
  const refreshed=await snap();await new Promise(r=>setTimeout(r,10000));
  const historyEvents=result.events.slice(beforeEvents);assert.equal(historyEvents.filter(e=>e.type==='tool.start').length,0,'History reexecuted tool');
  result.history={originalSession,otherSession:other.sessionId,returned,refreshed,events:historyEvents,body:await page.locator('body').innerText()};save('history-observed',result.history);await shot('history-refreshed');
 }
};
}
