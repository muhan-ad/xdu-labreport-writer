'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const store=require('../src/main/resource-store');

test('measurement save works while Windows refuses to rename the resource root', t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labreport-save-locked-'));
 t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 const user = path.join(root, 'user'), builtin = path.join(root, 'builtin');
 const existing = path.join(user, 'existing'), first = path.join(builtin, 'first');
 const atomic = require('../src/main/atomic-store');
 const security = require('../src/main/security');
 atomic.writeFile(path.join(existing, 'data.json'), '{"x":1}');
 atomic.writeFile(path.join(first, 'schema.json'), '{}');
 const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
 const copy = source.slice(source.indexOf('function ensureUserCopy('), source.indexOf('const PHOTO_BASENAME'));
 const save = source.slice(source.indexOf("handle('write-data'"), source.indexOf('// ── IPC: 读写图表配置'));
 const handlers = new Map();
 const blockingSync = () => store.replaceTree(user, () => {}, {
  ...fs,
  renameSync(from, to) {
   if (from === user) throw Object.assign(Error('directory rename denied'), { code: 'EPERM' });
   fs.renameSync(from, to);
  },
 });
 const context = vm.createContext({
  fs, path, Buffer, atomic, security, resourceUpdating: false, EXPERIMENTS_DIR: builtin,
  syncInstalledResources: blockingSync, getDataRoots: () => ({ udRoot: user }),
  experimentPath: p => p, ensureInside: security.inside, resourceStore: store,
  copyDirTo: (from, to) => fs.cpSync(from, to, { recursive: true }),
  editableSchema: () => ({ schema: {} }), dataValidation: { validate: () => [] },
  handle: (name, callback) => handlers.set(name, callback),
 });
 assert.throws(blockingSync, { code: 'EPERM' });
 vm.runInContext(copy + save, context);
 const saveData = handlers.get('write-data');
 for (const [experiment, destination] of [[existing, existing], [first, path.join(user, 'first')]]) {
  const result = saveData(null, experiment, { x: 2 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.path, destination);
  assert.deepEqual(atomic.readJson(result.dataFile), { x: 2 });
 }
 assert.deepEqual(atomic.readJson(path.join(existing, 'data.json.bak')), { x: 1 });
 context.resourceUpdating = true;
 assert.equal(saveData(null, existing, { x: 3 }).ok, false);
 assert.deepEqual(atomic.readJson(path.join(existing, 'data.json')), { x: 2 });
});

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
