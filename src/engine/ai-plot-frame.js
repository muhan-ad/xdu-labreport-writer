// Trusted relay only. Model code runs in its child Worker, never in this document.
(() => {
  let worker,port,started=false;
  const fail=message=>port?.postMessage({type:'error',message:String(message).slice(0,1500)});
  window.addEventListener('message',event=>{
    if(started||event.source!==parent||event.data?.type!=='start-ai-plot'||event.ports.length!==1)return;
    started=true;port=event.ports[0];
    try{
      const {script,resources,job}=event.data;
      if(typeof script!=='string'||script.length>100000||!resources||typeof resources!=='object')throw Error('绘图任务无效');
      const url=URL.createObjectURL(new Blob([script],{type:'text/javascript'}));
      try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
      worker.onmessage=({data})=>{
        if(data?.type==='progress'&&typeof data.text==='string')port.postMessage({type:'progress',text:data.text.slice(0,200)});
        else if(data?.type==='result'){
          const images=data.images;
          if(!Array.isArray(images)||!images.length||images.length>8||images.some(i=>!(i?.bytes instanceof ArrayBuffer)||i.bytes.byteLength>8*1024*1024||typeof i.caption!=='string'||!i.caption.trim()||i.caption.length>200)||images.reduce((n,i)=>n+i.bytes.byteLength,0)>32*1024*1024){fail('绘图返回图组无效');worker.terminate();return;}
          port.postMessage({type:'result',images},images.map(i=>i.bytes));worker.terminate();
        }else if(data?.type==='error'){fail(data.message);worker.terminate();}
      };
      worker.onerror=event=>{fail(event.message||'独立绘图进程失败');worker.terminate();};
      port.onmessage=({data})=>{if(data?.type==='cancel')worker.terminate();};
      worker.postMessage({resources,job},Object.values(resources));
    }catch(error){fail(error.message||error);worker?.terminate();}
  });
})();
