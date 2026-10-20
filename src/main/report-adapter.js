'use strict';
// Runs only inside our isolated, fixed-origin school session. Never returns credentials or HTML.
function reportAdapter(command,payload={}){
 const clean=v=>String(v??'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim().slice(0,1500);
 if(location.hostname!=='wlsy.xidian.edu.cn'||!location.pathname.toLowerCase().startsWith('/wgyreport/'))return {phase:'error',message:'报告系统跳转地址不受支持'};
 const E=globalThis.Ext;if(!E?.ComponentQuery)return {phase:'loading'};
 const visible=c=>!!c&&c.isVisible?.(true)&&!(typeof c.isDestroyed==='function'?c.isDestroyed():c.isDestroyed);
 const grids=E.ComponentQuery.query('grid').filter(g=>g.getColumns().some(c=>c.xtype==='actioncolumn')&&['0','1','2','3'].every(k=>g.getColumns().some(c=>c.dataIndex===k)));
 const grid=grids.length===1?grids[0]:null;
 const windows=E.ComponentQuery.query('window').filter(visible);
 const contains=(a,b)=>a!==b&&!!a?.el?.dom?.contains?.(b?.el?.dom);
 const front=list=>list.filter(a=>!list.some(b=>contains(a,b))).sort((a,b)=>(Number(a.el?.getStyle?.('z-index'))||0)-(Number(b.el?.getStyle?.('z-index'))||0)).at(-1);
 const upload=front(windows.filter(w=>w.query('filefield').some(visible)));
 // uniGUI also exposes the main form as an Ext window. Never flatten it into a message.
 const dialogs=windows.filter(w=>!w.query('textfield').some(f=>f.inputType==='password')&&w!==upload&&!contains(w,upload)&&
  (w.isXType?.('messagebox')||w.xtype==='messagebox'||/messagebox/i.test(w.$className||'')||w.query('button').some(b=>visible(b)&&['OK','确定','Yes','是','No','否','Cancel','取消'].includes(clean(b.text)))));
 const messageWindow=front(dialogs),host=messageWindow||upload;
 const dialogId=w=>String(w?.getId?.()||w?.id||'');
 if(command==='dismiss'){
  if(!host||payload.dialogId!==dialogId(host))return {ok:true,stale:true};
  if(host.closable!==false&&typeof host.close==='function'){host.close();return {ok:true};}
  const cancel=host.query('button').find(b=>visible(b)&&!b.disabled&&['取消','Cancel','否','No'].includes(clean(b.text)));
  if(cancel){cancel.fireEvent('click',cancel);return {ok:true};}
  return {ok:false,message:'学校窗口暂时不能关闭'};
 }
 const pwd=E.ComponentQuery.query('textfield').filter(f=>visible(f)&&f.inputType==='password');
 const fingerprint=r=>JSON.stringify([r.get('id'),r.get('0'),r.get('1'),r.get('2')].map(v=>String(v??'')));
 const available=icon=>!!icon&&!icon.classList?.contains('x-item-disabled')&&!icon.classList?.contains('x-hidden-display')&&(!icon.getClientRects||icon.getClientRects().length>0);
 if(command==='login'){
  const buttons=E.ComponentQuery.query('button').filter(b=>visible(b)&&/^学生登录$/.test(clean(b.text)));
  if(pwd.length!==1||buttons.length!==1)return {ok:false,message:'登录框尚未就绪'};
  buttons[0].fireEvent('click',buttons[0]);return {ok:true};
 }
 if(command==='row'){
  if(!grid)return {ok:false,message:'报告列表尚未就绪'};
  const r=grid.getStore().getAt(payload.index);if(!r||fingerprint(r)!==payload.fingerprint)return {ok:false,message:'列表已变化，请刷新后重试'};
  const column=grid.getColumns().find(c=>c.xtype==='actioncolumn'),wanted=payload.action==='preview'?'报告预览':'上传';
  const n=column.items.findIndex(i=>clean(i.tooltip)===wanted);if(n<0)return {ok:false,message:'学校操作入口已变化'};
  const node=grid.getView().getNode(r),icon=node?.querySelector('.x-action-col-'+n);if(!icon)return {ok:false,message:'请等待列表加载完成'};
  if(!available(icon))return {ok:false,message:'官网当前不允许此报告操作'};
  icon.click();return {ok:true};
 }
 if(command==='button'){
  if(!host||payload.dialogId&&payload.dialogId!==dialogId(host))return {ok:false,message:'学校操作窗口已变化'};
  const labels={submit:['上传'],cancel:['取消','Cancel'],ok:['确定','OK'],yes:['是','Yes'],no:['否','No']};
  const b=host.query('button').filter(b=>visible(b)&&(labels[payload.key]||[]).includes(clean(b.text)));
  if(b.length!==1||b[0].disabled)return {ok:false,message:'操作状态已变化，请重试'};b[0].fireEvent('click',b[0]);return {ok:true};
 }
 if(command==='file-input'){
  const inputs=upload?[...upload.el.dom.querySelectorAll('input[type=file]')]:[];
  return inputs.length===1?{id:inputs[0].id}:{message:'上传窗口尚未就绪'};
 }
 if(command==='page'){
  if(!grid)return {ok:false,message:'报告列表尚未就绪'};const s=grid.getStore();payload.direction===1?s.nextPage():s.previousPage();return {ok:true};
 }
 if(command!=='state')return {ok:false,message:'不支持的报告操作'};
 let dialog=null;
 if(messageWindow){const w=messageWindow;const buttons=w.query('button').filter(visible).map(b=>clean(b.text));dialog={id:dialogId(w),type:'message',message:clean(w.el.dom.innerText),buttons:buttons.filter(t=>['OK','确定','Yes','是','No','否','Cancel','取消'].includes(t))};}
 else if(upload)dialog={id:dialogId(upload),type:'upload',message:upload.query('textarea').filter(visible).map(t=>clean(t.getValue())).join('\n')};
 if(!grid)return {phase:pwd.length?'needs_login':'loading',dialog};
 const s=grid.getStore(),rows=s.getRange().slice(0,2000).map((r,index)=>{const raw=String(r.get('3')??''),doc=new DOMParser().parseFromString(raw,'text/html'),img=doc.querySelector('img'),node=grid.getView().getNode(r),column=grid.getColumns().find(c=>c.xtype==='actioncolumn');const capability=label=>{const n=column.items.findIndex(i=>clean(i.tooltip)===label),icon=node?.querySelector('.x-action-col-'+n);return n<0?false:icon?available(icon):undefined;};return {index,fingerprint:fingerprint(r),week:clean(r.get('0')),time:clean(r.get('1')),name:clean(r.get('2')),gradeText:clean(doc.body.textContent),gradeSrc:img?.getAttribute('src')||'',canPreview:capability('报告预览'),canUpload:capability('上传')};});
 return {phase:s.isLoading()?'reading':'ready',rows,dialog,hasUpload:!!upload,page:s.currentPage||1,pages:Math.max(1,Math.ceil((s.getTotalCount()||rows.length)/(s.getPageSize()||rows.length||1)))};
}
function adapterScript(command,payload){return '('+reportAdapter.toString()+')('+JSON.stringify(command)+','+JSON.stringify(payload||{})+')';}
module.exports={reportAdapter,adapterScript};
