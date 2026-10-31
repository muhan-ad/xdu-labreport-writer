import type { Experiment, Measurements, Profile } from "../domain/types.ts";
import {assertReportRuntime} from '../domain/report-runtime.ts';
import type {CalculationContext} from '../domain/ai-context.ts';
import type {DataEnvelope} from '../domain/data-update-store.ts';
import type {DataPayload} from '../domain/data-package.ts';
import {textHash} from '../domain/ai-library.ts';
export interface EngineJob {
  mode?: "plot"|"context"|"diagnostic";
  experimentId: string;
  data: Measurements;
  profile: Profile;
  date: string;
  options: Record<string, unknown>;
  photoBase64?: string;
  aiPlotImages?:{base64:string;sha256:string;caption:string;section:string;widthCm?:number}[];
  aiPlotImage?:{base64:string;sha256:string;caption:string;section:string;widthCm?:number};
}
export interface RuntimeDiagnostic {complete:boolean;experiments:number;scripts:number;templates:number;problems:{path:string;reason:string}[];}
export interface EngineResult {
  docx: Uint8Array;
  charts: { name: string; bytes: Uint8Array }[];
  metadata: {
    name: string;
    formulaCount: number;
    sections: Record<string, unknown>;
    copySections?:Record<string,string>;
    copyIssues?:Record<string,string>;
    headings?: string[];
    log: string;
  };
}
export class ReportEngine {
  private generation=0;
  private queueTask=false;
  private reuseRuntime=false;
  private idleWorker:{worker:Worker;key:string}|null=null;
  private dataSource:(candidate?:DataEnvelope)=>Promise<DataPayload|null>;
  constructor(dataSource?:(candidate?:DataEnvelope)=>Promise<DataPayload|null>,queueTask=false,reuseRuntime=false){this.queueTask=queueTask;this.reuseRuntime=queueTask&&reuseRuntime;this.dataSource=dataSource??(candidate=>import('../platform/data-state.ts').then(module=>module.resolveReportData(candidate)));}
  private worker: Worker | null = null;
  private reject: ((e: Error) => void) | null = null;
  async diagnose(onProgress:(text:string)=>void,candidate?:DataEnvelope):Promise<RuntimeDiagnostic>{
    return this.execute<RuntimeDiagnostic>({mode:'diagnostic',experimentId:'',data:{},profile:{name:'',studentId:'',className:''},date:'',options:{}},onProgress,candidate);
  }
  async generate(
    job: Omit<EngineJob,'mode'> & {mode?:'plot'},
    onProgress: (text: string) => void,
  ): Promise<EngineResult> {
    return this.execute<EngineResult>(job,onProgress);
  }
  async calculate(job:Omit<EngineJob,'mode'>,onProgress:(text:string)=>void):Promise<CalculationContext>{
    return this.execute<CalculationContext>({...job,mode:'context'},onProgress);
  }
  private async execute<T>(job:EngineJob,onProgress:(text:string)=>void,candidate?:DataEnvelope):Promise<T>{
    assertReportRuntime(this.queueTask);
    this.cancelActive();
    const generation=this.generation;
    let dataPackage:DataPayload|null,key='';
    try{dataPackage=await this.dataSource(candidate);if(this.reuseRuntime)key=dataPackage?await textHash(JSON.stringify(dataPackage)):'builtin';}
    catch(error){this.releaseIdle();throw error;}
    assertReportRuntime(this.queueTask);
    if(generation!==this.generation)throw Error('已取消生成');
    if(this.idleWorker&&this.idleWorker.key!==key)this.releaseIdle();
    const worker=this.idleWorker?.worker??new Worker(new URL("/report-worker.js", location.href));
    this.idleWorker=null;
    this.worker = worker;
    return new Promise((resolve, reject) => {
      let settled=false;
      this.reject = (error) => finish(error);
      const timer = setTimeout(
        () => finish(Error("生成超时，请重试；可先减少照片大小")),
        180000,
      );
      const finish = (error?: Error, value?: T) => {
        if(settled)return;settled=true;
        clearTimeout(timer);
        worker.onmessage=null;worker.onerror=null;
        if (this.worker === worker) {
          this.worker = null;
          this.reject = null;
        }
        if(!error&&this.reuseRuntime&&job.mode!=='diagnostic'&&generation===this.generation){
          this.idleWorker={worker,key};
          worker.onerror=event=>{event.preventDefault();if(this.idleWorker?.worker===worker)this.releaseIdle();};
          worker.onmessage=event=>{if(event.data?.type==='error'&&this.idleWorker?.worker===worker)this.releaseIdle();};
        }else worker.terminate();
        error ? reject(error) : resolve(value!);
      };
      worker.onmessage = ({ data }) => {
        if(settled||generation!==this.generation)return;
        if (data.type === "progress") onProgress(data.text);
        else if(data.type==='diagnostic-result'&&job.mode==='diagnostic')finish(undefined,data.diagnostic as T);
        else if (data.type === "context-result"&&job.mode==='context')finish(undefined,data.context as T);
        else if (data.type === "result"&&job.mode!=='context')
          finish(undefined, data as T);
        else if (data.type === "error") finish(Error(data.message));
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(
          Error(
            "报告引擎未能完成：" +
              (event.message || "请重试，或检查设备内存与内置资源"),
          ),
        );
      };
      try{worker.postMessage({ job,dataPackage });}catch(error){finish(error instanceof Error?error:Error('报告任务未能发送'));}
    });
  }
  /** Queue lifecycle releases a successful runtime at pause, stop and completion. */
  releaseIdle(){const idle=this.idleWorker;this.idleWorker=null;idle?.worker.terminate();}
  private cancelActive() {
    this.generation++;
    if(this.reject)this.reject(Error('已取消生成'));
    else if(this.worker){this.worker.terminate();this.worker=null;}
  }
  cancel(){this.cancelActive();this.releaseIdle();}
}
