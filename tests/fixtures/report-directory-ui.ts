import {ReportDirectoryView} from '../../src/features/report-directory.ts';
import type {DirectoryState} from '../../src/platform/report-directory.ts';
export function createDirectoryFixture(){
 const host=document.querySelector<HTMLElement>('#directory-host')!;let saved:DirectoryState={configured:true,writable:true,name:'我的报告'},cancel=false,error=false,confirm=true,chooses=0,clears=0,pending=false,resolve:((v:DirectoryState)=>void)|null=null;
 const view=new ReportDirectoryView({status:async()=>({...saved}),choose:async()=>{chooses++;if(error)throw Error('模拟目录授权失败');if(pending)return new Promise(r=>{resolve=r;});if(cancel)return {...saved,cancelled:true};saved={configured:true,writable:true,name:'新报告目录'};return {...saved};},clear:async()=>{clears++;saved={configured:false,writable:false,name:''};}},async()=>confirm);
 view.mount(host);return {state:()=>({chooses,clears,busy:view.isSaving}),cancel:(v:boolean)=>cancel=v,fail:(v:boolean)=>error=v,confirm:(v:boolean)=>confirm=v,expired:()=>{saved={configured:true,writable:false,name:'原报告目录'};view.mount(host);},reopen:()=>view.mount(host),pending:()=>pending=true,late:()=>resolve?.({configured:true,writable:true,name:'过期回调目录'}),leave:()=>view.leave()};
}
