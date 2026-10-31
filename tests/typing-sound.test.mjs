import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {TypingSound,keyboardClips} from '../src/platform/typing-sound.ts';
const config=JSON.parse(fs.readFileSync(new URL('../public/guide-audio/config.json',import.meta.url)));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(options={}){
 const sources=[],calls={load:0,resume:0,closed:0,suspend:0};let hidden=false;
 const context={state:'running',currentTime:1,destination:{},resume:async()=>{calls.resume++;context.state='running';},suspend:async()=>{calls.suspend++;context.state='suspended';},close:async()=>{calls.closed++;context.state='closed';},decodeAudioData:async()=>({duration:60}),createGain:()=>({gain:{setValueAtTime(){},setTargetAtTime(){}},connect(){},disconnect(){}}),createBufferSource:()=>{const source={playbackRate:{value:1},connect(){},disconnect(){},start(...args){source.args=args;},stop(){source.stopped=true;source.onended?.();}};sources.push(source);return source;}};
 const sound=new TypingSound({context:()=>context,load:async()=>{calls.load++;return {audio:new ArrayBuffer(1),config};},hidden:()=>hidden,...options});
 return {sound,context,sources,calls,hide:v=>hidden=v};
}
test('recorded key clips validate duration, finite offsets and complete mapped keys',()=>{
 assert.equal(keyboardClips(config,60).length,25);
 for(const value of [null,{}, {defines:{}}])assert.throws(()=>keyboardClips(value,60));
 const bad=structuredClone(config);bad.defines['16']=[NaN,200];assert.throws(()=>keyboardClips(bad,60));
 assert.throws(()=>keyboardClips(config,1));
});
test('no eager audio loading; concurrent prepare shares load and playback is bounded',async()=>{
 const f=fixture();assert.equal(f.calls.load,0);await Promise.all([f.sound.prepare(),f.sound.prepare()]);assert.equal(f.calls.load,1);
 for(let i=0;i<10;i++){f.context.currentTime+=.1;f.sound.play();}assert.equal(f.sources.length,4);
 assert.ok(f.sources.every(s=>s.args[1]>=0&&s.args[2]>.01));f.sound.stop();assert.ok(f.sources.every(s=>s.stopped));
 f.context.currentTime+=1;f.sound.play();assert.equal(f.sources.length,5);f.sound.dispose();assert.equal(f.calls.closed,1);
});
test('mute and background stop audio and prevent subsequent playback',async()=>{
 const f=fixture();await f.sound.prepare();f.sound.play();f.sound.setEnabled(false);assert.equal(f.sound.state,'off');assert.equal(f.sources[0].stopped,true);assert.equal(f.calls.closed,1);
 f.context.currentTime+=1;f.sound.play();assert.equal(f.sources.length,1);assert.equal(await f.sound.prepare(),false);
 f.sound.setEnabled(true);await f.sound.prepare();f.hide(true);f.context.currentTime+=1;f.sound.play();assert.equal(f.sources.length,1);
 f.sound.pause();assert.equal(f.calls.suspend,1);f.sound.dispose();
});
test('leave during loading aborts resource and late completion cannot restore playback',async()=>{
 const pending=deferred();let signal;const f=fixture({load:s=>{signal=s;return pending.promise;}}),ready=f.sound.prepare();f.sound.dispose();assert.equal(signal.aborted,true);
 pending.resolve({audio:new ArrayBuffer(1),config});assert.equal(await ready,false);assert.equal(f.sound.state,'idle');f.sound.play();assert.equal(f.sources.length,0);
});
test('failed recording retries, while disabling an earlier request isolates its result',async()=>{
 let fail=true;const f=fixture({load:async()=>{if(fail)throw Error('missing');return {audio:new ArrayBuffer(1),config};}});
 assert.equal(await f.sound.prepare(),false);assert.equal(f.sound.state,'failed');fail=false;assert.equal(await f.sound.prepare(),true);f.sound.dispose();
 const pending=deferred(),g=fixture({load:()=>pending.promise}),old=g.sound.prepare();g.sound.setEnabled(false);g.sound.setEnabled(true);
 pending.resolve({audio:new ArrayBuffer(1),config});assert.equal(await old,false);assert.equal(g.sound.state,'idle');g.sound.dispose();
});
test('late decoding after leaving cannot publish a buffer or restore the old context',async()=>{
 const pending=deferred(),f=fixture();f.context.decodeAudioData=()=>pending.promise;
 const ready=f.sound.prepare();await Promise.resolve();f.sound.dispose();pending.resolve({duration:60});
 assert.equal(await ready,false);assert.equal(f.sound.state,'idle');f.sound.play();assert.equal(f.sources.length,0);
});
