import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {android,connectAndroid,pause} from './lib/android-cdp.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/verification/native-system-font-'+Date.now());
fs.mkdirSync(out,{recursive:true});
const baseline=process.argv.includes('--baseline'),production=true,observations=[];
const pkg='com.labmaker.app.acceptance',beforeFont=android('shell','settings','get','system','font_scale').toString().trim();let c,installed=false;
const b={evaluate:expression=>c.ev(expression),wait:expression=>c.wait(expression),cdp:(method,params)=>c.call(method,params),errors:[]};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 assert.equal(android('shell','pm','list','packages',pkg).toString().trim(),'');android('install','android/app/build/outputs/apk/acceptance/app-acceptance.apk');installed=true;
 android('shell','settings','put','system','font_scale','2.0');android('shell','am','start','-n',pkg+'/com.labmaker.app.MainActivity');
 for(let i=0;i<80;i++){try{c=await connectAndroid(9266,0,pkg);await c.wait("!!document.querySelector('[data-open]')");break}catch(error){c?.close();c=null;if(i===79)throw error;await pause(200)}}
 c.onEvent(e=>{if(e.method==='Runtime.exceptionThrown')b.errors.push(e.params.exceptionDetails.text)});await c.call('Runtime.enable');
 await c.ev(`(()=>{const original=Capacitor.nativePromise;Capacitor.nativePromise=function(plugin,method,args){if(!['Filesystem','App'].includes(plugin)&&!(plugin==='LabAI'&&method==='status'))return Promise.reject(Error('External action blocked in system-font acceptance'));return original.call(this,plugin,method,args)}})()`);
