const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8');
const escapeHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const scope={escapeHtml,currentData:{},dataValidation:require('../src/shared/data-validation')};vm.createContext(scope);vm.runInContext(source.slice(source.indexOf('function renderField('),source.indexOf('function onFormInput()')),scope);
test('labels render mathematical indices without changing keys or accessible label text',()=>{
 const html=scope.renderField({key:'n_i',label:'增重 n_i',type:'number',presets:[{value:1,label:'常用'}]});
 assert.match(html,/增重 n<sub>i<\/sub>/);assert.match(html,/data-key="n_i"/);assert.match(html,/aria-label="增重 n_i常用值"/);
 assert.match(scope.renderField({key:'x',label:'x_{i+1}^2',type:'number'}),/x<sub>i\+1<\/sub><sup>2<\/sup>/);
});
test('rendering label indices never permits HTML in schema labels',()=>{
 const html=scope.renderField({key:'x',label:'<img src=x onerror=alert(1)> R_n',type:'number'});
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/R<sub>n<\/sub>/);
});
