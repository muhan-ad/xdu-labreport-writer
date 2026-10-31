import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/verification/entry-viewport-ui');fs.mkdirSync(out,{recursive:true});
const b=await openBrowserTest(root,'src/main.ts','<main id="app"></main>'),checks=[];
if(process.argv.includes('--trace')){const evaluate=b.evaluate;b.evaluate=async expression=>{console.log('entry-evaluate',expression.slice(0,180));return evaluate(expression);};}
try{
 await b.cdp('Page.bringToFront');
 await b.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await b.evaluate(`(()=>{const v=new EventTarget();Object.assign(v,{height:844,width:390,offsetTop:0,scale:1});Object.defineProperty(window,'visualViewport',{value:v,configurable:true});window.setTestViewport=(height,offsetTop=0,scale=1)=>{Object.assign(v,{height,offsetTop,scale});v.dispatchEvent(new Event('resize'));};})()`);
 await b.evaluate("import('/test.mjs').then(()=>true)");await b.wait("!!document.querySelector('[data-open]')");await b.evaluate("document.querySelector('[data-open]').click()");await b.wait("!!document.querySelector('input.measurement')");
 await new Promise(r=>setTimeout(r,300));await b.evaluate("document.querySelector('input.measurement').focus();setTestViewport(360)");await new Promise(r=>setTimeout(r,300));
 const keyboard=await b.evaluate("({bottom:document.querySelector('.editor-bottom').getBoundingClientRect().bottom,visible:visualViewport.height,overflow:document.documentElement.scrollWidth>innerWidth+1})");
 if(process.argv.includes('--baseline')){fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify({scope:'Simulated visual-only keyboard resize; not a physical Android keyboard',keyboard},null,2));console.log(JSON.stringify(keyboard));}
 else{
 assert.ok(keyboard.bottom<=361,JSON.stringify(keyboard));assert.equal(keyboard.overflow,false);checks.push('simulated visual-only keyboard keeps toolbar inside visible 360px');
 await b.evaluate(`(()=>{const i=document.querySelector('input.measurement');i.value='12';i.setSelectionRange(1,1);i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-action=exponent-token]').click();})()`);
 assert.equal(await b.evaluate("document.querySelector('input.measurement').value"),'1e2');checks.push('exponent tool inserts at caret and preserves active field');
 await b.evaluate("document.querySelector('input.measurement').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))");assert.equal(await b.evaluate("document.activeElement===document.querySelector('input.measurement')"),true);checks.push('IME composition Enter does not advance');
 await b.evaluate("document.querySelector('input.measurement').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");assert.equal(await b.evaluate("document.activeElement===document.querySelectorAll('input.measurement')[1]"),true);checks.push('keyboard Enter advances in actual editor');
 await b.evaluate("setTestViewport(844,0,2)");await new Promise(r=>setTimeout(r,80));assert.equal(await b.evaluate("document.documentElement.classList.contains('viewport-managed')"),false);checks.push('pinch zoom is not counteracted');
 for(const [width,height] of [[320,568],[360,640],[390,844],[768,1024],[1024,768],[844,390],[1280,800]]){
  await b.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await b.evaluate(`setTestViewport(${height})`);await new Promise(r=>setTimeout(r,100));
  assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,`${width}x${height}`);
  assert.ok(await b.evaluate('document.querySelector(".editor-bottom").getBoundingClientRect().bottom<=innerHeight+1'));
  const shot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,`${width}x${height}.png`),Buffer.from(shot.data,'base64'));
 }
 checks.push('seven portrait, landscape and tablet sizes have no page horizontal overflow');
 await b.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:360,deviceScaleFactor:1,mobile:true});await b.evaluate('setTestViewport(360)');await new Promise(r=>setTimeout(r,80));assert.equal(await b.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--viewport-bottom').trim()"),'0px');checks.push('native layout resize is not compensated twice');
 await b.evaluate(`(()=>{const list=[...document.querySelectorAll('input.measurement')],last=list.at(-1);last.closest('details').open=true;last.focus();last.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);await b.wait("document.querySelector('#toast').textContent.includes('最后一项')");assert.equal(await b.evaluate("document.activeElement.matches('input.measurement')"),false);checks.push('last item Enter saves and completes entry');
 await b.evaluate("location.hash='#/settings'");await b.wait("!!document.querySelector('[data-action=ai-config]')");await b.evaluate("document.querySelector('[data-action=ai-config]').click()");await b.wait("!!document.querySelector('#ai-key')&&!document.querySelector('#ai-config-fields').disabled");
 await b.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await b.evaluate("setTestViewport(360);document.querySelector('#ai-key').focus()");await new Promise(r=>setTimeout(r,250));
 assert.ok(await b.evaluate("document.querySelector('dialog[open]').getBoundingClientRect().bottom<=361"));assert.ok(await b.evaluate("document.querySelector('dialog[open] .report-footer').getBoundingClientRect().bottom<=361"));const shot=await b.cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'ai-keyboard-simulated.png'),Buffer.from(shot.data,'base64'));checks.push('actual AI settings sheet retains its footer inside simulated keyboard viewport without any API request');
 await b.evaluate("document.querySelector('[data-ai=close]').click();location.hash='#/home'");await b.wait("!!document.querySelector('[data-open]')");await b.evaluate("document.querySelector('[data-open]').click()");await b.wait("!!document.querySelector('input.measurement')");assert.equal(await b.evaluate("document.querySelector('input.measurement').value"),'1e2');checks.push('saved partial scientific draft survives editor reopen');
 assert.equal(b.errors.length,0);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'Actual editor in isolated Chromium; visualViewport keyboard and zoom are simulated, no physical keyboard verification',checks},null,2));console.log(JSON.stringify({passed:checks.length}));
 }
}finally{await b.close();}
