const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),work=process.env.LAB_CHART_WORK;if(!work)throw Error('isolated work required');
fs.mkdirSync(work,{recursive:true});app.disableHardwareAcceleration();app.setPath('userData',fs.mkdtempSync(path.join(work,'profile-')));
app.whenReady().then(async()=>{let win;const timer=setTimeout(()=>app.exit(1),25000);try{
 const preload=path.join(work,'preload.cjs');
 fs.writeFileSync(preload,`const {contextBridge}=require('electron');const stored={'manual':{mode:'preset',xField:'t1[0]',yField:'t1[2]',chartType:'fit',title:'用户保留的标题'}};const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';contextBridge.exposeInMainWorld('labAPI',{readChartConfig:async p=>({ok:true,config:stored[p]||null}),saveChartConfig:async(p,v)=>{stored[p]=v;return {ok:true}},chartPreview:async opts=>({ok:true,dataUrl:png,title:'图组',images:[{dataUrl:png,caption:'幅频特性',note:'第一张注释'},{dataUrl:png,caption:'相频特性',note:'第二张注释'}]}),logEvent:()=>{}});`);
 win=new BrowserWindow({show:false,width:1350,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true,preload}});
 await win.loadFile(path.join(root,'src/index.html'));
 const rlc=JSON.parse(fs.readFileSync(path.join(root,'物理实验/实验脚本/RLC电路的稳态特性研究实验/schema.json'),'utf8'));
 const prism=JSON.parse(fs.readFileSync(path.join(root,'物理实验/实验脚本/三棱镜顶角的测量/schema.json'),'utf8'));
 const result=await win.webContents.executeJavaScript(`(async()=>{
 currentExp={path:'fresh',id:'fresh'};currentSchema=${JSON.stringify(rlc)};currentData={};await loadChartConfig(currentExp);
 openChartPresetModal();const official={type:chartConfig.chartType,choice:$('chartPresetChoice').value,summary:$('chartOfficialSummary').textContent,manualHidden:document.querySelector('.chart-manual-row').style.display==='none'};
 await saveChartPresetModal();await generateChartPreview();const gallery={count:document.querySelectorAll('#chartImageGallery figure').length,captions:[...document.querySelectorAll('#chartImageGallery figcaption')].map(x=>x.textContent),notes:document.querySelectorAll('#chartImageGallery p').length};
 currentExp={path:'manual',id:'manual'};await loadChartConfig(currentExp);openChartPresetModal();const legacy={x:chartConfig.xField,y:chartConfig.yField,title:$('chartTitle').value,choice:$('chartPresetChoice').value};
 currentExp={path:'prism',id:'prism'};currentSchema=${JSON.stringify(prism)};await loadChartConfig(currentExp);openChartPresetModal();const noGraph={choice:$('chartPresetChoice').value,x:$('chartXField').value,y:$('chartYField').value,hint:$('chartOfficialGuide').textContent};
 return {official,gallery,legacy,noGraph};})()`);
 assert.equal(result.official.type,'official');assert.equal(result.official.choice,'official:all');assert.equal(result.official.manualHidden,true);assert.match(result.official.summary,/I \/ mA/);assert.equal(result.gallery.count,2);assert.equal(result.gallery.notes,2);
 assert.deepEqual(result.legacy,{x:'t1[0]',y:'t1[2]',title:'用户保留的标题',choice:'manual'});
 assert.equal(result.noGraph.choice,'none');assert.equal(result.noGraph.x,'');assert.equal(result.noGraph.y,'');assert.match(result.noGraph.hint,/未列关系图/);
 await win.webContents.insertCSS('* { animation: none !important; transition: none !important; }');
 const visible=await win.webContents.executeJavaScript(`(async()=>{currentSchema=${JSON.stringify(rlc)};currentExp={path:'fresh',id:'fresh'};await loadChartConfig(currentExp);openChartPresetModal();await new Promise(r=>setTimeout(r,350));return {display:getComputedStyle($('chartPresetModal')).display,height:$('chartPresetChoice').getBoundingClientRect().height};})()`);
 assert.equal(visible.display,'flex');assert.ok(visible.height>0);
 await win.webContents.capturePage().then(img=>fs.writeFileSync(path.join(work,'preset-ui.png'),img.toPNG()));
 fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:true,...result},null,2));win.destroy();clearTimeout(timer);app.exit(0);
}catch(e){fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({ok:false,error:e.stack}));win?.destroy();clearTimeout(timer);app.exit(1);}});
