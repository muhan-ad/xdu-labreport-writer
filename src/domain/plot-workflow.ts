import {extractPlotCode,type PlotRepair} from './ai-plot.ts';
export interface PlotWorkflowHooks<T> {
 signal:AbortSignal;
 verify:()=>void;
 request:(repair:PlotRepair|undefined,progress:(text:string)=>void)=>Promise<string>;
 run:(code:string,progress:(text:string)=>void)=>Promise<T>;
 code:(code:string)=>Promise<void>;
 failure:(repair:PlotRepair)=>void;
 progress:(text:string)=>void;
}
export async function generatePlotWithRepair<T>(hooks:PlotWorkflowHooks<T>){
 const check=()=>{if(hooks.signal.aborted)throw Error('绘图已停止');hooks.verify();};
 const progress=(text:string)=>{if(!hooks.signal.aborted)hooks.progress(text);};
 let repair:PlotRepair|undefined;
 for(let attempt=1;attempt<=3;attempt++){
  check();progress(`${repair?'修复绘图代码':'生成绘图代码'}（${attempt}/3）`);
  // API/transport failures stop immediately; only returned code failures consume repair attempts.
  const raw=await hooks.request(repair,progress);check();
  let code:string;
  try{code=extractPlotCode(raw);}catch(error){repair={code:typeof raw==='string'&&raw.trim()?raw.trim().slice(0,30000):'# 模型未返回代码',error:String((error as Error).message).slice(0,4000)};hooks.failure(repair);if(attempt===3)throw Error('三次尝试未完成绘图：'+repair.error);continue;}
  await hooks.code(code);check();progress(`正在绘制（${attempt}/3）`);
  try{const result=await hooks.run(code,progress);check();return {code,result,attempt};}
  catch(error){check();repair={code,error:String((error as Error).message||'绘图失败').slice(0,4000)};hooks.failure(repair);if(attempt===3)throw Error('三次尝试未完成绘图：'+repair.error);}
 }
 throw Error('绘图未完成');
}
