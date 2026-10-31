import {Repository} from '../../src/domain/repository.ts';import {ReportManager} from '../../src/features/report-manager.ts';import catalog from '../../src/data/catalog.json';import type {Experiment} from '../../src/domain/types.ts';
export function createReportIndexFixture(){
 const exp=(catalog.experiments as Experiment[])[0],data=new Map<string,string>([['report-'+exp.id+'-a','broken'],['report-'+exp.id+'-b','broken']]),notices:string[]=[];
 const repo=new Repository({read:async k=>data.get(k)??null,write:async(k,v)=>{data.set(k,v);},remove:async k=>{data.delete(k);}});
 const view=new ReportManager(repo,[exp],{notice:v=>notices.push(v),edit:()=>{},confirm:async()=>false});view.mount(document.querySelector('#app')!);
 return {id:exp.id,values:()=>[data.get('report-'+exp.id+'-a'),data.get('report-'+exp.id+'-b')],notices:()=>notices};
}
