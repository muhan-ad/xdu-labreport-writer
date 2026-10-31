import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
test('offline frame CSP hashes the browser-normalized inline script on Windows',()=>{
 const html=fs.readFileSync(new URL('../public/ai-plot/frame.html',import.meta.url),'utf8'),script=/<script>([\s\S]*?)<\/script>/.exec(html)?.[1];assert.ok(script);const normalized=script.replace(/\r\n?/g,'\n'),hash=crypto.createHash('sha256').update(normalized).digest('base64');assert.ok(html.includes("'sha256-"+hash+"'"));assert.ok(html.includes("connect-src 'none'"));assert.ok(!html.includes("'unsafe-inline'"));assert.ok(!script.includes('\r'));
});
