import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {reportIntegrity} from '../src/domain/vendor/report-integrity.js';import {patchMobileSources} from '../scripts/lib/report-source-patches.mjs';
test('solenoid patch preserves mean-reading uncertainty while propagating single-reading inputs; unknown source is rejected',()=>{
 const shipped=JSON.parse(fs.readFileSync(new URL('../public/report-runtime/report-sources.json',import.meta.url))),key='直螺线管磁场分布的测量/generate.py';
 assert.deepEqual(patchMobileSources(shipped),shipped);
 assert.match(shipped[key],/"dm1_cm": \(dm1_cm_list\[i\], u_dm_single_cm\)/);
 assert.match(shipped[key],/u_dm_cm = u_dm_single_cm \/ math.sqrt\(2.0\)/);
 assert.throws(()=>patchMobileSources({...shipped,[key]:'unknown calculation'}),/螺线管/);
});
test('RLC keeps full precision internally; patch is exact, idempotent and rejects unknown formula',()=>{
 const moment='刚体转动惯量的测量/generate.py', key='RLC电路的稳态特性研究实验/generate.py';
 const original='f0 = round(1.0 / (2.0 * math.pi * math.sqrt(L_mh * 1e-3 * C_uf * 1e-6)) / 1000.0, 3)';
 const raw={[moment]:'variants = compose(SCRIPT_DIR, res)\nif not render_custom_quiz(doc, res): pass',[key]:original};
 const fixed=patchMobileSources(raw);assert.ok(!fixed[key].includes('round('));assert.equal(raw[key],original);assert.deepEqual(patchMobileSources(fixed),fixed);
 assert.throws(()=>patchMobileSources({...raw,[key]:'f0 = unknown_formula()'}),/RLC/);
 const shipped=JSON.parse(fs.readFileSync(new URL('../public/report-runtime/report-sources.json',import.meta.url)));
 assert.ok(shipped[key].includes(fixed[key]));assert.ok(!shipped[key].includes(original));
});
test('original tiered numeric fixtures preserve constants, rounding, unit conversion and contradiction classifications',()=>{const data={r_mohm:94.0195875,r_0:150.25,c_x_bar:.0985972,focal_length:15.125},cases=JSON.parse(fs.readFileSync(new URL('./fixtures/tiered-integrity-cases.json',import.meta.url)));assert.ok(cases.length>=15);for(const c of cases){if(c.status==='block')assert.throws(()=>reportIntegrity.inspectText(c.text,data),c.text);else assert.equal(reportIntegrity.inspectText(c.text,data).warnings.length>0,c.status==='warn',c.text);}});
test('moment custom-question patch is exact, idempotent and refuses an unknown generator structure',()=>{const key='刚体转动惯量的测量/generate.py',raw={ [key]:'variants = compose(SCRIPT_DIR, res)\nif not render_custom_quiz(doc, r):\n pass',other:'unchanged'};const fixed=patchMobileSources(raw);assert.match(fixed[key],/render_custom_quiz\(doc, res\)/);assert.match(raw[key],/render_custom_quiz\(doc, r\)/);assert.equal(fixed.other,'unchanged');assert.deepEqual(patchMobileSources(fixed),fixed);assert.throws(()=>patchMobileSources({[key]:'new generator'}));const shipped=JSON.parse(fs.readFileSync(new URL('../public/report-runtime/report-sources.json',import.meta.url)));assert.deepEqual(patchMobileSources(shipped),shipped);});
