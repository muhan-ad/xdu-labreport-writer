import {ReportPreparationError} from './generation-quiz.ts';
export type QueueStatus='queued'|'running'|'done'|'failed'|'cancelled';
export interface QueueItem {id:string;name:string;status:QueueStatus;message:string;elapsedMs:number;}
export interface QueueRunner {(id:string,signal:AbortSignal,progress:(s:string)=>void,phase:(s:'computing'|'saving')=>void):Promise<void>;release?:()=>void;}
export class ReportQueue {
 items:QueueItem[]=[];running=false;paused=false;stopping=false;phase:'computing'|'saving'='computing';
 private controller:AbortController|null=null;private wake:(()=>void)|null=null;private generation=0;
 private runItem:QueueRunner;private changed:()=>void;
 constructor(runItem:ReportQueue['runItem'],changed:()=>void){this.runItem=runItem;this.changed=changed;}
 start(rows:{id:string;name:string}[]){if(this.running)throw Error('队列正在运行');if(!rows.length||rows.length>100||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('请选择不重复的实验');this.items=rows.map(r=>({...r,status:'queued',message:'',elapsedMs:0}));return this.pump();}
 retry(){if(this.running)return Promise.resolve();for(const row of this.items)if(row.status==='failed'||row.status==='cancelled'){row.status='queued';row.message='';row.elapsedMs=0;}return this.pump();}
 pause(){if(this.running&&!this.stopping){this.paused=true;this.changed();}}
 resume(){this.paused=false;this.wake?.();this.wake=null;this.changed();}
 stop(){if(!this.running)return;this.stopping=true;this.paused=false;if(this.phase==='computing')this.controller?.abort();this.wake?.();this.wake=null;this.changed();}
 get cancelling(){return !!this.controller?.signal.aborted;}
 cancelItem(id:string){const row=this.items.find(r=>r.id===id);if(!row||this.stopping)return false;
  if(row.status==='queued'){row.status='cancelled';row.message='已取消此任务';this.wake?.();this.wake=null;this.changed();return true;}
  if(row.status==='running'&&this.phase==='computing'&&this.controller&&!this.controller.signal.aborted){this.controller.abort();row.message='正在停止当前任务…';this.changed();return true;}return false;
 }
 moveItem(id:string,direction:number){if(![-1,1].includes(direction)||this.stopping)return false;const pending=this.items.filter(r=>r.status==='queued'),i=pending.findIndex(r=>r.id===id),other=pending[i+direction];if(i<0||!other)return false;
  const a=this.items.indexOf(pending[i]),b=this.items.indexOf(other);[this.items[a],this.items[b]]=[this.items[b],this.items[a]];this.changed();return true;
 }
 removeItem(id:string){const row=this.items.find(r=>r.id===id);if(!row||row.status==='queued'||row.status==='running')return false;this.items=this.items.filter(r=>r!==row);this.changed();return true;}
 clearFinished(){if(this.running)return false;this.items=this.items.filter(r=>r.status==='queued'||r.status==='running');this.changed();return true;}
 private async pump(){
  if(!this.items.some(r=>r.status==='queued'))return;const token=++this.generation;this.running=true;this.paused=false;this.stopping=false;this.changed();
  try{while(true){while(this.paused&&!this.stopping&&this.items.some(r=>r.status==='queued')){this.runItem.release?.();await new Promise<void>(resolve=>this.wake=resolve);}if(this.stopping)break;const row=this.items.find(r=>r.status==='queued');if(!row)break;
   const controller=new AbortController();this.controller=controller;this.phase='computing';row.status='running';row.message='正在读取已保存数据…';const began=performance.now();this.changed();
   const current=()=>token===this.generation&&this.controller===controller&&row.status==='running'&&!controller.signal.aborted;
   try{await this.runItem(row.id,controller.signal,text=>{if(current()){row.message=text.slice(0,2000);this.changed();}},phase=>{if(current()){this.phase=phase;this.changed();}});row.status=controller.signal.aborted?'cancelled':'done';row.message=row.status==='done'?(row.message.startsWith('报告已生成')?row.message:'报告已生成'):'已停止';}
   catch(error){row.status=controller.signal.aborted?'cancelled':'failed';row.message=controller.signal.aborted?'已停止':String((error as Error).message??error).slice(0,2000);if(error instanceof ReportPreparationError&&!controller.signal.aborted)this.stopping=true;}
   finally{row.elapsedMs=performance.now()-began;this.controller=null;this.changed();}
  }}finally{try{this.runItem.release?.();}finally{if(this.stopping)for(const row of this.items)if(row.status==='queued'){row.status='cancelled';row.message='尚未开始，已停止';}this.running=false;this.paused=false;this.controller=null;this.wake=null;this.changed();}}
 }
}
