// Reproducible development preprocessing, never shipped to the phone.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {openBrowserTest} from './browser-test-harness.mjs';
const root=path.resolve(import.meta.dirname,'..'),source=path.join(root,'scripts/assets/guide-audio');
const hashes={'keyboard.ogg':'10390a4325fe218b005c509cac28c90bdd21c16bfcc303fe57d51d2588efd047','config.json':'424e3f7583f65341d1dc03251ff5f6bd6d42f03e0c10f28845b7fb4484cc5823'};
for(const [name,hash] of Object.entries(hashes))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex'),hash,'Original recording changed');
const b=await openBrowserTest(root,'tests/fixtures/prepare-keyboard-sprite.ts','<main></main>',{guideAudio:true,guideAudioSource:true});
try{
 const result=await b.evaluate("import('/test.mjs').then(m=>m.prepareKeyboardSprite())");assert.equal(b.errors.length,0);assert.equal(result.metrics.clips,25);
 const dir=path.join(root,'public/guide-audio'),wav=Buffer.from(result.wav,'base64');assert.equal(wav.length,result.metrics.wavBytes);assert.ok(wav.length<1941031);
 fs.writeFileSync(path.join(dir,'keyboard.wav'),wav);fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(result.config,null,2)+'\n');
 fs.mkdirSync(path.join(root,'artifacts/verification/audio-sprite'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/verification/audio-sprite/preparation.json'),JSON.stringify({sourceSha256:hashes['keyboard.ogg'],...result.metrics},null,2));
 console.log(JSON.stringify(result.metrics));
}finally{await b.close();}
