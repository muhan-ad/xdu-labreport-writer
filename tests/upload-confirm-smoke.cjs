'use strict';
// Local-only UI acceptance: every school operation is mocked.
const {app,BrowserWindow,protocol,net,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..'),out=process.env.LAB_CONFIRM_OUTPUT,appRoot=process.env.LAB_CONFIRM_ASAR||root;
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
protocol.registerSchemesAsPrivileged([{scheme:'labapp',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let state={ok:true,phase:'ready',rows:[],page:1,pages:1,dialog:{id:'official',type:'upload'},confirmation:{id:'token',fileName:'test-report.docx',size:100}},submitted=0,cancelled=0;
ipcMain.handle('mock-report',(_e,p)=>{if(p.action==='state')return state;if(p.action==='preview-upload')return {ok:true,buffer:fs.readFileSync(path.join(out,'test-report.docx')).toString('base64')};if(p.action==='confirm-upload'){submitted++;state={...state,confirmation:null,dialog:null};}if(p.action==='cancel-upload'){cancelled++;state={...state,confirmation:null,dialog:null};}return {ok:true};});
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({csrf:'test',authenticated:false}));return;}
 const name=req.url==='/'?'index.html':req.url.slice(1);
 if(!/^[\w.-]+$/.test(name)){res.writeHead(404).end();return;}
 const file=path.join(appRoot,'src/course-selection',name);
 if(!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src labapp:; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");res.end(fs.readFileSync(file));
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{let w;try{
 protocol.handle('labapp',r=>net.fetch(pathToFileURL(path.join(appRoot,'src',new URL(r.url).pathname.slice(1))).href));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 w=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{preload:path.join(__dirname,'upload-confirm-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const c=w.webContents,run=s=>c.executeJavaScript(s),errors=[];c.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});
 await w.loadURL('http://127.0.0.1:'+server.address().port+'/');
 await run("document.querySelectorAll('dialog[open]').forEach(d=>d.close());view='report';reportState="+JSON.stringify(state)+";renderReportDialog()");
 assert.equal(await run("document.getElementById('uploadConfirmDialog').open"),true);assert.equal(submitted,0);
 await run("document.getElementById('previewUploadConfirm').click()");
 let rendered=false;for(let i=0;i<100;i++){await sleep(100);const frame=c.mainFrame.frames.find(f=>f.url==='labapp://app/preview.html');if(frame&&await frame.executeJavaScript("document.body.textContent.includes('LOCAL REPORT PREVIEW')")){rendered=true;break;}}
 assert.equal(rendered,true,'Actual sandboxed DOCX preview must render');
 for(const width of [1440,950]){w.setSize(width,900);await sleep(250);assert.equal(await run("(()=>{const r=document.getElementById('uploadConfirmDialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"),true);fs.writeFileSync(path.join(out,'confirm-preview-'+width+'.png'),(await c.capturePage()).toPNG());}
 assert.equal(submitted,0);await run("document.getElementById('cancelUploadConfirm').click()");await sleep(150);assert.equal(cancelled,1);assert.equal(submitted,0);assert.equal(await run("document.getElementById('uploadConfirmDialog').open"),false);
 state={...state,confirmation:{id:'next',fileName:'test-report.docx',size:100},dialog:{id:'official',type:'upload'}};
 await run('reportState='+JSON.stringify(state)+';renderReportDialog();document.getElementById("continueUploadConfirm").click()');await sleep(150);assert.equal(submitted,1);
 assert.ok(!errors.some(x=>/Uncaught|Refused to frame|Failed to load resource/.test(x)),errors.join('\n'));
 fs.writeFileSync(path.join(out,'result.txt'),'PASS: real sandbox DOCX preview, normal/small dialog layout, cancel sends no upload, continue sends one mocked upload; no school requests.');
 w.destroy();server.close();app.exit(0);
 }catch(e){fs.writeFileSync(path.join(out,'error.txt'),e.stack);w?.destroy();server.close();app.exit(1);}});
setTimeout(()=>app.exit(2),45000).unref();
