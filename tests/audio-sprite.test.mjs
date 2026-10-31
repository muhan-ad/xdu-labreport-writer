import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
const dir=new URL('../public/guide-audio/',import.meta.url),wav=fs.readFileSync(new URL('keyboard.wav',dir)),config=JSON.parse(fs.readFileSync(new URL('config.json',dir)));
test('mobile WAV uses standard PCM16, contains all 25 clips on frame boundaries and fits six seconds',()=>{
 assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(4),wav.length-8);assert.equal(wav.toString('ascii',8,12),'WAVE');assert.equal(wav.readUInt16LE(20),1);assert.equal(wav.readUInt16LE(22),2);assert.equal(wav.readUInt32LE(24),44100);assert.equal(wav.readUInt16LE(34),16);assert.equal(wav.readUInt32LE(40),wav.length-44);
 const frames=(wav.length-44)/4;assert.ok(frames/44100<6);const clips=Object.values(config.defines).sort((a,b)=>a[0]-b[0]);assert.equal(clips.length,25);let end=0;
 for(const [offset,duration] of clips){const start=offset*44.1,count=duration*44.1;assert.ok(Math.abs(start-Math.round(start))<1e-7);assert.ok(Math.abs(count-Math.round(count))<1e-7);assert.ok(start>=end-1e-7);assert.ok(duration>=100&&duration<=250);end=start+count;assert.ok(end<=frames);}
});
test('only compact audio and license/source declarations are installed; every file matches pinned hash',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../src/data/guide-audio-manifest.json',import.meta.url)));
 assert.deepEqual(Object.keys(manifest).sort(),['LICENSE.txt','SOURCE.txt','config.json','keyboard.wav']);assert.equal(fs.existsSync(new URL('keyboard.ogg',dir)),false);
 for(const [file,expected] of Object.entries(manifest)){const bytes=fs.readFileSync(new URL(file,dir));assert.equal(bytes.length,expected.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected.sha256);}
 assert.ok(wav.length<1941031/2);assert.match(fs.readFileSync(new URL('LICENSE.txt',dir),'utf8'),/Copyright \(c\) 2021 Hai Nguyen/);
});
