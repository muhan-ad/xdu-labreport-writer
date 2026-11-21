import fs from 'node:fs';
import assert from 'node:assert/strict';
let network=0,put=0;const saved=new Map();
globalThis.window={addEventListener(){}};globalThis.caches={open:async()=>({match:async k=>saved.get(k)?.clone(),delete:async k=>saved.delete(k),put:async(k,v)=>{put++;saved.set(k,v.clone())}})};
globalThis.FontFace=class {constructor(name,bytes){this.bytes=bytes;}async load(){if(this.bytes.byteLength<1000)throw Error();return this;}};
globalThis.fetch=async()=>{network++;return new Response(new Uint8Array(1200));};
const first=await import('../src/platform/report-fonts.ts?fonttest=1');const fonts=await first.ensureReportFonts();assert.equal(fonts.length,3);assert.equal(network,3);assert.equal(put,3);
const second=await import('../src/platform/report-fonts.ts?fonttest=2');await second.ensureReportFonts();assert.equal(network,3);
saved.clear();globalThis.fetch=async()=>{throw Error('offline');};const third=await import('../src/platform/report-fonts.ts?fonttest=3');assert.equal((await third.ensureReportFonts()).length,0);
console.log('PASS font download/cache reuse/offline fallback');

