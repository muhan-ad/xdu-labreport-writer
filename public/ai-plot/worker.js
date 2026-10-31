/* Runs inside an opaque sandboxed frame's Worker with connect-src 'none'. */
(() => {
  const nativeImportScripts=self.importScripts.bind(self);
  let started=false;
  self.onmessage=async({data})=>{
    if(started)return;started=true;
    const resources=data.resources,job=data.job,base='https://lab-maker.invalid/';
    const progress=text=>self.postMessage({type:'progress',text});
    const resourceName=url=>{
      const value=new URL(typeof url==='string'?url:url.url??String(url),base);
      if(value.origin!=='https://lab-maker.invalid'||value.search||value.hash)throw Error('绘图进程禁止联网');
      const name=value.pathname.slice(1);
      if(!Object.hasOwn(resources,name)||!(resources[name] instanceof ArrayBuffer))throw Error('未提供的离线绘图资源：'+name);
      return name;
    };
    Object.defineProperty(self,'fetch',{configurable:false,writable:false,value:async(url)=>{
      const name=resourceName(url);
      return new Response(resources[name],{headers:{'Content-Type':name.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});
    }});
    Object.defineProperty(self,'importScripts',{configurable:false,writable:false,value:(...urls)=>{
      for(const url of urls){const name=resourceName(url);if(!name.endsWith('.js'))throw Error('绘图脚本格式无效');
        const blob=URL.createObjectURL(new Blob([resources[name]],{type:'text/javascript'}));
        try{nativeImportScripts(blob);}finally{URL.revokeObjectURL(blob);}
      }
    }});
    // CSP is the network boundary; these removals also make accidental calls fail early.
    for(const name of ['XMLHttpRequest','WebSocket','EventSource','WebTransport','Worker','SharedWorker']){
      try{Object.defineProperty(self,name,{value:undefined,writable:false,configurable:false});}catch{}
    }
    try{
      progress('正在准备独立绘图引擎…');
      importScripts(base+'pyodide.js');
      const py=await loadPyodide({indexURL:base,stdout:()=>{},stderr:()=>{}});
      const extra=['scipy','pandas'].filter(name=>new RegExp('\\b'+name+'\\b').test(job.code));
      await py.loadPackage(['numpy','matplotlib','pillow',...extra]);
      py.FS.mkdirTree('/plot');
      py.FS.writeFile('/plot/ai_plot.py',new Uint8Array(resources['ai_plot.py']));
      py.FS.writeFile('/plot/LabMakerSansSC.ttf',new Uint8Array(resources['LabMakerSansSC.ttf']));
      py.globals.set('plot_job',JSON.stringify(job));
      progress('正在按当前数据绘图…');
      const raw=await py.runPythonAsync(`
import sys, json
sys.path.insert(0, '/plot')
import matplotlib
matplotlib.use('Agg')
from matplotlib import font_manager
font_manager.fontManager.ttflist.append(font_manager.FontEntry(fname='/plot/LabMakerSansSC.ttf',name='Lab Maker SC',weight=400))
from ai_plot import render
request=json.loads(plot_job)
result=render(request['code'], request['data'], '/plot/output')
json.dumps(result['images'],ensure_ascii=False)
`);
      const images=JSON.parse(raw).map(result=>({caption:result.name,bytes:py.FS.readFile(result.path).slice().buffer}));
      self.postMessage({type:'result',images},images.map(image=>image.bytes));
    }catch(error){self.postMessage({type:'error',message:String(error.message||error).slice(-1500)});}
  };
})();
