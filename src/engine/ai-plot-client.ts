import {plotResourceNames,validPlotPng} from '../domain/ai-plot-resources.ts';
import {dataSnapshot} from '../platform/data-state.ts';
import {assertReportRuntime} from '../domain/report-runtime.ts';
export interface IsolatedPlotJob {code:string;data:Record<string,unknown>;}
export interface IsolatedPlotFigure {bytes:Uint8Array;caption:string;}
export interface IsolatedPlotResult extends IsolatedPlotFigure {images?:IsolatedPlotFigure[];}

export async function runIsolatedPlot(job:IsolatedPlotJob,signal:AbortSignal,onProgress:(text:string)=>void,timeoutMs=180000):Promise<IsolatedPlotResult>{
  assertReportRuntime();
  if(signal.aborted)throw Error('绘图已取消');
  if(!job||typeof job.code!=='string'||!job.code.trim()||job.code.length>30000||!job.data||typeof job.data!=='object'||Array.isArray(job.data))throw Error('绘图任务无效');
  const payload=JSON.stringify(job);if(new TextEncoder().encode(payload).length>450000)throw Error('绘图任务过大');
  const controller=new AbortController(),stop=()=>controller.abort();signal.addEventListener('abort',stop,{once:true});
  const timer=setTimeout(()=>controller.abort(),Math.min(300000,Math.max(1000,timeoutMs)));
  let frame:HTMLIFrameElement|undefined,channel:MessageChannel|undefined;
  try{
    onProgress('正在核对离线绘图资源…');
    const response=await fetch('/report-runtime/manifest.json',{signal:controller.signal});if(!response.ok)throw Error('绘图资源清单缺失');
    const manifest=await response.json();
    const activeData=await dataSnapshot();if(controller.signal.aborted)throw Error('绘图已取消');
    const read=async(name:string)=>{
      if(name==='LabMakerSansSC.ttf'&&activeData.payload)return Uint8Array.from(atob(activeData.payload.fontBase64),c=>c.charCodeAt(0)).buffer;
      const entry=manifest?.files?.[name];
      if(!entry||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>40*1024*1024||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('绘图资源清单无效：'+name);
      const r=await fetch('/report-runtime/'+name,{signal:controller.signal});if(!r.ok)throw Error('绘图资源缺失：'+name);
      const bytes=await r.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(bytes.byteLength!==entry.bytes||hash!==entry.sha256)throw Error('绘图资源校验失败：'+name);
      return bytes;
    };
    const lock=await read('pyodide-lock.json');
    const names=plotResourceNames(JSON.parse(new TextDecoder().decode(lock)),job.code),resources:Record<string,ArrayBuffer>={'pyodide-lock.json':lock};
    let total=lock.byteLength;
    for(const name of names){if(Object.hasOwn(resources,name))continue;resources[name]=await read(name);total+=resources[name].byteLength;if(total>100*1024*1024)throw Error('绘图资源体积异常');}
    const worker=await fetch('/ai-plot/worker.js',{signal:controller.signal});if(!worker.ok)throw Error('绘图隔离脚本缺失');const script=await worker.text();
    if(controller.signal.aborted)throw Error('绘图已取消');
    assertReportRuntime();
    frame=document.createElement('iframe');frame.hidden=true;frame.title='独立本机绘图';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
    channel=new MessageChannel();
    const result=await new Promise<IsolatedPlotResult>((resolve,reject)=>{
      const abort=()=>reject(Error(signal.aborted?'绘图已取消':'绘图超时，请精简需求后重试'));
      controller.signal.addEventListener('abort',abort,{once:true});
      channel!.port1.onmessage=({data})=>{
        if(data?.type==='progress'&&typeof data.text==='string')onProgress(data.text.slice(0,200));
        else if(data?.type==='error')reject(Error(String(data.message??'绘图失败').slice(-1500)));
        else if(data?.type==='result'){
          const images=data.images;
          if(!Array.isArray(images)||!images.length||images.length>8||images.some(i=>!(i?.bytes instanceof ArrayBuffer)||typeof i.caption!=='string'||!i.caption.trim()||i.caption.length>200)||images.reduce((n,i)=>n+i.bytes.byteLength,0)>32*1024*1024)return reject(Error('绘图返回格式无效'));
          const figures=images.map(i=>({bytes:new Uint8Array(i.bytes),caption:i.caption as string}));
          if(figures.some(i=>!validPlotPng(i.bytes)))return reject(Error('绘图返回图片无效'));
          resolve({...figures[0],images:figures});
        }
      };
      frame!.onload=()=>{
        if(controller.signal.aborted)return abort();
        frame!.contentWindow!.postMessage({type:'start-ai-plot',script,resources,job:JSON.parse(payload)},'*',[channel!.port2,...Object.values(resources)]);
      };
      frame!.onerror=()=>reject(Error('绘图隔离页面未能加载'));
      frame!.src='/ai-plot/frame.html';document.body.append(frame!);
    });
    if(controller.signal.aborted)throw Error('绘图已取消');
    return result;
  }catch(error){if(controller.signal.aborted)throw Error(signal.aborted?'绘图已取消':'绘图超时，请精简需求后重试');throw error;}
  finally{clearTimeout(timer);signal.removeEventListener('abort',stop);controller.abort();channel?.port1.postMessage({type:'cancel'});channel?.port1.close();channel?.port2.close();frame?.remove();}
}
