import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {resourceVersionLabel} from '../src/domain/resource-version.ts';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root),'utf8'));
test('published common resource provenance pins every mobile override to the upstream baseline',()=>{
 const release=read('src/data/resource-release.json'),overlay=read('scripts/lib/mobile-resource-overrides.json');
 assert.equal(release.dataVersion,'1.2.3');assert.equal(release.sourceSha256,'3ff1e7bc61389c612f26c6d3bfbc50efbcd4f007001d42855fba5055945cc124');
 assert.deepEqual(release.mobileOverrides,Object.keys(overlay.files));assert.equal(release.overrideSha256,crypto.createHash('sha256').update(fs.readFileSync(new URL('scripts/lib/mobile-resource-overrides.json',root))).digest('hex'));
 assert.equal(resourceVersionLabel('0.0.0'),'内置资源 1.2.3');assert.equal(resourceVersionLabel('1.2.3'),'1.2.3');
});
test('gas cooling stays optional in both runtime schema and catalog after importing a desktop release',()=>{
 const catalog=read('src/data/catalog.json'),sources=read('public/report-runtime/report-sources.json'),exp=catalog.experiments.find(e=>e.sourceId==='理想气体状态方程');
 assert.deepEqual(exp.schema,JSON.parse(sources[exp.sourceId+'/schema.json']));
 for(const key of ['cool_t','cool_dp'])assert.equal(exp.schema.groups.flatMap(g=>g.fields).find(f=>f.key===key).required,false);
 assert.match(sources[exp.sourceId+'/generate.py'],/all\(v in \(None, "", 0\) for v in t_raw \+ dp_raw\)/);
 assert.ok(!Object.keys(sources).some(k=>/\/(data|sample|test-data)\.json$/.test(k)));
});
