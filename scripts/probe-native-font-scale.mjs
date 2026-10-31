// Observe real Android accessibility font settings, then restore them exactly.
import fs from 'node:fs';import assert from 'node:assert/strict';
import {android,connectAndroid,pause} from './lib/android-cdp.mjs';
const out='artifacts/verification/native-font-probe-'+Date.now(),pkg='com.labmaker.app.acceptance';fs.mkdirSync(out,{recursive:true});
const original=android('shell','settings','get','system','font_scale').toString().trim();let c,installed=false;const measurements=[];
async function attach(){for(let i=0;i<80;i++){try{c=await connectAndroid(9265,0,pkg);await c.wait("!!document.querySelector('[data-open]')");return;}catch(e){c?.close();c=null;if(i===79)throw e;await pause(200)}}}
try{
 assert.equal(android('shell','pm','list','packages',pkg).toString().trim(),'');android('install','android/app/build/outputs/apk/acceptance/app-acceptance.apk');installed=true;
 for(const scale of ['1.0','2.0']){
  c?.close();c=null;android('shell','settings','put','system','font_scale',scale);android('shell','am','start','-n',pkg+'/com.labmaker.app.MainActivity');await pause(500);await attach();
  const m=await c.ev(`(()=>{const title=document.querySelector('.app-header h1'),button=document.querySelector('[data-open]'),range=document.createRange();range.selectNodeContents(title);const r=range.getBoundingClientRect();return {width:innerWidth,height:innerHeight,titleFont:getComputedStyle(title).fontSize,titleWidth:r.width,titleHeight:r.height,buttonHeight:button.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth+1}})()`);
  measurements.push({systemScale:scale,...m});fs.writeFileSync(out+'/'+scale+'.png',android('exec-out','screencap','-p'));
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify({original,measurements},null,2));console.log(JSON.stringify({out,measurements}));
}finally{
 c?.close();if(original==='null')android('shell','settings','delete','system','font_scale');else android('shell','settings','put','system','font_scale',original);
 if(installed)android('uninstall',pkg);android('shell','am','start','-n','com.labmaker.app/.MainActivity');
}
