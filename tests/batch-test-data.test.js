'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {fillAllTestData}=require('../src/main/batch-test-data'),atomic=require('../src/main/atomic-store');
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'all-test-data-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('all 28 fixtures validate; batch backs up exact original bytes, keeps extras, photos and reports',t=>{
 const root=setup(t),source=path.join(__dirname,'../物理实验/实验脚本');
 const dirs=fs.readdirSync(source).filter(n=>fs.existsSync(path.join(source,n,'test-data.json'))).map(n=>{
  const dir=path.join(root,n);fs.mkdirSync(dir);for(const file of ['schema.json','test-data.json'])fs.copyFileSync(path.join(source,n,file),path.join(dir,file));
  fs.writeFileSync(path.join(dir,'data.json'),'{"customMetadata":"keep","original":123}');
  fs.writeFileSync(path.join(dir,'原始数据照片.jpg'),'photo');fs.writeFileSync(path.join(dir,'report.docx'),'report');return dir;
 });assert.equal(dirs.length,28);
 const backup=path.join(root,'backup');assert.equal(fillAllTestData(dirs,backup).count,28);
 dirs.forEach((dir,i)=>{const data=JSON.parse(fs.readFileSync(path.join(dir,'data.json')));assert.equal(data.customMetadata,'keep');
  assert.equal(fs.readFileSync(path.join(backup,i+'.json'),'utf8'),'{"customMetadata":"keep","original":123}');
  assert.equal(fs.readFileSync(path.join(dir,'原始数据照片.jpg'),'utf8'),'photo');assert.equal(fs.readFileSync(path.join(dir,'report.docx'),'utf8'),'report');});
});
test('invalid fixture changes no measurement file; failed write rolls earlier writes back',t=>{
 const root=setup(t),dirs=['a','b'].map(n=>{const d=path.join(root,n);fs.mkdirSync(d);fs.writeFileSync(path.join(d,'schema.json'),JSON.stringify({groups:[{fields:[{key:'x',type:'number',required:true}]}]}));fs.writeFileSync(path.join(d,'test-data.json'),'{"x":1}');fs.writeFileSync(path.join(d,'data.json'),'{"x":55}');return d;});
 fs.writeFileSync(path.join(dirs[1],'test-data.json'),'{}');assert.throws(()=>fillAllTestData(dirs,path.join(root,'bad')),/未填写/);
 assert.equal(fs.readFileSync(path.join(dirs[0],'data.json'),'utf8'),'{"x":55}');
 fs.writeFileSync(path.join(dirs[1],'test-data.json'),'{"x":1}');const write=atomic.writeFile;let failed=false;
 atomic.writeFile=(file,...args)=>{if(file===path.join(dirs[1],'data.json')&&!failed){failed=true;throw Error('simulated write failure');}return write(file,...args);};
 try{assert.throws(()=>fillAllTestData(dirs,path.join(root,'rollback')),/原数据已恢复/);}finally{atomic.writeFile=write;}
 for(const dir of dirs)assert.equal(fs.readFileSync(path.join(dir,'data.json'),'utf8'),'{"x":55}');
});
