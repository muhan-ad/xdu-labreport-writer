/** Local chart/photo viewer. Revokes only URLs created here, never a caller's photo. */
export class ChartImagePreview {
 private dialog:HTMLDialogElement|null=null;
 private url='';
 private ownsUrl=false;
 close(){if(!this.dialog)return false;this.dialog.close();this.dialog.remove();this.dialog=null;if(this.ownsUrl)URL.revokeObjectURL(this.url);this.url='';this.ownsUrl=false;return true;}
 open(bytes:Uint8Array,title:string){
  this.close();this.url=URL.createObjectURL(new Blob([bytes.slice().buffer],{type:'image/png'}));
  this.ownsUrl=true;this.show(title,'图表预览');
 }
 openPhoto(url:string,title:string){
  const parsed=new URL(url,location.href),localFile=parsed.protocol===location.protocol&&parsed.host===location.host&&/^\/_capacitor_(file|content)_/.test(parsed.pathname);
  if(!/^data:image\/(png|jpeg|webp);base64,/i.test(url)&&!(parsed.protocol==='blob:'&&parsed.origin===location.origin)&&!localFile)throw Error('照片地址无法核实，请重新添加');
  this.close();this.url=url;this.show(title,'照片预览');
 }
 private show(title:string,label:string){
  const dialog=document.createElement('dialog');dialog.className='ai-plot-zoom-sheet';dialog.setAttribute('aria-label',label);
  dialog.innerHTML='<header><strong></strong><div class="ai-inline"><button class="button secondary compact" data-zoom="fit">适应</button><button class="button secondary compact" data-zoom="original">原图</button><button class="button compact" data-zoom="close">关闭</button></div></header><div class="ai-plot-zoom-canvas"><img class="fit"></div>';
  dialog.querySelector('strong')!.textContent=title;const image=dialog.querySelector('img')!;image.src=this.url;image.alt=title;
  dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
  dialog.addEventListener('click',event=>{const action=(event.target as Element).closest<HTMLElement>('[data-zoom]')?.dataset.zoom;if(action==='close')this.close();else if(action)image.classList.toggle('fit',action==='fit');});
  this.dialog=dialog;document.body.append(dialog);dialog.showModal();
 }
}
