import fs from 'node:fs';import crypto from 'node:crypto';import test from 'node:test';import assert from 'node:assert/strict';import {effectIds,effectMaxMs,validEggStats,emptyEggStats} from '../src/domain/easter-egg.ts';
test('all 19 original effects and watchdog durations match pinned source without removing animation',()=>{
 const source=fs.readFileSync(new URL('../src/easter-egg/original-effects.js',import.meta.url));assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'bbe931d1667bfe4a7bcff5d3310cf96d66b2780ee653ba198186e59873cb0790');
 const rows=[...source.toString().matchAll(/id: '([^']+)', name: '[^']+', weight: \d+, (?:rare: true, )?maxMs: (\d+)/g)];assert.equal(rows.length,19);assert.deepEqual(rows.map(r=>r[1]),[...effectIds]);for(const row of rows)assert.equal(effectMaxMs(row[1]),Number(row[2]));assert.match(source.toString(),/RARE_ODDS = 0\.01/);
});
test('only original compact audio and declared provenance are installed',()=>{
 const audio=fs.readFileSync(new URL('../public/easter-egg/do-not-click.mp3',import.meta.url));assert.equal(audio.length,76536);assert.equal(crypto.createHash('sha256').update(audio).digest('hex'),'f6fe9d00f696ecda0b9fea7b4d12fc05b2af765d97aab0e192b801817b7cd681');assert.deepEqual(fs.readdirSync(new URL('../public/easter-egg/',import.meta.url)).sort(),['SOURCE.txt','do-not-click.mp3']);
});
test('optional counters accept only known effects and bounded integers, not arbitrary storage keys',()=>{
 assert.equal(validEggStats(emptyEggStats()),true);assert.equal(validEggStats({count:1,last:'audio',effects:{audio:1}}),true);
 for(const value of [null,{}, {count:-1,last:'',effects:{}},{count:Infinity,last:'',effects:{}},{count:1000001,last:'',effects:{}},{count:1,last:'not-known',effects:{}},{count:1,last:'audio',effects:{profile:1}},{count:1,last:'audio',effects:{audio:'1'}}])assert.equal(validEggStats(value),false);
});
