import type {Credits} from '../domain/credits.ts';
export class CreditsView {
 private host:HTMLElement|null=null;private generation=0;
 constructor(private read:()=>Promise<{credits:Credits;warning:string}>){ }
 leave(){this.generation++;this.host=null;}
 mount(host:HTMLElement){this.leave();this.host=host;const generation=this.generation;host.innerHTML='<section class="panel"><h2>感谢声明</h2><div data-credits-list></div><p data-credits-status role="status">正在读取…</p></section>';void this.read().then(({credits,warning})=>{
  if(generation!==this.generation||!this.host)return;const list=this.host.querySelector('[data-credits-list]')!;
  for(const item of credits.items){const row=document.createElement('article');row.className='credit-row';const name=document.createElement('h3'),work=document.createElement('p');name.textContent=item.name;work.textContent=item.contribution;row.append(name,work);list.append(row);}
  this.host.querySelector('[data-credits-status]')!.textContent=warning||(!credits.items.length?'致谢名单待同步':'');
 }).catch(()=>{if(generation===this.generation&&this.host)this.host.querySelector('[data-credits-status]')!.textContent='致谢名单读取失败，请重新打开重试';});}
}
