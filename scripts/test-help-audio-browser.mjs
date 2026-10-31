import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts/verification/help-audio-ui');fs.mkdirSync(out,{recursive:true});
const b=await openBrowserTest(root,'tests/fixtures/help-credits-ui.ts','<main id="app"><div id="help-credits-host"></div></main>',{guideAudio:true}),checks=[];
async function click(selector){const p=await b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await b.cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await b.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});}
try{
 await b.evaluate("window.audioTrace={created:0,started:0,closed:0,contexts:[]};window.OriginalAudioContext=window.AudioContext;window.AudioContext=class extends OriginalAudioContext{constructor(...args){super(...args);audioTrace.created++;audioTrace.contexts.push(this);}createBufferSource(){const s=super.createBufferSource(),start=s.start.bind(s);s.start=(...args)=>{audioTrace.started++;return start(...args);};return s;}close(){audioTrace.closed++;return super.close();}};");
 await b.evaluate("import('/test.mjs').then(m=>{window.fixture=m.createHelpCreditsFixture();fixture.help();return true;})");
 assert.equal(await b.evaluate("performance.getEntriesByType('resource').filter(r=>r.name.includes('/guide-audio/')).length"),0);checks.push('help entry does not load or decode recording');
 await click('[data-help-content] summary');await b.wait("document.querySelector('[data-help-content] details').open&&document.querySelector('.help-typing')");
 assert.equal(await b.evaluate("document.querySelector('.help-answer-full').textContent===document.querySelector('[data-help-answer]').dataset.helpAnswer"),true);
 await click('[data-help-complete]');assert.equal(await b.evaluate("document.querySelector('[data-help-answer]').textContent===document.querySelector('[data-help-answer]').dataset.helpAnswer"),true);
 await b.wait("performance.getEntriesByType('resource').filter(r=>r.name.includes('/guide-audio/')).length===2");
 await b.wait("document.querySelector('[data-help-sound]').dataset.soundState==='ready'");checks.push('real recording decodes on gesture and AudioContext is running; answer can finish immediately with accessible full text');
 await click('[data-help-sound]');assert.equal(await b.evaluate("localStorage.getItem('guide-typing-sound')"),'off');
 await b.evaluate("fixture.credits();import('/test.mjs').then(m=>{window.fixture=m.createHelpCreditsFixture();fixture.help();return true;})");assert.equal(await b.evaluate("document.querySelector('[data-help-sound]').textContent"),'音效：关');
 await click('[data-help-content] summary');await b.wait("document.querySelector('.help-typing')");await b.wait("!document.querySelector('.help-typing')");
 assert.equal(await b.evaluate("document.querySelector('[data-help-answer]').textContent===document.querySelector('[data-help-answer]').dataset.helpAnswer"),true);checks.push('mute persists across page reopen without disabling animation');
 await b.evaluate("window.savedFetch=window.fetch;window.fetch=(url,options)=>String(url).includes('/guide-audio/')?Promise.reject(Error('missing audio')):savedFetch(url,options)");
 await click('[data-help-sound]');await b.wait("document.querySelector('[data-help-sound]').dataset.soundState==='failed'");
 await b.evaluate("window.fetch=window.savedFetch");await click('[data-help-sound]');await b.wait("document.querySelector('[data-help-sound]').dataset.soundState==='ready'");
 checks.push('missing recording shows recoverable error and explicit retry decodes original audio');
 assert.equal(await b.evaluate('audioTrace.started>0'),true);
 await b.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");
 await b.wait("audioTrace.contexts.at(-1).state==='suspended'");assert.equal(await b.evaluate("document.querySelector('.help-typing')===null"),true);
 await b.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))");
 checks.push('simulated visibility event suspends real audio context and finishes text');
 await click('[data-help-sound]');
 await click('[data-help-content] summary');await b.wait("!document.querySelector('[data-help-content] details').open");
 await click('[data-help-content] summary');await click('[data-help-content] summary');await b.wait("!document.querySelector('[data-help-content] details').open");
 assert.equal(await b.evaluate("document.querySelector('.help-typing')===null"),true);checks.push('quick open/close reverses disclosure motion and finishes pending text');
 await b.evaluate("fixture.help();document.querySelector('[data-help-content] details').open=true");await b.wait("document.querySelector('.help-typing')");await b.evaluate('fixture.credits()');await b.wait("document.querySelectorAll('.credit-row').length>0");assert.equal(await b.evaluate("document.querySelector('.help-typing')===null"),true);checks.push('navigation clears pending reveal and audio resources');
 assert.equal(await b.evaluate('audioTrace.closed>0'),true);
 for(const width of [320,360,390,768,1024,1280]){
  await b.cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});await b.evaluate("fixture.help();document.querySelector('[data-help-content] details').open=true");await b.wait("document.querySelector('.help-typing')");await click('[data-help-complete]');
  assert.equal(await b.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'help overflow '+width);
  fs.writeFileSync(path.join(out,'school-'+width+'.png'),Buffer.from((await b.cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }checks.push('full answers and sound controls fit six phone/tablet widths');
 assert.equal(b.errors.length,0);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,scope:'Production help component, real local recording, owned desktop Chromium; no device listening acceptance'},null,2));console.log(JSON.stringify({passed:checks.length}));
}finally{await b.close();}