await b.wait("!!document.querySelector('[data-open]')");
 const restore='true';
 const measure=`(()=>{const dialog=document.querySelector('dialog[open]'),scope=dialog||document.querySelector('#app');const tool=document.querySelector('.editor-bottom');const rect=dialog?.getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight,visualWidth:visualViewport.width,visualHeight:visualViewport.height},dialogBounds:rect?{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}:null,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,dialogOverflow:!!dialog&&dialog.scrollWidth>dialog.clientWidth+1,dialogOutside:!!rect&&(rect.left<-1||rect.right>innerWidth+1||rect.top<-1||rect.bottom>innerHeight+1),footerOutside:!!dialog&&[...dialog.querySelectorAll('.report-footer,.modal-actions')].some(e=>e.getBoundingClientRect().bottom>dialog.getBoundingClientRect().bottom+1),toolbarOverflow:!!tool&&tool.scrollWidth>tool.clientWidth+1,clippedButtons:[...scope.querySelectorAll('button,.button')].filter(e=>e.getClientRects().length&&e.clientWidth&&e.scrollWidth>e.clientWidth+2).map(e=>e.textContent.trim()).slice(0,8)}})()`;
 for(const [width,height] of [[320,568],[320,320],[568,320],[768,1024],[1024,768]]){
  await b.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  for(const page of ['home','profile','settings','help/guide','report-queue','report-sections','ai-history','editor','ai-config','editor-menu','report-generate','report-charts','report-ai']){
   await b.evaluate(restore);await b.evaluate("document.querySelectorAll('dialog[open]').forEach(d=>d.close());location.hash='#/home'");await b.wait("!!document.querySelector('[data-open]')");
   if(['editor','editor-menu'].includes(page)||page.startsWith('report-')){
    // The queue/sections routes below are ordinary pages, not report tabs.
    if(['report-queue','report-sections'].includes(page)){
     await b.evaluate(`location.hash=${JSON.stringify('#/'+page)}`);await b.wait(`!!document.querySelector('${page==='report-queue'?'[data-queue-id]':'[data-sections-search]'}')`);
    }else{
    await b.evaluate("document.querySelector('[data-open]').click()");await b.wait("!!document.querySelector('input.measurement')");
    if(page==='editor-menu'){await b.evaluate("document.querySelector('[data-action=more]').click()");await b.wait("!!document.querySelector('dialog[open] .menu-actions')");}
    if(page.startsWith('report-')){await b.evaluate("document.querySelector('[data-action=report]').click()");await b.wait("!!document.querySelector('dialog[open] [data-report-tab]')");const tab=page.slice('report-'.length);await b.evaluate(`document.querySelector('[data-report-tab=${tab}]').click()`);await b.wait("document.querySelector('#report-body').children.length>0");}
    }
   }else if(page==='ai-config'){
    await b.evaluate("location.hash='#/settings'");await b.wait("!!document.querySelector('[data-action=ai-config]')");await b.evaluate("document.querySelector('[data-action=ai-config]').click()");await b.wait("!!document.querySelector('#ai-key')&&!document.querySelector('#ai-config-fields').disabled");
   }else{
    await b.evaluate(`location.hash=${JSON.stringify('#/'+page)}`);
    const ready={home:'[data-open]',profile:'[data-profile]',settings:'[data-action=ai-config]','help/guide':'[data-help-content]','report-queue':'[data-queue-id]','report-sections':'[data-sections-search]','ai-history':'[data-history-action=refresh]'}[page];
    await b.wait(`!!document.querySelector(${JSON.stringify(ready)})`);
   }
   await delay(220);assert.equal(await b.evaluate('parseFloat(getComputedStyle(document.body).fontSize)'),30,'Android 200% font must actually remain active in this viewport');await b.cdp('Emulation.setPageScaleFactor',{pageScaleFactor:1});await delay(150);
   const state={width,height,page,scale:2,...await b.evaluate(measure)};observations.push(state);
   if(page==='report-generate'){
    state.headerReading=await b.evaluate(`(()=>{const header=document.querySelector('dialog[open] .report-header'),title=header.querySelector('h2'),walker=document.createTreeWalker(title,NodeFilter.SHOW_TEXT),ranges=[];while(walker.nextNode()){const node=walker.currentNode;for(let i=0;i<node.length;i++){if(!node.textContent[i].trim())continue;const r=document.createRange();r.setStart(node,i);r.setEnd(node,i+1);ranges.push(r)}}const seen=new Set(),limit=header.scrollHeight-header.clientHeight,step=Math.max(1,Math.floor(header.clientHeight/4));for(let top=0;top<=limit+step;top+=step){header.scrollTop=Math.min(top,limit);const box=header.getBoundingClientRect();ranges.forEach((range,index)=>{const r=range.getBoundingClientRect();if(r.top>=box.top-1&&r.bottom<=box.bottom+1&&r.left>=box.left-1&&r.right<=box.right+1)seen.add(index)})}header.scrollTop=0;return {characters:ranges.length,readable:seen.size,scrollable:limit>0,scrollHeight:header.scrollHeight,clientHeight:header.clientHeight}})()`);
    assert.ok(state.headerReading.characters>0);assert.equal(state.headerReading.readable,state.headerReading.characters,'Every title character must be readable by scrolling the bounded header');
   }
   if(!baseline&&(['ai-config','editor-menu'].includes(page)||['report-generate','report-charts','report-ai'].includes(page))){
    const unreachable=await b.evaluate(`(()=>{const dialog=document.querySelector('dialog[open]');return [...dialog.querySelectorAll('button')].filter(e=>e.checkVisibility()&&!e.disabled).flatMap(e=>{e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return y>=0&&y<innerHeight&&x>=0&&x<innerWidth&&(hit===e||e.contains(hit))?[]:[{text:e.textContent.trim(),x,y,hit:hit?.textContent.trim().slice(0,50)}];});})()`);
    if(unreachable.length){const shot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`unreachable-${width}x${height}-${page}.png`),Buffer.from(shot.data,'base64'));}
    assert.deepEqual(unreachable,[],`${width}x${height} ${page}: dialog actions must be reachable after scrolling`);
    await b.evaluate("document.querySelector('dialog[open] .report-footer,dialog[open] .modal-actions')?.scrollTo(0,0)");
    if(page.startsWith('report-'))assert.equal(await b.evaluate("(()=>{const e=document.querySelector('[data-report=generate]'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return hit===e||e.contains(hit);})()"),true,'primary generation action remains visible without scrolling the footer');
   }
   if(state.pageOverflow||state.dialogOverflow||state.dialogOutside||state.footerOutside||state.toolbarOverflow||state.clippedButtons.length||['ai-config','editor-menu','report-generate'].includes(page)){const screenshot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`${baseline?'before':production?'production':'after'}-${width}x${height}-${page.replaceAll('/','-')}.png`),Buffer.from(screenshot.data,'base64'));}
  }
 }
 fs.writeFileSync(path.join(out,baseline?'baseline.json':production?'production-results.json':'results.json'),JSON.stringify({scope:'Real Android system font_scale=2.0; five emulated viewport sizes in the native WebView, not physical phone/tablet acceptance',production,observations},null,2));
 const failed=observations.filter(s=>s.pageOverflow||s.dialogOverflow||s.dialogOutside||s.footerOutside||s.toolbarOverflow||s.clippedButtons.length);
 console.log(JSON.stringify({cases:observations.length,failed},null,2));
 if(!baseline)assert.equal(failed.length,0);
 assert.equal(b.errors.length,0);
}finally{
 if(c){await c.call('Emulation.clearDeviceMetricsOverride').catch(()=>{});c.close();}
 if(beforeFont==='null')android('shell','settings','delete','system','font_scale');else android('shell','settings','put','system','font_scale',beforeFont);
 if(installed)android('uninstall',pkg);android('shell','am','start','-n','com.labmaker.app/.MainActivity');
 fs.writeFileSync(path.join(out,'cleanup.json'),JSON.stringify({fontScaleRestored:android('shell','settings','get','system','font_scale').toString().trim()===beforeFont,helperRemoved:android('shell','pm','list','packages',pkg).toString().trim()===''},null,2));
}
