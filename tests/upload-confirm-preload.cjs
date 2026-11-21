const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('schoolAccounts',{action:async()=>({ok:true,acknowledged:false})});
contextBridge.exposeInMainWorld('courseReport',{action:p=>ipcRenderer.invoke('mock-report',p),onSelect(){},onResult(){}});

