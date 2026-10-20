/* DeepSeek walkthrough; the final step reuses the actual settings form and actions. */
(()=>{
 'use strict';
 const STORAGE='deepseekTutorialProgress.v1';
 const links={home:'https://www.deepseek.com/',platform:'https://platform.deepseek.com/usage',keys:'https://platform.deepseek.com/api_keys',docs:'https://api-docs.deepseek.com/zh-cn/',errors:'https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/'};
 const steps=[['登录开放平台','找到正确的 API 入口'],['检查 API 余额','在开放平台查看可用余额'],['创建 API Key','获取自己的调用密钥'],['配置实验搭子','填入参数，测试并保存']];
 const byId=id=>document.getElementById(id);
 const configPanel=byId('panelApiConfig'),testSection=byId('btnTestApi').parentElement,saveButton=byId('btnSaveSettings');
 const shared=[configPanel,testSection,saveButton].map(node=>{const anchor=document.createComment('tutorial shared settings position');node.before(anchor);return {node,anchor};});
 function parkConfig(){for(const {node,anchor} of shared)anchor.after(node);}
 let page,current=0,completed=new Set(),previousInert=false,noticeTimer;
 function loadProgress(){try{const p=JSON.parse(localStorage.getItem(STORAGE));completed=new Set(Array.isArray(p)?p.filter(n=>Number.isInteger(n)&&n>=0&&n<4):[]);}catch{completed=new Set();}}
 function saveProgress(){try{localStorage.setItem(STORAGE,JSON.stringify([...completed].sort()));}catch{}}
 const external=(name,label)=>`<button type="button" class="btn btn-outline" data-ds-link="${name}">${label} <span aria-hidden="true">↗</span></button>`;
 const eyebrow=text=>`<div class="ds-eyebrow">${text}</div>`;
 function create(){
  page=document.createElement('section');page.id='apiTutorialPage';page.className='api-tutorial';page.hidden=true;page.setAttribute('aria-label','DeepSeek API 配置教程');
  page.innerHTML=`<header class="ds-windowbar"><span>实验搭子 <span class="ds-divider">/</span> 配置教程</span><div class="ds-drag"></div><div class="window-controls"><button type="button" class="win-btn" data-ds-window="minimize" aria-label="最小化">−</button><button type="button" class="win-btn" data-ds-window="toggleMaximize" aria-label="最大化">□</button><button type="button" class="win-btn win-close" data-ds-window="close" aria-label="关闭应用">×</button></div></header>
   <header class="ds-header"><div><span class="ds-brandmark" aria-hidden="true">物</span><span>DeepSeek API 配置教程</span></div></header>
   <div class="ds-layout"><aside class="ds-sidebar"><div class="ds-roadmap-label">跟着步骤，完成第一次配置</div><nav aria-label="教程步骤" id="dsSteps"></nav><div class="ds-progress"><span id="dsProgressText"></span><progress id="dsProgress" max="4" value="0" aria-label="教程完成进度"></progress><button type="button" class="btn btn-ghost btn-sm" id="dsRestart">重新开始教程</button></div><div class="ds-sidebar-bottom">教程可离线阅读<br>官网操作在浏览器中完成</div></aside>
   <main class="ds-main" id="dsMain"><div id="dsLesson"></div><footer class="ds-footer"><button type="button" class="btn btn-outline" id="dsPrev">上一步</button><button type="button" class="btn btn-primary" id="dsNext">我已完成，下一步 →</button></footer><p class="ds-source">内容依据你的教程草稿与 DeepSeek 官方文档整理 · 核对于 2026-10-20 <button type="button" data-ds-link="docs">查看官方文档 ↗</button></p></main></div><div class="ds-announcement" id="dsAnnouncement" role="status" aria-live="polite"></div>`;
  document.body.append(page);
  byId('dsPrev').onclick=()=>render(current-1);
  byId('dsNext').onclick=()=>{completed.add(current);saveProgress();if(current<3)render(current+1);else{updateNav();close();}};
  byId('dsRestart').onclick=()=>{completed.clear();saveProgress();render(0);};
  page.addEventListener('click',async e=>{
   const target=e.target.closest('button');if(!target)return;
   if(target.dataset.dsLink){const url=links[target.dataset.dsLink];if(url){try{const r=await window.labAPI.openExternal(url);if(!r?.ok)throw Error(r?.error||'请检查默认浏览器');announce('已在浏览器中打开官网，完成后回到这里继续。');}catch{announce('无法打开浏览器，请使用下方官方文档或手动打开对应网址。');}}return;}
   if(target.dataset.dsWindow){window.labAPI[target.dataset.dsWindow]();return;}
   if(target.dataset.dsStep!==undefined){render(Number(target.dataset.dsStep));return;}
   if(target.dataset.dsCopy){try{const r=await window.labAPI.copyText(target.dataset.dsCopy);if(!r?.ok)throw Error();announce('已复制 '+target.dataset.dsCopy);}catch{announce('复制失败，请手动选择并复制。');}return;}
   const action=target.dataset.dsAction;
   if(action==='apply')await applyPreset();
   if(target.dataset.dsProblem)showProblem(target.dataset.dsProblem);
  });
  page.addEventListener('keydown',e=>{
   if(document.querySelector('.modal-overlay.show'))return;
   if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
   if(e.key==='Tab'){const focusable=[...page.querySelectorAll('button,input,select,a,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  });
 }
 function announce(text){clearTimeout(noticeTimer);byId('dsAnnouncement').textContent=text;noticeTimer=setTimeout(()=>byId('dsAnnouncement').textContent='',6000);}
 function updateNav(){
  byId('dsSteps').innerHTML=steps.map(([title,subtitle],i)=>`<button type="button" class="ds-step ${i===current?'active':''} ${completed.has(i)?'complete':''}" data-ds-step="${i}" ${i===current?'aria-current="step"':''}><span class="ds-step-number">${completed.has(i)?'✓':String(i+1).padStart(2,'0')}</span><span><strong>${title}</strong><small>${subtitle}</small></span></button>`).join('');
  byId('dsProgressText').textContent=`已完成 ${completed.size} / 4 步`;byId('dsProgress').value=completed.size;
 }
 function render(index){
  current=Math.max(0,Math.min(3,index));updateNav();byId('dsPrev').disabled=current===0;byId('dsNext').textContent=current===3?'我已完成配置，返回 AI 服务':'我已完成，下一步 →';
  const heading=`${eyebrow(`第 ${current+1} 步 / 共 4 步`)}<h1 tabindex="-1">${steps[current][0]}</h1>`;
  const lessons=[
   `<section class="ds-guidance"><p class="ds-lead">打开 DeepSeek 官网，选择<strong>「API 开放平台」</strong>，<br>然后按官网提示注册或登录。</p><div class="ds-official-actions">${external('home','打开 DeepSeek 官网')}${external('platform','直接打开开放平台')}</div></section>`,
   `<section class="ds-guidance"><p class="ds-lead">登录后，查看<strong> API 可用余额</strong>。<br>余额不足时，再按官网提示充值。</p><div class="ds-official-actions">${external('platform','打开用量与余额页面')}</div><p class="ds-takeaway">已有可用余额，可以直接进入下一步；金额和价格以官网为准。</p></section>`,
   `<section class="ds-guidance"><p class="ds-lead">进入<strong>「API keys」</strong>，选择<strong>「创建 API Key」</strong>。<br>复制密钥，留给下一步的应用配置。</p><div class="ds-official-actions">${external('keys','打开 API keys 页面')}</div><p class="ds-takeaway">请妥善保管密钥，不要发到群聊、截图或报告中。</p></section>`,
   `<p class="ds-lead">选择 DeepSeek，填入自己的 API Key、API 地址和模型名称。</p>
    <div class="ds-config-reference"><div><span>API 地址</span><code>https://api.deepseek.com</code><button class="btn btn-ghost btn-sm" type="button" data-ds-copy="https://api.deepseek.com">复制地址</button></div><div><span>模型名称</span><code>deepseek-flash</code><button class="btn btn-ghost btn-sm" type="button" data-ds-copy="deepseek-flash">复制模型名</button></div></div>
    <section class="ds-config-section"><div class="ds-config-section-heading"><h2>API 配置</h2><button type="button" class="btn btn-outline btn-sm" data-ds-action="apply">填入推荐参数</button></div><div id="dsSettingsMount" class="ds-settings-mount"></div><div class="ds-config-actions"><div id="dsTestMount" class="ds-test-mount"></div><div id="dsSaveMount"></div></div></section>
    <p class="ds-takeaway">填写后先测试连接，再保存配置。测试会调用一次模型，可能产生少量费用。</p>
    <section class="ds-troubleshoot"><h2>遇到问题，点这里检查</h2><div class="ds-problem-choices"><button type="button" data-ds-problem="auth">401 · 密钥错误</button><button type="button" data-ds-problem="balance">402 · 余额不足</button><button type="button" data-ds-problem="rate">429 · 请求过快</button><button type="button" data-ds-problem="address">地址或模型错误</button><button type="button" data-ds-problem="network">连接超时</button></div><p id="dsProblemDetail" role="status">选择你遇到的情况，查看处理方式。</p>${external('errors','查看官方错误码')}</section>`
  ];
  parkConfig();byId('dsLesson').innerHTML=heading+lessons[current];if(current===3){configPanel.hidden=false;byId('dsSettingsMount').append(configPanel);byId('dsTestMount').append(testSection);byId('dsSaveMount').append(saveButton);}byId('dsMain').scrollTop=0;byId('dsAnnouncement').textContent='';byId('dsLesson').querySelector('h1').focus({preventScroll:true});
 }
 function showProblem(problem){
  const text={auth:'重新复制自己的 API Key，确认没有遗漏字符，也没有把网页登录密码填进来。已撤销的密钥需要重新创建。',balance:'在 DeepSeek 开放平台查看 API 余额；余额不足时按需充值，再重新测试。',rate:'等待片刻再试，避免同时重复测试或并发发送大量请求。',address:'选择 DeepSeek；地址填写 https://api.deepseek.com，模型填写 deepseek-flash。也可以在 API 配置中点击「获取模型」核对可用名称。',network:'检查网络和 API 地址，稍后重试。网页版能打开不等于 API 一定可达；反复失败时查看服务商状态。'};
  byId('dsProblemDetail').textContent=text[problem]||'';page.querySelectorAll('[data-ds-problem]').forEach(b=>b.classList.toggle('active',b.dataset.dsProblem===problem));
 }
 function close(){
  parkConfig();page.hidden=true;document.querySelector('.app').inert=previousInert;
  openModal('settingsModal');switchSettingsPane('ai');if(byId('panelApiConfig').hidden)toggleAiConfigPanel('api');byId('btnApiTutorial').focus({preventScroll:true});
 }
 async function applyPreset(){
  const provider=byId('selectProvider'),key=byId('inputApiKey');
  const switching=provider.value!=='deepseek'||!/^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/.test(byId('inputApiUrl').value.trim());
  if(switching&&key.value){if(!await appConfirm('切换到 DeepSeek 将清空当前尚未保存的密钥输入。已经保存的密钥保留。是否继续？'))return;key.value='';}
  provider.value='deepseek';byId('inputApiUrl').value='https://api.deepseek.com';provider.dispatchEvent(new Event('change',{bubbles:true}));byId('inputModel').value='deepseek-flash';
  showToast('success','已填入推荐参数','粘贴自己的 API Key，测试成功后点击保存。');key.focus({preventScroll:true});
 }
 function open(){
  if(page&&!page.hidden)return;
  if(!page)create();loadProgress();closeModal('settingsModal');previousInert=document.querySelector('.app').inert;document.querySelector('.app').inert=true;page.hidden=false;render([0,1,2,3].find(i=>!completed.has(i))??3);
 }
 function bind(){byId('btnApiTutorial').addEventListener('click',open);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
