// A queue keeps its runtime reservation while paused or detached from the UI.
// This is an in-app memory/concurrency guard, not an OS background service.
let queueReserved=false;
export function reserveQueueRuntime(){
 if(queueReserved)throw Error('报告队列已在运行');queueReserved=true;let released=false;
 return ()=>{if(!released){released=true;queueReserved=false;}};
}
export function assertReportRuntime(queueTask=false){
 if(queueReserved&&!queueTask)throw Error('报告队列正在运行，请先停止队列后再执行本机计算');
}
export function queueBlocksRoute(hash:string,running:boolean){
 const page=hash.replace(/^#?\//,'').split('/')[0];
 return running&&['resource-check','data-updates','app-updates','developer','easter-egg'].includes(page);
}
