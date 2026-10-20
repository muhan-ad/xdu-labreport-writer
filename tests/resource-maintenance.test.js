'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const store=require('../src/main/resource-store');
test('repeated force repair with unchanged builtin version repairs again and keeps each prior tree',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'repeat-repair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const builtin=path.join(root,'builtin'),user=path.join(root,'user');
 function put(name,text){fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,text);}
 put(path.join(builtin,'A/generate.py'),'official');put(path.join(builtin,'A/variants.json'),'["official"]');put(path.join(user,'A/generate.py'),'first old');put(path.join(user,'A/variants.json'),'["personal"]');put(path.join(user,'A/data.json'),'measurements');put(path.join(user,'A/report.docx'),'report');put(path.join(user,'A/原始数据照片.png'),'photo');
 const fingerprint=store.resourceVersion(builtin);
 for(const old of ['first old','second old']){put(path.join(user,'A/generate.py'),old);store.syncBuiltin(builtin,user,fingerprint,'2.1.5',{force:true});assert.equal(fs.readFileSync(path.join(user,'A/generate.py'),'utf8'),'official');assert(fs.readdirSync(root).filter(n=>n.startsWith('.resource-')).some(n=>{const f=path.join(root,n,'previous/A/generate.py');return fs.existsSync(f)&&fs.readFileSync(f,'utf8')===old;}));}
 for(const [file,text]of [['variants.json','["personal"]'],['data.json','measurements'],['report.docx','report'],['原始数据照片.png','photo']])assert.equal(fs.readFileSync(path.join(user,'A',file),'utf8'),text);
});
test('repair button stays available without warnings and can execute twice',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8'),functions=source.slice(source.indexOf('async function loadDataInfo()'),source.indexOf('async function checkDataUpdate()'));
 const nodes={dataVersionText:{},resourceSyncStatus:{},btnRestoreBuiltinResources:{hidden:true,disabled:false}};let calls=0;
 const context={$:id=>nodes[id],window:{labAPI:{getDataInfo:async()=>({ok:true,resourceWarnings:[],builtinVersion:'1.1.1'}),restoreBuiltinResources:async()=>{calls++;return {ok:true}}}},isGenerating:false,isBatchRunning:false,isSavingData:false,isAiPolishing:false,isDataModified:false,appConfirm:async()=>true,showToast(){},currentExp:null,fetchExperiments:async()=>[],getCategory(){},updateCategoryCounts(){},renderList(){},updateEmptyStats(){}};
 vm.createContext(context);vm.runInContext(functions,context);await context.loadDataInfo();assert.equal(nodes.btnRestoreBuiltinResources.hidden,false);for(let i=0;i<2;i++){await context.restoreBuiltinResources();assert.equal(nodes.btnRestoreBuiltinResources.hidden,false);assert.equal(nodes.btnRestoreBuiltinResources.disabled,false);}assert.equal(calls,2);
 context.appConfirm=async()=>false;await context.restoreBuiltinResources();assert.equal(calls,2);assert.equal(nodes.btnRestoreBuiltinResources.disabled,false);
 let release;context.appConfirm=()=>new Promise(r=>release=r);const pending=context.restoreBuiltinResources();await context.restoreBuiltinResources();assert.equal(calls,2);release(false);await pending;assert.equal(nodes.btnRestoreBuiltinResources.disabled,false);
});
