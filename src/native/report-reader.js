/* Runs in the isolated report WebView. File requests require a native final-confirmation ticket. */
function labReportReader(command, payload, expectedOrigin) {
  if(location.href==='about:blank')return {phase:'loading'};
  const clean = value => String(value ?? '').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim().slice(0,1500);
  if (location.origin !== expectedOrigin || !location.pathname.toLowerCase().startsWith('/wgyreport/')) return {phase:'error',message:'报告网站地址已变化'};
  const E = globalThis.Ext;
  if (!E?.ComponentQuery) return {phase:'loading'};
  const visible = c => c && c.isVisible?.(true) && !(typeof c.isDestroyed === 'function' ? c.isDestroyed() : c.isDestroyed);
  const passwords = E.ComponentQuery.query('textfield').filter(f => visible(f) && f.inputType === 'password');
  const grids = E.ComponentQuery.query('grid').filter(g => g.getColumns().some(c => c.xtype==='actioncolumn') && ['0','1','2','3'].every(k => g.getColumns().some(c => c.dataIndex===k)));
  const messages = E.ComponentQuery.query('window').filter(w => visible(w) && (w.xtype==='messagebox' || w.isXType?.('messagebox')));
  const message = clean(messages.at(-1)?.el?.dom?.innerText || '');
  if (command === 'login') {
    const shown = input => input.getBoundingClientRect().width>0 && input.getBoundingClientRect().height>0 && !input.disabled && !input.readOnly;
    const inputs = [...document.querySelectorAll('input')].filter(shown);
    const pwd = inputs.filter(i => i.type==='password');
    const candidates = inputs.filter(i => ['text','email','tel'].includes(i.type) && !/captcha|verify|checkcode|验证码/i.test(i.name+' '+i.id+' '+i.placeholder));
    const named = candidates.filter(i => /user|account|student|login|学号|账号|^(xh|sno|stu)$/i.test(i.name+' '+i.id+' '+i.placeholder));
    const user = named.length===1 ? named[0] : candidates.length===1 ? candidates[0] : null;
    const buttons = E.ComponentQuery.query('button').filter(b => visible(b) && !b.disabled && clean(b.text)==='学生登录');
    if(passwords.length!==1 || pwd.length!==1 || !user || buttons.length!==1 || user.form!==pwd[0].form) return {phase:'error',message:'官网登录框无法可靠匹配'};
    if(user.form) { const action = new URL(user.form.action || location.href,location.href); if(action.origin!==expectedOrigin || !action.pathname.toLowerCase().startsWith('/wgyreport/')) return {phase:'error',message:'官网登录地址待核实'}; }
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    user.autocomplete='off';pwd[0].autocomplete='off';
    set.call(user,payload.account);set.call(pwd[0],payload.password);
    for(const input of [user,pwd[0]])for(const name of ['input','change'])input.dispatchEvent(new Event(name,{bubbles:true}));
    buttons[0].fireEvent('click',buttons[0]);
    return {phase:'logging_in'};
  }
  if(grids.length>1) return {phase:'error',message:'官网报告列表存在歧义'};
  const grid = grids[0];
  if(!grid) return {phase:passwords.length?'needs_login':'loading',message};
  const store=grid.getStore(), pages=Math.max(1,Math.ceil((store.getTotalCount()||0)/(store.getPageSize()||20)));
  const fingerprint = r => JSON.stringify([r.get('id'),r.get('0'),r.get('1'),r.get('2')].map(v=>String(v??'')));
  const windows=E.ComponentQuery.query('window').filter(visible), uploadWindows=windows.filter(w=>w.query?.('filefield')?.some(visible));
  const upload=uploadWindows.filter(w=>!uploadWindows.some(other=>other!==w&&w.el?.dom?.contains(other.el?.dom))).at(-1);
  const dialogId=w=>String(w?.getId?.()||w?.id||'');
  function installUploadHooks() {
    if(!globalThis.__labReportUploadHooks) {
      const capture=(kind,url,method,data,headers,target,resolve,reject)=>{
        const current=globalThis.__labReportUpload;
        if(!current||!data)return false;
        if(Object.prototype.toString.call(data)!=='[object FormData]'){
          if(data instanceof Blob||data instanceof ArrayBuffer||ArrayBuffer.isView(data)||data instanceof ReadableStream){current.error='官网文件提交格式待核实';reject?.(new TypeError(current.error));return true;}
          return false;
        }
        const fields=[];let files=0;
        for(const [name,value] of data.entries()){
          if(typeof value==='string')fields.push({name,value});
          else {files++;fields.push({name,file:true,fileName:value.name,size:value.size,mime:value.type});}
        }
        if(!files)return false;
        if(current.request){current.error='同一确认不允许重复发送附件';reject?.(new TypeError(current.error));return true;}
        const file=fields.find(f=>f.file),destination=new URL(url,location.href);
        if(files!==1||file.fileName!==current.name||file.size!==current.expected||String(method).toUpperCase()!=='POST'||destination.origin!==location.origin||!destination.pathname.toLowerCase().startsWith('/wgyreport/')){current.error='官网附件提交协议待核实';reject?.(new TypeError(current.error));return true;}
        current.request={kind,target,resolve,reject,info:{url:destination.href,origin:location.origin,method:'POST',headers,fields,referrer:location.href}};
        return true;
      };
      const originalFetch=globalThis.fetch;
      globalThis.fetch=function(input,options={}){
        if(globalThis.__labReportUpload&&(options.body||(input instanceof Request&&input.body))){
          return new Promise((resolve,reject)=>{if(!capture('fetch',typeof input==='string'?input:input.url,options.method||input.method||'GET',options.body||input.body,Object.fromEntries(new Headers(options.headers||input.headers||{})),null,resolve,reject))originalFetch.call(this,input,options).then(resolve,reject);});
        }
        return originalFetch.call(this,input,options);
      };
      const open=XMLHttpRequest.prototype.open,header=XMLHttpRequest.prototype.setRequestHeader,send=XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open=function(method,url,...rest){this.__labRequest={method,url,headers:{}};return open.call(this,method,url,...rest);};
      XMLHttpRequest.prototype.setRequestHeader=function(name,value){if(this.__labRequest)this.__labRequest.headers[name]=value;return header.call(this,name,value);};
      XMLHttpRequest.prototype.send=function(body){const r=this.__labRequest;if(r&&capture('xhr',r.url,r.method,body,r.headers,this))return;return send.call(this,body);};
      const submit=HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit=function(){const target=[...document.querySelectorAll('iframe')].find(frame=>frame.name===this.target);if(capture('form',this.action,this.method,new FormData(this),{},target))return;return submit.call(this);};
      document.addEventListener('submit',event=>{const form=event.target;if(!(form instanceof HTMLFormElement))return;const target=[...document.querySelectorAll('iframe')].find(frame=>frame.name===form.target);if(capture('form',form.action,form.method,new FormData(form),{},target))event.preventDefault();},true);
      globalThis.__labReportUploadHooks=true;
    }
  }
  if(command==='dismiss-success') {
    const w=messages.at(-1),text=clean(w?.el?.dom?.innerText||'');
    if(w&&text===payload.message&&/(上传成功|提交成功|上传完成)/.test(text)&&!/失败|未成功|不成功/.test(text)) {
      if(w.closable!==false&&typeof w.close==='function')w.close();
      else {const buttons=w.query('button').filter(b=>visible(b)&&!b.disabled);if(buttons.length===1&&['确定','OK'].includes(clean(buttons[0].text)))buttons[0].fireEvent('click',buttons[0]);}
    }
    return {phase:'reading'};
  }
  const row=payload.fingerprint?store.getRange().find(r=>fingerprint(r)===payload.fingerprint):null;
  if(command==='ensure-row'){if(!row)return {phase:'error',message:'报告记录已变化'};grid.ensureVisible?.(row,{focus:false,select:false});return {phase:'reading'};}
  if(command==='open-upload') {
    if(!row||upload||message)return {phase:'error',message:message||'官网操作窗口已变化'};
    const col=grid.getColumns().find(c=>c.xtype==='actioncolumn'),index=col.items.findIndex(i=>clean(i.tooltip)==='上传'),icon=index<0?null:grid.getView().getNode(row)?.querySelector('.x-action-col-'+index);
    if(!icon||icon.classList.contains('x-item-disabled')||icon.classList.contains('x-hidden-display'))return {phase:'error',message:'官网当前不允许上传'};
    icon.click();return {phase:'reading'};
  }
  // Bytes only enter this document after native one-use final confirmation.
  if(command==='file-begin') {
    if(!upload||dialogId(upload)!==payload.dialogId||typeof DataTransfer!=='function')return {phase:'error',message:'上传窗口或系统 WebView 版本待核实'};
    installUploadHooks();
    globalThis.__labReportUpload={id:payload.id,chunks:[],size:0,name:payload.fileName,expected:payload.size,dialogId:payload.dialogId};return {phase:'reading'};
  }
  if(command==='upload-request') {
    const stage=globalThis.__labReportUpload;
    if(!stage||stage.id!==payload.id)return {phase:'error',message:'上传请求已失效'};
    if(stage.error)return {phase:'error',message:stage.error};
    return {phase:stage.request?'captured':'reading',request:stage.request?.info||null};
  }
  if(command==='upload-response') {
    const stage=globalThis.__labReportUpload,request=stage?.request;
    if(!stage||stage.id!==payload.id||!request||request.delivered)return {phase:'error',message:'上传响应已失效'};
    request.delivered=true;
    if(request.kind==='fetch') {
      if(payload.networkError)request.reject(new TypeError('上传网络中断，结果需核实'));
      else request.resolve(new Response(payload.body,{status:payload.status,statusText:payload.statusText||'',headers:payload.headers||{}}));
    } else if(request.kind==='xhr') {
      const xhr=request.target;let response=payload.body;
      if(xhr.responseType==='json')try{response=JSON.parse(payload.body);}catch{response=null;}
      for(const [key,value] of Object.entries({readyState:4,status:payload.networkError?0:payload.status,statusText:payload.statusText||'',responseText:payload.body||'',response,responseURL:request.info.url}))try{Object.defineProperty(xhr,key,{configurable:true,value});}catch{}
      xhr.getAllResponseHeaders=()=>Object.entries(payload.headers||{}).map(([k,v])=>k+': '+v).join('\r\n');xhr.getResponseHeader=name=>Object.entries(payload.headers||{}).find(([k])=>k.toLowerCase()===name.toLowerCase())?.[1]||null;
      xhr.dispatchEvent(new Event('readystatechange'));xhr.dispatchEvent(new ProgressEvent(payload.networkError?'error':'load'));xhr.dispatchEvent(new ProgressEvent('loadend'));
    } else {
      const frame=request.target;
      if(!frame?.contentDocument)return {phase:'error',message:'官网上传响应窗口已变化'};
      if(payload.networkError) { stage.error='上传网络中断，结果需核实';return {phase:'reading'}; }
      try{frame.contentWindow.history.replaceState(null,'',request.info.url);}catch{}
      frame.contentDocument.open();frame.contentDocument.write(payload.body);frame.contentDocument.close();
    }
    return {phase:'reading'};
  }
  if(command==='file-chunk') {
    const stage=globalThis.__labReportUpload;
    if(!stage||stage.id!==payload.id||!upload||dialogId(upload)!==stage.dialogId)return {phase:'error',message:'附件准备已失效'};
    const bytes=Uint8Array.from(atob(payload.data),c=>c.charCodeAt(0));stage.size+=bytes.length;
    if(stage.size>stage.expected||stage.size>128*1024*1024)return {phase:'error',message:'附件长度异常'};
    stage.chunks.push(new Blob([bytes]));return {phase:'reading'};
  }
  if(command==='file-finish') {
    const stage=globalThis.__labReportUpload,inputs=upload?[...upload.el.dom.querySelectorAll('input[type=file]')]:[];
    if(!stage||stage.id!==payload.id||stage.size!==stage.expected||inputs.length!==1||dialogId(upload)!==stage.dialogId)return {phase:'error',message:'附件或上传窗口已变化'};
    const transfer=new DataTransfer();transfer.items.add(new File(stage.chunks,stage.name,{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
    inputs[0].files=transfer.files;stage.chunks=[];inputs[0].dispatchEvent(new Event('change',{bubbles:true}));return {phase:'reading'};
  }
  if(command==='submit-upload') {
    const stage=globalThis.__labReportUpload,inputs=upload?[...upload.el.dom.querySelectorAll('input[type=file]')]:[],file=inputs[0]?.files?.[0];
    if(!stage||stage.id!==payload.id||!row||!upload||dialogId(upload)!==stage.dialogId||inputs.length!==1||file?.name!==stage.name||file.size!==stage.expected||message)return {phase:'error',message:message||'提交前附件或实验记录已变化'};
    if(stage.request)return {phase:'submitted'};
    const buttons=upload.query('button').filter(b=>visible(b)&&!b.disabled&&clean(b.text)==='上传');
    if(buttons.length!==1)return {phase:'error',message:'官网上传按钮待核实'};
    buttons[0].fireEvent('click',buttons[0]);return {phase:'submitted'};
  }
  if(command==='refresh') { if(!store.isLoading()) { globalThis.__labmakerReportImages?.clear();store.reload(); } return {phase:'reading'}; }
  if(command==='page') {
    if(store.isLoading())return {phase:'reading'};
    const next=(store.currentPage||1)+payload.direction;
    if(![1,-1].includes(payload.direction)||next<1||next>pages)return {phase:'error',message:'官网没有这一页'};
    payload.direction===1?store.nextPage():store.previousPage();return {phase:'reading'};
  }
  if(command!=='read') return {phase:'error',message:'不支持的报告读取操作'};
  const cache=globalThis.__labmakerReportImages || (globalThis.__labmakerReportImages=new Map());
  const image = src => {
    let url;try {url=new URL(src,location.href);}catch{return {state:'unreadable'};}
    if(!src || url.origin!==expectedOrigin || !url.pathname.toLowerCase().startsWith('/wgyreport/') || !url.pathname.includes('/cache/') || !url.pathname.endsWith('.png') || url.search || url.hash) return {state:'unreadable'};
    if(cache.has(url.href))return cache.get(url.href);
    if(cache.size>=200)cache.clear();
    const result={state:'loading'}, img=new Image();cache.set(url.href,result);
    img.onload=()=>{
      if(!img.naturalWidth||img.naturalWidth>1024||!img.naturalHeight||img.naturalHeight>256){result.state='unreadable';return;}
      try{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);const data=canvas.toDataURL('image/png');if(data.length>140000)throw Error();result.data=data;result.state='ready';}catch{result.state='unreadable';}
    };
    img.onerror=()=>{result.state='unreadable';};img.src=url.href;
    return result;
  };
  const rows=store.getRange().slice(0,2000).map((r,index)=>{
    const raw=String(r.get('3')??''),doc=new DOMParser().parseFromString(raw,'text/html'),src=doc.querySelector('img')?.getAttribute('src')||'', img=src?image(src):null;
    const node=grid.getView().getNode(r),column=grid.getColumns().find(c=>c.xtype==='actioncolumn');
    const allowed=label=>{const n=column.items.findIndex(i=>clean(i.tooltip)===label),icon=n<0?null:node?.querySelector('.x-action-col-'+n);if(n<0)return false;if(!icon)return null;return !icon.classList?.contains('x-item-disabled')&&!icon.classList?.contains('x-hidden-display')&&(!icon.getClientRects||icon.getClientRects().length>0);};
    return {fingerprint:JSON.stringify([r.get('id'),r.get('0'),r.get('1'),r.get('2')].map(v=>String(v??''))),week:clean(r.get('0')),time:clean(r.get('1')),name:clean(r.get('2')),gradeText:clean(doc.body.textContent),gradeImage:img?.data||'',imageState:img?.state||'',canPreview:allowed('报告预览'),canUpload:allowed('上传')};
  });
  return {phase:store.isLoading()?'reading':'ready',rows,page:store.currentPage||1,pages,message,uploadDialog:upload?dialogId(upload):''};
}
