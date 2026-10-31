export interface AIKnowledgePolicy {version:1;kbOnly:boolean;}
export const defaultAIKnowledgePolicy=():AIKnowledgePolicy=>({version:1,kbOnly:true});
export function validAIKnowledgePolicy(raw:unknown):raw is AIKnowledgePolicy {
 const value=raw as AIKnowledgePolicy;return !!value&&value.version===1&&typeof value.kbOnly==='boolean';
}
// Old preferences have no switch: retain the desktop default without a migration write.
export function knowledgeEnabled(value:unknown=true):boolean {
 if(typeof value!=='boolean')throw Error('知识库设置无效');return value;
}
export async function requestKnowledge<T>(enabled:boolean,load:()=>Promise<T>):Promise<T|undefined> {
 return knowledgeEnabled(enabled)?load():undefined;
}
