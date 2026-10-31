import {ReportEngine,type RuntimeDiagnostic} from '../../src/engine/client.ts';
const engine=new ReportEngine();let pending=false,result:RuntimeDiagnostic|null=null,error='',progress='';
export function state(){return {pending,result,error,progress};}
export function start(){pending=true;result=null;error='';void engine.diagnose(text=>progress=text).then(value=>result=value).catch(e=>error=e.message).finally(()=>pending=false);}
export function stop(){engine.cancel();}
