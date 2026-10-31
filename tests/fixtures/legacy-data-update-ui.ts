import {makeBrowserDataPackage} from './data-signature-browser.ts';
import {ReportEngine} from '../../src/engine/client.ts';
import {DataUpdateStore} from '../../src/domain/data-update-store.ts';
import {verifyDataPayload} from '../../src/domain/data-package.ts';
import measurements from './measurements.json';
export async function verifyLegacySignedWorker(){
 const changes:Record<string,string>={};
 const test=await makeBrowserDataPackage(p=>{
  const swap=(name:string,from:string,to:string,count:number)=>{const key=name+'/generate.py',source=p.sources[key];if(source.split(from).length-1!==count)throw Error('兼容测试源格式不符：'+name);p.sources[key]=source.replaceAll(from,to);changes[key]=p.sources[key];};
  swap('扭摆法测量钢丝切变模量','r"\\frac{" + format_number(DELTA_TIMER, sig_figs=8) + r"}{\\sqrt{3}} \\approx " + format_number(B_T, sig_figs=4)','r"\\frac{0.01}{\\sqrt{3}} \\approx " + format_number(B_T, sig_figs=4)',2);
  swap('RLC电路的稳态特性研究实验','f0 = 1.0 / (2.0 * math.pi * math.sqrt(L_mh * 1e-3 * C_uf * 1e-6)) / 1000.0','f0 = round(1.0 / (2.0 * math.pi * math.sqrt(L_mh * 1e-3 * C_uf * 1e-6)) / 1000.0, 3)',1);
  for(const field of ['dm1','dm2'])swap('直螺线管磁场分布的测量',`"${field}_cm": (${field}_cm_list[i], u_dm_single_cm),`,`"${field}_cm": (${field}_cm_list[i], u_dm_cm),`,1);
 });
 const files=new Map<string,string>(),storage={read:async(k:string)=>files.get(k)??null,write:async(k:string,v:string)=>{files.set(k,v);},remove:async(k:string)=>{files.delete(k);}},manager=new DataUpdateStore(storage,test.ctx);
 const preflight=new ReportEngine(async candidate=>candidate?verifyDataPayload(new TextEncoder().encode(candidate.body),candidate.manifest,test.ctx):null);
 const result=await manager.install(test.envelope,()=>preflight.diagnose(()=>{},test.envelope),new AbortController().signal);if(!result.committed)throw Error('测试数据包未启用');
 const reloaded=new DataUpdateStore(storage,test.ctx),snapshot=await reloaded.load();if(!snapshot.payload)throw Error('重开测试数据包失败');for(const [key,value] of Object.entries(changes))if(snapshot.payload.sources[key]!==value)throw Error('数据包内容被意外修改');
 const engine=new ReportEngine(async()=> (await reloaded.load()).payload),byName=(name:string)=>snapshot.payload!.catalog.experiments.find(e=>e.sourceId===name)!;
 const makeJob=(name:string)=>{const exp=byName(name);return {experimentId:exp.id,data:structuredClone((measurements as Record<string,any>)[exp.id]),profile:{name:'本地测试',studentId:'',className:''},date:'2026-10-30',options:{variants:{},disabledSections:[]}};};
 const rlc=makeJob('RLC电路的稳态特性研究实验'),expected=1/(2*Math.PI*Math.sqrt(rlc.data.L*1e-3*rlc.data.C*1e-6))/1000;rlc.data.f0p=expected;const rlcContext=await engine.calculate(rlc,()=>{});if(Math.abs(Number(rlcContext.values.f0)-expected)>1e-12||Math.abs(Number(rlcContext.values.eta))>1e-10)throw Error('旧资源 RLC 频率未修正');
 const sol=makeJob('直螺线管磁场分布的测量'),d=sol.data,m=d.M_mH/1000,ruler=d.instrument_delta_scale_mm/10/Math.sqrt(3),current=d.instrument_delta_ammeter_a/Math.sqrt(3),mean=(a:number[])=>a.reduce((x,y)=>x+y,0)/a.length;const values=d.I0_ma.map((i:number,j:number)=>m*(i/1000)/(10*((d.dm1_cm[j]+d.dm2_cm[j])/2)));const variance=values.map((v:number,j:number)=>{const distance=(d.dm1_cm[j]+d.dm2_cm[j])/2;return (m/(10*distance)*current)**2+2*(v/(2*distance)*ruler)**2;});const solContext=await engine.calculate(sol,()=>{}),ub=Math.sqrt(mean(variance));if(Math.abs(Number(solContext.values.u_B_RKb)-ub)>1e-9*ub+1e-18)throw Error('旧资源标尺不确定度未修正');
 const torsion=makeJob('扭摆法测量钢丝切变模量');torsion.data.instrument_delta_timer=0.15;const report=await engine.generate(torsion,()=>{});if(report.docx.length<1000||!report.metadata.formulaCount)throw Error('扭摆报告未生成');let binary='';for(let i=0;i<report.docx.length;i+=8192)binary+=String.fromCharCode(...report.docx.subarray(i,i+8192));
 const after=await reloaded.load();for(const [key,value] of Object.entries(changes))if(after.payload?.sources[key]!==value)throw Error('生成报告后数据包被修改');
 return {docx:btoa(binary),rlcF0:rlcContext.values.f0,rlcEta:rlcContext.values.eta,solenoidUB:solContext.values.u_B_RKb,formulas:report.metadata.formulaCount,checks:['signed legacy bundle passes actual preflight and reload','RLC unrounded resonance and zero relative error','solenoid single-reading uncertainty','torsion report generated for 0.15 s','verified package remains unchanged']};
}
