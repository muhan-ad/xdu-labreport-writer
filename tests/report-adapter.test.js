'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');const {adapterScript}=require('../src/main/report-adapter');
function fixture(){const clicks=[],r={get:k=>({id:4,'0':6,'1':'星期三下午15:55-18:10','2':'霍尔效应测量磁场实验','3':'已上传'}[k])},buttons=[{isVisible:()=>true,text:'学生登录',fireEvent:()=>clicks.push('login')}];let records=[r];const grid={getColumns:()=>['0','1','2','3'].map(dataIndex=>({dataIndex})).concat([{xtype:'actioncolumn',items:[{tooltip:'报告预览'},{tooltip:'上传'}]}]),getStore:()=>({getRange:()=>records,getAt:i=>records[i],isLoading:()=>false,getTotalCount:()=>1,getPageSize:()=>20}),getView:()=>({getNode:()=>({querySelector:s=>({click:()=>clicks.push(s)})})})};
 class Parser{parseFromString(text){return {querySelector:()=>null,body:{textContent:text}};}}
 const context={location:{hostname:'wlsy.xidian.edu.cn',pathname:'/wgyreport/wgyreport.dll/'},DOMParser:Parser,Ext:{ComponentQuery:{query:q=>q==='grid'?[grid]:q==='window'?[]:q==='textfield'?[{isVisible:()=>true,inputType:'password'}]:q==='button'?buttons:[]}}};vm.createContext(context);return {context,clicks,change:()=>records=[{get:k=>k==='2'?'其他实验':r.get(k)}],run:(cmd,p)=>JSON.parse(JSON.stringify(vm.runInContext(adapterScript(cmd,p),context)))};}
test('adapter maps only observed official grid fields and submits login without a user confirmation step',()=>{const f=fixture();const s=f.run('state');assert.equal(s.rows[0].name,'霍尔效应测量磁场实验');assert.equal(s.rows[0].gradeText,'已上传');assert.equal(f.run('login').ok,true);assert.deepEqual(f.clicks,['login']);});
test('adapter binds row actions to an unchanged experiment and rejects stale rows',()=>{const f=fixture(),row=f.run('state').rows[0];assert.equal(f.run('row',{index:0,fingerprint:row.fingerprint,action:'upload'}).ok,true);assert.deepEqual(f.clicks,['.x-action-col-1']);f.change();assert.equal(f.run('row',{index:0,fingerprint:row.fingerprint,action:'upload'}).ok,false);assert.equal(f.clicks.length,1);});
test('adapter never reads or acts on a foreign page',()=>{const f=fixture();f.context.location.hostname='evil.example';assert.equal(f.run('login').phase,'error');assert.equal(f.clicks.length,0);});

test('nested main form is not mistaken for the upload dialog and X never confirms a message',()=>{
 const f=fixture(),calls=[],file={isVisible:()=>true},input={id:'actual-file'};
 const uploadNode={innerText:'上传 浏览 取消 上传',querySelectorAll:()=>[input],contains:()=>false};
 const upload={id:'upload',isVisible:()=>true,isDestroyed:()=>false,el:{dom:uploadNode},query:q=>q==='filefield'?[file]:q==='button'?[{text:'上传',isVisible:()=>true,fireEvent:()=>calls.push('submit')}]:[],close:()=>calls.push('close-upload')};
 const main={id:'main',isVisible:()=>true,el:{dom:{contains:n=>n===uploadNode,innerText:'main'}},query:q=>q==='filefield'?[file]:[]};
 const query=f.context.Ext.ComponentQuery.query;f.context.Ext.ComponentQuery.query=q=>q==='window'?[main,upload]:q==='textfield'?[]:query(q);
 const s=f.run('state');assert.equal(s.dialog.type,'upload');assert.equal(s.dialog.id,'upload');assert.equal(f.run('file-input').id,'actual-file');
 assert.equal(f.run('dismiss',{dialogId:'old'}).stale,true);assert.deepEqual(calls,[]);
 assert.equal(f.run('dismiss',{dialogId:'upload'}).ok,true);assert.deepEqual(calls,['close-upload']);
 const message={id:'message',xtype:'messagebox',closable:false,isVisible:()=>true,el:{dom:{innerText:'是否覆盖？',contains:()=>false}},query:q=>q==='button'?[{text:'是',isVisible:()=>true,fireEvent:()=>calls.push('yes')}]:[]};
 f.context.Ext.ComponentQuery.query=q=>q==='window'?[main,upload,message]:q==='textfield'?[]:query(q);
 assert.equal(f.run('state').dialog.type,'message');assert.equal(f.run('dismiss',{dialogId:'message'}).ok,false);assert.deepEqual(calls,['close-upload']);
});
