'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const work='E:/workspace/codex/2026-10-09/jian/work',log=path.join(work,'cleanup-desktop.log');
fs.writeFileSync(log,'START\n');
const record=text=>fs.appendFileSync(log,text+'\n');
app.setPath('userData',fs.mkdtempSync(path.join(work,'cleanup-profile-')));
app.on('browser-window-created',(_,w)=>w.hide());
require(path.join(process.env.LABREPORT_TEST_APP_ASAR,'main.js'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const deadline=Date.now()+60000;while(Date.now()<deadline){if(await fn())return;await delay(200);}throw Error('UI timeout');}
app.whenReady().then(async()=>{
 try{
  await until(()=>BrowserWindow.getAllWindows().length);
  const wc=BrowserWindow.getAllWindows()[0].webContents,ev=s=>wc.executeJavaScript(s);
  wc.setBackgroundThrottling(false);
  const capture=async(name)=>{await delay(600);fs.writeFileSync(path.join(work,name),(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
  await until(()=>ev('typeof experiments!=="undefined"&&experiments.length===27').catch(()=>false));
  // Verify the shipped DOM and schema-driven initialization without touching real user files.
  assert.equal(await ev("document.getElementById('btnClearFormData')"),null);
  assert.equal(await ev("document.querySelectorAll('#btnAiModuleSkills svg').length"),0);
  assert.equal(await ev("document.getElementById('btnReportModulePolish').previousElementSibling.id"),'btnReportModuleSections');
  await ev('void (appConfirm=async()=>false)');
  for (const exp of await ev('experiments.map(e=>({id:e.id,name:e.name}))')) {
    await ev(`selectExperiment(experiments.find(e=>e.id===${JSON.stringify(exp.id)}))`);
    const before=await ev('window.labAPI.readData(currentExp.path)');
    const beforeForm=await ev('JSON.stringify(currentData)');
    await ev('fillDefaultData()');assert.equal(await ev('JSON.stringify(currentData)'),beforeForm);
    await ev('void (appConfirm=async()=>true); fillDefaultData()');
    assert.equal(await ev(`currentSchema.groups.every(g=>g.fields.every(f=>f.type==='array' ? currentData[f.key].length===f.length && currentData[f.key].every(x=>x===null) : f.type==='matrix' ? currentData[f.key].length===f.rows && currentData[f.key].every(row=>row.length===f.cols && row.every(x=>x===null)) : currentData[f.key]===null))`),true,exp.name);
    assert.deepEqual(await ev('window.labAPI.readData(currentExp.path)'),before,'uncommitted blank form must not alter disk');
    assert.equal(await ev("document.getElementById('btnFillDefaultData').textContent"),'初始化空白表单');
    await ev('isDataModified=false; notifyDataModified(); void (appConfirm=async()=>false)');
  }
  record('PASS all 27 forms: single blank initialization, scalar/array/matrix dimensions, cancel and unsaved disk preservation');
  await ev('switchSettingsPane("reports"); switchSettingsModule("reports","polish")');
  assert.match(await ev('document.getElementById("polishHistoryList").textContent'),/暂无/);
  const historyExp=(await ev('experiments[0]'));
  await ev(`selectExperiment(experiments.find(e=>e.id===${JSON.stringify(historyExp.id)}))`);
  const historySource=await ev('JSON.parse(JSON.stringify(currentData))');
  const append=async(text,expId=historyExp.id)=>ev(`window.labAPI.polishHistory('append',${JSON.stringify({expId,expName:expId,section:'结论',original:'原文',polished:text,sourceData:historySource})})`);
  const old=(await append('历史正文')).record, applied=(await append('当前正文')).record;
  await ev(`setPolishOverride(currentExp.id,'结论','当前正文'); markPolishApplied(${JSON.stringify({historyId:applied.id})})`);
  const other=(await append('长正文'+ '文字'.repeat(4000),(await ev('experiments[1].id')))).record;
  await ev('loadPolishHistory()');
  assert.equal((await ev('window.labAPI.polishHistory("list")')).records.length,3);
  assert.match(await ev('document.getElementById("polishHistoryList").textContent'),/当前已应用|未导入/);
  await ev('openModal("settingsModal"); switchSettingsPane("reports"); switchSettingsModule("reports","polish")');
  await ev('document.querySelectorAll(".polish-history-entry").forEach(x=>x.open=true)');
  await capture('settings-history.png');
  await ev('void (appConfirm=async()=>true)');
  await ev(`deletePolishHistory({id:${JSON.stringify(old.id)}},'test')`);
  assert.equal(await ev('expOverrides(currentExp.id).结论'),'当前正文');
  await ev(`deletePolishHistory({id:${JSON.stringify(applied.id)}},'test')`);
  assert.equal(await ev('expOverrides(currentExp.id).结论'),undefined);
  await ev(`document.getElementById('polishHistorySearch').value='NO_MATCH'; renderPolishHistory()`);
  assert.match(await ev('document.getElementById("polishHistoryList").textContent'),/没有匹配/);
  await ev(`deletePolishHistory({expId:${JSON.stringify(other.expId)}},'test')`);
  await ev('document.getElementById("polishHistorySearch").value=""; saveAllOverrides({})');
  record('PASS history empty/search/long text, active association, deleting old/current/group records via real IPC');
  // Exercise real IPC with a fake protected transport: never contact a model provider.
  const transport=require(path.join(process.env.LABREPORT_TEST_APP_ASAR,'src/main/network.js')), savedJson=transport.json;
  transport.json=async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer TEST_DRAFT_KEY');
    return url.endsWith('/models') ? {data:[{id:'mock-model'}]} : {choices:[{message:{content:'OK'}}]};
  };
  await ev(`document.getElementById('selectProvider').value='custom'; document.getElementById('inputApiUrl').value='https://models.example/v1'; document.getElementById('inputApiKey').value='TEST_DRAFT_KEY'; fetchApiModels()`);
  assert.equal(await ev('document.getElementById("selectDiscoveredModel").options[1].value'),'mock-model');
  await ev(`document.getElementById('selectDiscoveredModel').value='mock-model'; document.getElementById('selectDiscoveredModel').onchange(); testApiConnection()`);
  assert.equal(await ev('document.getElementById("inputModel").value'),'mock-model');
  assert.match(await ev('document.getElementById("apiTestStatus").textContent'),/连接成功/);
  assert.equal(await ev('loadSettings().apiUrl||""'),'');
  transport.json=savedJson;
  await ev('document.getElementById("inputApiKey").value=""');
  await ev('switchSettingsPane("ai"); toggleAiConfigPanel("api")');
  await capture('settings-models.png');
  await ev('document.getElementById("inputApiUrl").scrollIntoView({block:"center"})');
  await capture('settings-model-list.png');
  await ev('closeModal("settingsModal")');
  record('PASS model discovery and test connection real trusted IPC / simulated responses / unsaved settings');
  const fixtures=require('./fixtures/experiment-data.json');
  for(const name of ['电容与高电阻的测量','薄透镜焦距的测量（凸透镜）']){
   await ev(`selectExperiment(experiments.find(e=>e.name===${JSON.stringify(name)}))`);
   await until(()=>ev('currentSchema&&currentSchema.userInputOnly'));
   assert.equal(await ev("document.getElementById('btnFillDefaultData').textContent"),'初始化空白表单');
   assert.equal((await ev('window.labAPI.readCalculationContext(currentExp.path)')).ok,false);
   const data=fixtures[name];
   assert.equal((await ev(`window.labAPI.writeData(currentExp.path,${JSON.stringify(data)})`)).ok,true);
   await ev('loadFormData(currentExp)');
   const ctx=await ev('window.labAPI.readCalculationContext(currentExp.path)');assert.equal(ctx.ok,true,ctx.error);
   if(name.includes('凸透镜'))assert.equal(ctx.data._kind,'generic');else assert.equal(ctx.data.r_0,100);
   const result=await ev('window.labAPI.runGenerate(currentExp.path,{},{},{},false,"",null)');assert.equal(result.ok,true,result.error);
   const before=fs.readFileSync(result.reportFile);
   await ev('setCustomQuiz(currentExp.id, [])').catch(()=>{});
   await ev('void (ensureCustomQuizAnswers = async () => ({none:true}))');
   for(const overrides of [{结论:'旧结果10.48 MΩ'}, {__sourceData:{r_0:10},结论:'旧结果10.48 MΩ'}]) {
    await ev(`saveAllOverrides({[currentExp.id]:${JSON.stringify(overrides)}})`);
    assert.deepEqual(await ev('generationPolish(currentExp)'),{});
    assert.deepEqual(await ev('expOverrides(currentExp.id)'),overrides);
    assert.equal(await ev('runGenerateReport(null,currentExp.id)'),true);
    const text=await require('mammoth').extractRawText({path:result.reportFile});
    assert.ok(!text.value.includes('10.48 MΩ'));
   }
   await ev(`saveAllOverrides({[currentExp.id]:{__sourceData:${JSON.stringify(data)},结论:'本次依据用户数据生成。'}})`);
   assert.ok((await ev('generationPolish(currentExp)')).__sourceData);
   await ev('saveAllOverrides({[currentExp.id]:{结论:"旧结果10.48 MΩ"}}); genQueue=[{exp:currentExp,status:"queued",id:currentExp.id}];');
   await ev('pumpQueue()');
   assert.equal(await ev('genQueue[0].status'),'done');
   assert.equal(await ev('expOverrides(currentExp.id).结论'),'旧结果10.48 MΩ');
   record('PASS batch generation skips legacy polish and retains it');
   record('PASS legacy/stale saved polish skipped without deleting cache; renderer actually generates report');
   const latest=fs.readFileSync(result.reportFile);
   const stale=await ev('window.labAPI.runGenerate(currentExp.path,{},{},{结论:"旧结果10.48 MΩ"},false,"",null)');
   assert.equal(stale.ok,false);assert.deepEqual(fs.readFileSync(result.reportFile),latest);
   record('PASS '+name+' blank form / current context / actual IPC generation / stale polish rejected');
  }
  record('PASS packaged renderer has 27 experiments and blank factory form policy');app.exit(0);
 }catch(error){record('FAIL '+error.stack);app.exit(1);}
});
