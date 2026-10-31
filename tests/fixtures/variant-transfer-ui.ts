import catalog from '../../src/data/catalog.json';
import templates from '../../src/data/report-variants.json';
import {VariantLibraryView} from '../../src/features/variant-library.ts';
import {Repository} from '../../src/domain/repository.ts';
import {desktopVariantExport,variantArchiveCandidate} from '../../src/domain/variant-transfer.ts';
import {appendCustomVariant} from '../../src/domain/variant-edits.ts';
import type {VariantArchive} from '../../src/domain/variant-library.ts';

export function createTransferFixture(){
 const data=new Map<string,string>(),repo=new Repository({read:async k=>data.get(k)??null,write:async(k,v)=>{data.set(k,v);},remove:async k=>{data.delete(k);}}),experiments=catalog.experiments,exp=experiments[0],base=(templates as Record<string,Record<string,string[]>>)[exp.id];
 const ctx={experiments,templates};let imports=0,uses=0,confirmed=false,review='',output:unknown=null,pause=false,release:(()=>void)|undefined;
 const candidate=(entry:VariantArchive)=>variantArchiveCandidate(entry,(templates as Record<string,Record<string,string[]>>)[entry.experimentId]);const compatible=(entry:VariantArchive)=>{try{candidate(entry);return true;}catch{return false;}};
 const view=new VariantLibraryView(experiments,{list:id=>repo.listVariantLibrary(id),read:(id,key)=>repo.readVariantArchive(id,key),remove:(id,key)=>repo.removeVariantArchive(id,key),clear:id=>repo.clearVariantLibrary(id,async()=>{}),compatible,use:async entry=>{uses++;const current=await repo.loadReportSettings(entry.experimentId);await repo.saveReportSettings(entry.experimentId,appendCustomVariant(current,(templates as Record<string,Record<string,string[]>>)[entry.experimentId],entry.section,candidate(entry)));},export:async entries=>{output={type:'lab-maker-variant-library',version:1,entries};},exportDesktop:async entries=>{output=desktopVariantExport(entries,ctx);},import:async entries=>{imports++;for(const e of entries)await repo.archiveVariant(e);return {imported:entries.length,total:entries.length};},confirm:async(_title,body)=>{review=body;if(pause)await new Promise<void>(r=>release=r);return confirmed;}},ctx);
 const mount=()=>view.mount(document.querySelector<HTMLElement>('#library-host')!);mount();
 return {state:()=>({imports,uses,busy:view.isSaving,review,output}),confirm:(v:boolean)=>confirmed=v,leave:()=>view.leave(),reopen:mount,count:async()=> (await repo.listVariantLibrary(exp.id)).length,adopted:()=>repo.loadReportSettings(exp.id),file:(bad=false)=>({name:'自建变体_'+exp.sourceId+'.json',text:JSON.stringify(bad?{实验原理:[7]}:{实验原理:['兼容自建 '+base.实验原理[0],'<img src=x onerror=alert(1)> $standalone=8$','格式错误 %%DATA:value%%']})}),pause:()=>{pause=true;},release:()=>{pause=false;release?.();}};
}
