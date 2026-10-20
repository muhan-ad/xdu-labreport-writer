const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/sidebar.js'),'utf8');
function setup(value,blocked=false){
 const classes=new Set(),storage=new Map(value===undefined?[]:[['labreport.sidebarCollapsed',value]]);
 const button={attrs:{},setAttribute(k,v){this.attrs[k]=v},focus(){this.focused=true},addEventListener(_,fn){this.click=fn}};
 const sidebar={attrs:{},setAttribute(k,v){this.attrs[k]=v},contains:()=>false};
 const app={classList:{toggle(k,v){v?classes.add(k):classes.delete(k)},contains:k=>classes.has(k)}};
 const document={querySelector:()=>app,getElementById:id=>id==='experimentSidebar'?sidebar:button};
 vm.runInNewContext(source,{document,localStorage:{getItem:k=>{if(blocked)throw Error();return storage.get(k)},setItem:(k,v)=>{if(blocked)throw Error();storage.set(k,v)}}});
 return {button,sidebar,classes,storage};
}
test('sidebar toggles and persists without rebuilding experiment content',()=>{
 const ui=setup();assert.equal(ui.button.attrs['aria-expanded'],'true');
 ui.button.click();assert.ok(ui.classes.has('sidebar-collapsed'));assert.equal(ui.sidebar.inert,true);
 assert.equal(ui.button.attrs['aria-label'],'展开实验导航');assert.equal(ui.storage.get('labreport.sidebarCollapsed'),'true');
 ui.button.click();assert.equal(ui.sidebar.inert,false);assert.equal(ui.button.attrs['aria-expanded'],'true');
 assert.doesNotMatch(source,/labAPI|innerHTML|location\.reload|readFormData|saveSettings/);
});
test('sidebar restores the preference and tolerates unavailable storage',()=>{
 assert.ok(setup('true').classes.has('sidebar-collapsed'));
 const blocked=setup(undefined,true);assert.doesNotThrow(()=>blocked.button.click());assert.equal(blocked.sidebar.inert,true);
});
