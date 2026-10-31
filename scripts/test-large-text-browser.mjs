import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/verification/large-text-ui');
fs.mkdirSync(out,{recursive:true});
const baseline=process.argv.includes('--baseline'),production=process.argv.includes('--production'),observations=[];
const b=await openBrowserTest(root,'src/main.ts','<main id="app"></main>',{production});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 if(!production)await b.evaluate("import('/test.mjs').then(()=>true)");await b.wait("!!document.querySelector('[data-open]')");
 // Simulated text-only scaling retains every element's original typographic ratio.
 // It is not Android accessibility-font or IME device acceptance.
 const restore=`(()=>{for(const e of document.querySelectorAll('[data-test-font]')){e.style.fontSize=e.dataset.testFont;delete e.dataset.testFont;}})()`;
 const scale=factor=>`(()=>{const nodes=[...document.body.querySelectorAll('*')].filter(e=>e instanceof HTMLElement&&e.getClientRects().length);const sizes=nodes.map(e=>parseFloat(getComputedStyle(e).fontSize));nodes.forEach((e,i)=>{e.dataset.testFont=e.style.fontSize;e.style.fontSize=(sizes[i]*${factor})+'px';});})()`;
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
   await delay(220);await b.evaluate(scale(2));await b.cdp('Emulation.setPageScaleFactor',{pageScaleFactor:1});await delay(150);
   const state={width,height,page,scale:2,...await b.evaluate(measure)};observations.push(state);
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
 fs.writeFileSync(path.join(out,baseline?'baseline.json':production?'production-results.json':'results.json'),JSON.stringify({scope:'Actual application, simulated 200% text-only font scaling; no physical font/IME acceptance',production,observations},null,2));
 const failed=observations.filter(s=>s.pageOverflow||s.dialogOverflow||s.dialogOutside||s.footerOutside||s.toolbarOverflow||s.clippedButtons.length);
 console.log(JSON.stringify({cases:observations.length,failed},null,2));
 if(!baseline)assert.equal(failed.length,0);
 assert.equal(b.errors.length,0);
}finally{await b.close();}
