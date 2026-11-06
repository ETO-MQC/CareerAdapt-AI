/* global contextBridge, ipcRenderer */
// Fixed D3-only interface. Main validates the sender and every payload again.
if (process.env.CAREERADAPT_D3 === '1') contextBridge.exposeInMainWorld('careerD3', {
 attach:()=>ipcRenderer.invoke('careeradapt:d3:attach'),
 contextChanged:()=>ipcRenderer.invoke('careeradapt:d3:context-changed'),
 started:requestId=>{if(typeof requestId!=='string'||requestId.length>160)return Promise.reject(Error('INVALID_REQUEST'));return ipcRenderer.invoke('careeradapt:d3:started',requestId);},
 lifecycle:enabled=>{if(typeof enabled!=='boolean')return Promise.reject(Error('INVALID_REQUEST'));return ipcRenderer.invoke('careeradapt:d3:lifecycle',enabled);},
 verify:requestId=>{if(typeof requestId!=='string'||requestId.length>160)return Promise.reject(Error('INVALID_REQUEST'));return ipcRenderer.invoke('careeradapt:d3:verify',requestId);},
 complete:payload=>{if(!payload||typeof payload!=='object'||Object.keys(payload).some(k=>!['requestId','result'].includes(k))||typeof payload.requestId!=='string'||payload.requestId.length>160||!payload.result||typeof payload.result.ok!=='boolean'||JSON.stringify(payload).length>280000)return Promise.reject(Error('INVALID_REQUEST'));return ipcRenderer.invoke('careeradapt:d3:complete',payload);},
 onRead:callback=>{if(typeof callback!=='function')throw Error('INVALID_REQUEST');const listener=(_event,payload)=>callback(payload);ipcRenderer.on('careeradapt:d3:read',listener);return ()=>ipcRenderer.removeListener('careeradapt:d3:read',listener);}
});
