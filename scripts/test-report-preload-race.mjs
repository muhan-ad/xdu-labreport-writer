import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const b=await openBrowserTest(process.cwd(),'tests/fixtures/report-preload-race.ts','<main id="host"></main>');
try{
 await b.evaluate("import('/test.mjs').then(m=>{window.f=m.createFixture();f.start();f.mount()})");
 await b.wait("f.state().text.includes('2500000000')");
 await b.evaluate('f.cancel()');let state=await b.evaluate('f.state()');assert.equal(state.invalidations,1);assert.equal(state.clears,0);assert.equal(state.logins,0);assert.match(state.text,/2500000000/);
 await b.evaluate('f.resume()');await b.evaluate('f.again()');state=await b.evaluate('f.state()');assert.equal(state.logins,0);assert.equal(state.clears,0);assert.match(state.text,/2500000000/);
 console.log(JSON.stringify({passed:1,scenario:'cancel while reattaching existing report session'}));
}finally{await b.close();}
