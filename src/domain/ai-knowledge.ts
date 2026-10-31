import {selectExperimentKnowledge,type ExperimentKnowledge} from './ai-context.ts';

export function createKnowledgeLoader(sourceIds:readonly string[],fetchResource:(name:string)=>Promise<Response>){
  const approved=new Set(sourceIds);
  let cached:Promise<Map<string,ExperimentKnowledge|Error>>|undefined;
  async function read(){
    const meta=await fetchResource('manifest.json');
    if(!meta.ok)throw Error('内置知识清单未能读取，请检查资源完整性');
    const manifest=await meta.json(),record=manifest?.files?.['report-sources.json'];
    if(!record||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>5*1024*1024||typeof record.sha256!=='string'||!(/^[a-f0-9]{64}$/).test(record.sha256))throw Error('内置知识清单无效，请检查资源完整性');
    const response=await fetchResource('report-sources.json');
    if(!response.ok)throw Error('内置实验知识未能读取，请检查资源完整性');
    const bytes=await response.arrayBuffer();
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength!==record.bytes||hash!==record.sha256)throw Error('内置实验知识校验失败，请检查资源完整性');
    const sources=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    selectExperimentKnowledge(sources,[]); // Validate the archive itself before indexing.
    const selected=new Map<string,ExperimentKnowledge|Error>();
    for(const id of approved){
      try{selected.set(id,selectExperimentKnowledge(sources,[id]).get(id)!);}
      catch(error){selected.set(id,error instanceof Error?error:Error('实验知识无效'));}
    }
    return selected;
  }
  return async(sourceId:string)=>{
    if(!approved.has(sourceId))throw Error('未找到对应实验知识');
    if(!cached)cached=read().catch(error=>{cached=undefined;throw error;});
    const value=(await cached).get(sourceId);
    if(value instanceof Error){cached=undefined;throw value;}
    if(!value)throw Error('内置实验知识缺失：'+sourceId);
    return {...value};
  };
}
