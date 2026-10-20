'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('courseWindow',Object.freeze({
 control:action=>ipcRenderer.invoke('course-window',{action}),
 openSystem:id=>ipcRenderer.invoke('course-open-system',id),
 onResume:callback=>{if(typeof callback==='function')ipcRenderer.on('course-resume',()=>callback());},
 onStartupError:callback=>{if(typeof callback==='function')ipcRenderer.on('course-startup-error',(_e,result)=>callback(result));}
}));
contextBridge.exposeInMainWorld('courseLogin',Object.freeze({fillSaved:options=>ipcRenderer.invoke('course-fill-saved-login',{silent:options?.silent===true})}));

contextBridge.exposeInMainWorld('courseReport',Object.freeze({
 action:payload=>ipcRenderer.invoke('course-report-view',payload),
 onSelect:callback=>{if(typeof callback==='function')ipcRenderer.on('course-report-select',()=>callback());}
}));

contextBridge.exposeInMainWorld('schoolAccounts',Object.freeze({action:payload=>ipcRenderer.invoke('course-school-accounts',payload)}));
