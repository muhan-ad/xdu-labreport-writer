'use strict';
const {app,BrowserWindow,session}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const work=process.env.LABREPORT_SMOKE_WORK,root=process.env.LABREPORT_TEST_APP_ASAR;
app.setPath('userData',fs.mkdtempSync(path.join(work,'portal-settings-profile-')));
const log=path.join(work,'portal-settings-desktop.log');fs.writeFileSync(log,'START isolated portal settings test\n');const record=s=>fs.appendFileSync(log,s+'\n');
app.on('browser-window-created',(_,w)=>w.hide());const delay=ms=>new Promise(r=>setTimeout(r,ms));
const timeout=setTimeout(()=>{record('FAIL timeout');app.exit(1)},40000);
app.whenReady().then(async()=>{try{
 const {createSchoolPortal,PARTITION}=require(path.join(root,'src/main/school-portal'));
 const {autofillScript}=require(path.join(root,'src/main/school-autofill'));
 const ses=session.fromPartition(PARTITION);
 await ses.protocol.handle('http',()=>new Response('<!doctype html><form><input id="username" name="username"><input id="password" type="password"><button>Login</button></form><script>window.submissions=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();submissions++}</script>',{headers:{'content-type':'text/html; charset=utf-8'}}));
 const parent=new BrowserWindow({show:false}),prefs=path.join(app.getPath('userData'),'preferences.json');
 const value={username:'FIXTURE_USER',password:'FIXTURE_PASSWORD'};
 const credentials={status:async()=>({configured:true,available:true}),get:async()=>({...value}),save:async()=>({configured:true,available:true}),remove:()=>({configured:false,available:true})};
 let portal=createSchoolPortal({electron:require('electron'),root,getParent:()=>parent,credentials,preferencesFile:prefs});
 await portal.open();const win=BrowserWindow.getAllWindows().find(w=>w!==parent),wc=win.webContents;
 const ev=s=>wc.executeJavaScript(s),remote=win.contentView.children[0].webContents;
 for(let i=0;i<100;i++){if(await remote.executeJavaScript('document.getElementById("password")?.value === "FIXTURE_PASSWORD"').catch(()=>false))break;await delay(100);}
 assert.equal(await remote.executeJavaScript('document.getElementById("username").value'),'FIXTURE_USER');assert.equal(await remote.executeJavaScript('submissions'),0);
 assert.equal(await ev('document.getElementById("copyAccount")'),null);
 await ev('document.getElementById("openSettings").click()');await delay(200);assert.equal(await ev('document.getElementById("portalSettings").open'),true);
 assert.equal(await ev('document.getElementById("autoFillEnabled").checked'),true);
 await remote.executeJavaScript('document.getElementById("username").value="";document.getElementById("password").value=""');
 await ev('document.getElementById("autofill").click()');await delay(200);
 assert.equal(await remote.executeJavaScript('document.getElementById("password").value'),'FIXTURE_PASSWORD');
 assert.equal(await remote.executeJavaScript('submissions'),0);

 fs.writeFileSync(path.join(work,'portal-settings.png'),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
 await ev('document.getElementById("autoFillEnabled").click()');await delay(100);assert.equal(JSON.parse(fs.readFileSync(prefs)).autoFillEnabled,false);
 await ev('document.getElementById("manageCredentials").click()');await delay(200);assert.equal(await ev('document.getElementById("credentialsDialog").open'),true);
 await ev('document.getElementById("closeCredentials").click()');await delay(150);assert.equal(await ev('document.getElementById("portalSettings").open'),true);
 await ev('document.getElementById("closeSettings").click()');await delay(100);
 // A user-entered account must survive automatic fill attempts.
 await remote.executeJavaScript('document.getElementById("username").value="MANUAL_USER";document.getElementById("password").value=""');
 const url=remote.getURL(),result=await remote.executeJavaScriptInIsolatedWorld(1001,[{code:autofillScript(url,value,false,url,true)}]);
 assert.equal(result.occupied,true);assert.equal(await remote.executeJavaScript('document.getElementById("username").value'),'MANUAL_USER');
 portal.close();await delay(250);require('electron').ipcMain.removeHandler('school-portal-action');portal=createSchoolPortal({electron:require('electron'),root,getParent:()=>parent,credentials,preferencesFile:prefs});await portal.open();await delay(400);const reopened=BrowserWindow.getAllWindows().find(w=>w!==parent);
 assert.equal(await reopened.webContents.executeJavaScript('document.getElementById("autoFillEnabled").checked'),false);
 assert.equal(await reopened.contentView.children[0].webContents.executeJavaScript('document.getElementById("password").value'),'');
 record('PASS default automatic filling, no login submission, settings and credentials dialogs, removed copy buttons, occupied fields protected, persisted off switch after reopen');
 portal.close();parent.close();clearTimeout(timeout);app.exit(0);
}catch(e){record('FAIL '+e.stack);app.exit(1)}});
