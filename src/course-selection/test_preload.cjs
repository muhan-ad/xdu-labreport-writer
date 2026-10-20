const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'app.js'),'utf8').split('// UI')[0];
const {WeekCache,RequestQueue}=vm.runInNewContext(source+';({WeekCache,RequestQueue})',{setTimeout,Promise,Map});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('cached weeks and simultaneous reads do not call official API again',async()=>{
 let calls=0;const gate=deferred();const cache=new WeekCache(()=>{calls++;return gate.promise;});
 const first=cache.get(7),second=cache.get(7);assert.equal(first,second);gate.resolve({week:7,slots:[]});await first;
 assert.equal((await cache.get(7)).week,7);assert.equal(calls,1);
});
test('prefetch reads all weeks serially and switching reuses cache',async()=>{
 const calls=[];let active=0,maxActive=0;const cache=new WeekCache(async week=>{calls.push(week);maxActive=Math.max(maxActive,++active);await new Promise(r=>setTimeout(r,1));active--;return {week};});
 await cache.prefetch([6,7,8,9]);await cache.get(8);await cache.get(6);
 assert.deepEqual(calls,[6,7,8,9]);assert.equal(maxActive,1);
});
test('clearing cache blocks old account or pre-refresh responses',async()=>{
 const old=deferred();let calls=0;const cache=new WeekCache(()=>++calls===1?old.promise:Promise.resolve({week:7,account:'new'}));
 const pending=cache.get(7);await Promise.resolve();cache.clear();await cache.get(7);old.resolve({week:7,account:'old'});await pending;
 assert.equal(cache.peek(7).account,'new');
});
test('a failed week does not stop other weeks and can be retried',async()=>{
 let failed=false;const cache=new WeekCache(async week=>{if(week===7&&!failed){failed=true;throw Error('offline');}return {week};});
 await cache.prefetch([6,7,8]);assert.equal(cache.peek(8).week,8);assert.equal(cache.peek(7),undefined);assert.equal((await cache.get(7)).week,7);
});
test('foreground confirmation takes priority over queued preload requests',async()=>{
 const queue=new RequestQueue(),gate=deferred(),order=[];
 const active=queue.request(async()=>{order.push('active');await gate.promise;},true);
 const background=queue.request(async()=>order.push('background'),true);
 const foreground=queue.request(async()=>order.push('confirmation'));
 gate.resolve();await Promise.all([active,background,foreground]);assert.deepEqual(order,['active','confirmation','background']);
});
test('expired login stops prefetch and queue still works after request failure',async()=>{
 const seen=[];const cache=new WeekCache(async week=>{seen.push(week);throw Object.assign(Error('expired'),{status:401});});
 await cache.prefetch([6,7,8]);assert.deepEqual(seen,[6]);
 const queue=new RequestQueue();await assert.rejects(queue.request(async()=>{throw Error('failed');}));assert.equal(await queue.request(async()=>42),42);
});
