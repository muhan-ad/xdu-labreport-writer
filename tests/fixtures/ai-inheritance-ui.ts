import {AIFeatures} from '../../src/features/ai.ts';
export async function createAIInheritanceFixture(){
 let inherited=false,inheritModel='',writes:any[]=[],tests:any[]=[],statusCalls:any[]=[],late:((v:any)=>void)|undefined,pending=false,fail=false;
 const own={hasKey:true,endpoint:'https://vision.example/v1',model:'vision-own'},chat={hasKey:true,endpoint:'https://chat.example/v1',model:'chat-model'};
 const configuration={
  status:async(slot:string,override?:boolean)=>{statusCalls.push({slot,override});const isInherited=slot==='vision'&&(override??inherited),result={...(slot==='vision'&&!isInherited?own:chat),inheritsChat:isInherited,inheritModel,baseModel:chat.model};if(isInherited&&inheritModel)result.model=inheritModel;if(fail)throw Error('模拟读取失败');if(pending)return new Promise<any>(resolve=>late=resolve);return result;},
  configure:async(slot:string,endpoint:string,model:string,key:string,inheritChat=false)=>{writes.push({slot,endpoint,model,key,inheritChat});if(slot==='vision'&&inheritChat){inherited=true;inheritModel=model;}else{inherited=false;Object.assign(own,{hasKey:true,endpoint,model});}return configuration.status(slot);},
  clear:async(slot:string)=>{writes.push({clear:slot});if(slot==='vision'){inherited=false;Object.assign(own,{hasKey:false,endpoint:'',model:''});}else Object.assign(chat,{hasKey:false,endpoint:'',model:''});return configuration.status(slot);},
  test:async(input:any)=>{tests.push(input);return {text:'OK',elapsedMs:1};},complete:async()=>({text:'OK',elapsedMs:1}),models:async()=>({models:['mock-model'],partial:false})
 };
 const feature=new AIFeatures({context:()=>null,apply:async()=>{},notice:()=>{}},configuration,configuration);await feature.config();
 return {state:()=>({inherited,inheritModel,writes,tests,statusCalls,own,chat}),close:()=>feature.close(),reopen:()=>feature.config(),pending:()=>pending=true,resolve:()=>{pending=false;late?.({...chat});},fail:(v:boolean)=>fail=v,removeChat:()=>Object.assign(chat,{hasKey:false,endpoint:'',model:''})};
}
